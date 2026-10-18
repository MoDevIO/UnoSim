import { loadFlashImage } from "../image/simulation-image";
import type { RuntimeClock } from "../runtime/clock";
import { Emulator, type EmulatorOptions, type StopInfo } from "../runtime/emulator";
import { parseCommand } from "../protocol/commands";
import { EventBatcher } from "../protocol/event-batcher";
import { type Command, PROTOCOL_VERSION, RUN_STARTING_COMMANDS, type RunEvent, type WorkerEvent } from "../protocol/messages";

export interface WorkerHostOptions {
  readonly clock: RuntimeClock;
  /** Sends one event to the UI. */
  readonly post: (event: RunEvent) => void;
  /** How often the host collects output and sends packets (plan 4.5: about 60 per second). */
  readonly pumpIntervalMs?: number;
  /** Heartbeat period, also while paused (plan 4.5: about 500 ms). */
  readonly heartbeatIntervalMs?: number;
  /** Overrides for the emulator, e.g. slice length in tests. */
  readonly emulator?: Partial<Omit<EmulatorOptions, "clock" | "timeoutMs" | "onStop">>;
}

/** Wall-clock timeout before the first `start` supplies the real one (E8 maximum). */
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * The worker side of the protocol (plan 4.5, P1.12): takes commands, runs the
 * emulator, bundles its output and sends events with the `runId` of the run
 * they belong to. It stays usable between runs: `load` replaces the machine.
 * Commands are checked against the schema first and discarded when invalid or
 * when they carry another `runId` than the current run (`load`, `start` and
 * `reset` begin a new run and must carry a higher one). Internal errors end
 * the run with `fault`. Supervision from outside (deadlines, `terminate()`)
 * belongs to the main thread, because a stuck worker cannot do it itself.
 */
export class WorkerHost {
  private runId: number | undefined;
  private emulator: Emulator | undefined;
  private cancelPump: (() => void) | undefined;
  private lastHeartbeat = 0;
  private readonly batcher: EventBatcher;
  private readonly pumpIntervalMs: number;
  private readonly heartbeatIntervalMs: number;

  constructor(private readonly options: WorkerHostOptions) {
    this.pumpIntervalMs = options.pumpIntervalMs ?? 1000 / 60;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 500;
    this.batcher = new EventBatcher({ now: () => options.clock.now() });
  }

  /** Simulated time of the current machine, 0 without one. */
  get simTimeMs(): number {
    return this.emulator?.simTimeMs ?? 0;
  }

  /** Entry point for messages from the UI; never throws. */
  handleMessage(message: unknown): void {
    const parsed = parseCommand(message);
    if (!parsed.ok) return;
    const { command } = parsed;
    if (RUN_STARTING_COMMANDS.includes(command.type)) {
      if (this.runId !== undefined && command.runId <= this.runId) return;
    } else if (command.runId !== this.runId) {
      return;
    }
    try {
      this.dispatch(command);
    } catch (error) {
      this.fault(error instanceof Error ? error.message : String(error));
    }
  }

  private dispatch(command: Command): void {
    if (RUN_STARTING_COMMANDS.includes(command.type)) this.beginRun(command.runId);
    switch (command.type) {
      case "load":
        this.load(command);
        break;
      case "start":
        this.withEmulator("idle", (emulator) => {
          emulator.configureTimeout(command.timeoutMs);
          emulator.start();
          this.batcher.addStatus("running");
        });
        break;
      case "pause":
        this.withEmulator("running", (emulator) => {
          emulator.pause();
          this.batcher.addStatus("paused");
        });
        break;
      case "resume":
        this.withEmulator("paused", (emulator) => {
          emulator.resume();
          this.batcher.addStatus("running");
        });
        break;
      case "stop":
        this.stop();
        break;
      case "reset":
        this.reset();
        break;
      case "serialIn":
        this.emulator?.sendSerial(command.port, command.text);
        break;
      case "setDigital":
        this.emulator?.setDigital(command.pin, command.level);
        break;
      case "setAnalog":
        this.setAnalog(command.pin, command.value);
        break;
    }
    // Confirmations of state changes go out at once; other commands wait for the regular packet interval.
    this.pump(command.type !== "serialIn" && command.type !== "setDigital" && command.type !== "setAnalog");
  }

  private load(command: Extract<Command, { type: "load" }>): void {
    this.dispose();
    if (command.artifactBoard !== command.board) {
      throw new Error(`the artifact is built for ${command.artifactBoard}, the selected board is ${command.board}`);
    }
    const image = loadFlashImage(command.board, new Uint8Array(command.flash), command.sha256, command.symbols);
    const emulator: Emulator = new Emulator(image, {
      ...this.options.emulator,
      clock: this.options.clock,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      onStop: (info) => this.onStop(emulator, info),
    });
    this.emulator = emulator;
    this.lastHeartbeat = this.options.clock.now();
    this.post({ type: "ready", protocolVersion: PROTOCOL_VERSION, board: command.board, buildId: command.buildId });
    this.schedulePump();
  }

  private stop(): void {
    const { emulator } = this;
    if (!emulator) return;
    if (emulator.state === "idle") this.finish({ reason: "stop", simTimeMs: emulator.simTimeMs, wallTimeMs: emulator.wallTimeMs });
    else emulator.stop(); // reports through onStop
  }

  private reset(): void {
    const { emulator } = this;
    if (!emulator || (emulator.state !== "running" && emulator.state !== "paused")) return;
    emulator.reset();
    this.batcher.addStatus(emulator.state);
  }

  private setAnalog(pin: number, value: number): void {
    try {
      this.emulator?.setAnalog(pin, value);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error; // a pin the board does not have: refused like an invalid command
    }
  }

  private withEmulator(state: "idle" | "running" | "paused", action: (emulator: Emulator) => void): void {
    const { emulator } = this;
    if (emulator?.state === state) action(emulator);
  }

  /** A new run: what is still pending belongs to the old one and is sent under its `runId` first. */
  private beginRun(runId: number): void {
    this.pump(true);
    this.runId = runId;
  }

  private onStop(emulator: Emulator, info: StopInfo): void {
    if (emulator !== this.emulator) return; // a machine replaced by `load`
    this.collect(emulator);
    if (info.error !== undefined) this.batcher.addFault(info.error);
    this.finish(info);
  }

  private finish({ reason, simTimeMs, wallTimeMs }: StopInfo): void {
    this.batcher.addStatus("stopped", { reason, simTimeMs, wallTimeMs });
    this.send(true);
    this.dispose();
  }

  private fault(message: string): void {
    if (this.runId === undefined) return;
    this.batcher.addFault(message);
    this.batcher.addStatus("stopped", { reason: "fault" });
    this.send(true);
    this.dispose();
  }

  private dispose(): void {
    this.cancelPump?.();
    this.cancelPump = undefined;
    this.emulator = undefined;
    this.batcher.discard();
  }

  private schedulePump(): void {
    this.cancelPump = this.options.clock.setTimeout(() => {
      this.cancelPump = undefined;
      this.pump(false);
      if (this.emulator) this.schedulePump();
    }, this.pumpIntervalMs);
  }

  private pump(force: boolean): void {
    const { emulator } = this;
    if (!emulator) return;
    this.collect(emulator);
    const { clock } = this.options;
    if (clock.now() - this.lastHeartbeat >= this.heartbeatIntervalMs) {
      this.lastHeartbeat = clock.now();
      this.post({ type: "heartbeat", simTimeMs: emulator.simTimeMs });
    }
    this.send(force);
  }

  private collect(emulator: Emulator): void {
    this.batcher.addPins(emulator.pins.takeChanges());
    this.batcher.addSerial(emulator.takeSerialOutput());
    this.batcher.addUsages(emulator.usage.takeUsages());
    this.batcher.addDiagnostics(emulator.takeDiagnostics());
  }

  private send(force: boolean): void {
    if (this.runId === undefined) return;
    const simTimeMs = this.emulator?.simTimeMs ?? 0;
    const realTimeFactor = this.emulator?.realTimeFactor ?? 1;
    for (const event of this.batcher.flush({ runId: this.runId, simTimeMs, realTimeFactor }, force)) this.options.post(event);
  }

  private post(event: WorkerEvent): void {
    if (this.runId !== undefined) this.options.post({ ...event, runId: this.runId });
  }
}
