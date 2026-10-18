import { avrInstruction } from "avr8js";
import type { LoadedImage } from "../image/simulation-image";
import { AnalogInputs } from "../io/analog-inputs";
import { type Level, PinModel } from "../io/pin-model";
import { type SerialOutput, SerialPorts } from "../io/serial-ports";
import { type Machine, createMachine } from "../machine";
import type { RuntimeClock } from "./clock";

export type RunState = "idle" | "running" | "paused" | "stopped";
export type StopReason = "stop" | "timeout" | "fault";

export interface StopInfo {
  readonly reason: StopReason;
  /** Simulated time of the whole run, resets included. */
  readonly simTimeMs: number;
  /** Wall-clock run time without pauses (the timeout counts this, plan E8). */
  readonly wallTimeMs: number;
  readonly error?: string;
}

export interface EmulatorOptions {
  readonly clock: RuntimeClock;
  /** Wall-clock run time without pauses after which the run ends (plan E8: 1–300 s). */
  readonly timeoutMs: number;
  /** EEPROM content to start with (plan 4.8: kept per board in the tab). */
  readonly eeprom?: Uint8Array;
  /** Wall time one slice may compute before yielding (plan 4.7: about 8 ms). */
  readonly sliceMs?: number;
  /** Backlog above which the wall-clock reference is reset instead of catching up (E12: 100 ms). */
  readonly maxLagMs?: number;
  /** Wait when the emulation is ahead of the wall clock (plan 4.7: about 4 ms). */
  readonly waitMs?: number;
  /** Window for the real-time factor. */
  readonly realTimeWindowMs?: number;
  readonly onStop?: (info: StopInfo) => void;
}

interface TimedAction {
  readonly atMs: number;
  readonly sequence: number;
  readonly action: () => void;
}

/** Cycles executed between checks of the wall clock and of timed actions. */
const CHUNK_CYCLES = 4_000;

/**
 * Runs one sketch image in real time (plan 4.7, E8, E12): slices of at most
 * `sliceMs` that follow the wall clock, no catching up of a backlog above
 * `maxLagMs` (the reference is reset, no cycle is skipped), waiting when
 * ahead, pause that stops simulated time, reset like the RESET button and a
 * wall-clock timeout without pauses. `advance()` runs headless, as fast as
 * possible and without a wall clock.
 */
export class Emulator {
  private machineValue: Machine;
  private pinsValue: PinModel;
  private analogValue: AnalogInputs;
  private serialValue: SerialPorts;
  private stateValue: RunState = "idle";
  /** Simulated milliseconds of machines replaced by a reset. */
  private simOffsetMs = 0;
  private wallBase = 0;
  private simBase = 0;
  private lastWall = 0;
  private runWallMs = 0;
  private cancelTask: (() => void) | undefined;
  private readonly samples: Array<{ wall: number; sim: number }> = [];
  private readonly actions: TimedAction[] = [];
  /** Output of a machine replaced by a reset that was not taken yet. */
  private carriedOutput: SerialOutput[] = [];
  private actionSequence = 0;
  private readonly sliceMs: number;
  private readonly maxLagMs: number;
  private readonly waitMs: number;
  private readonly realTimeWindowMs: number;

  constructor(private readonly image: LoadedImage, private readonly options: EmulatorOptions) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new RangeError(`invalid timeout ${options.timeoutMs}`);
    this.sliceMs = options.sliceMs ?? 8;
    this.maxLagMs = options.maxLagMs ?? 100;
    this.waitMs = options.waitMs ?? 4;
    this.realTimeWindowMs = options.realTimeWindowMs ?? 3000;
    this.machineValue = createMachine(image, options.eeprom ? { eeprom: options.eeprom } : {});
    this.pinsValue = new PinModel(this.machineValue);
    this.analogValue = new AnalogInputs(this.machineValue);
    this.serialValue = new SerialPorts(this.machineValue);
  }

  get state(): RunState {
    return this.stateValue;
  }

  /** The current machine; a reset replaces it, as it replaces pins, analog inputs and serial ports. */
  get machine(): Machine {
    return this.machineValue;
  }

  get pins(): PinModel {
    return this.pinsValue;
  }

  get analog(): AnalogInputs {
    return this.analogValue;
  }

  get serial(): SerialPorts {
    return this.serialValue;
  }

  /** Simulated time of the run: cycles / clock, resets included. */
  get simTimeMs(): number {
    return this.simOffsetMs + this.machineSimMs();
  }

  /** Wall-clock run time without pauses. */
  get wallTimeMs(): number {
    return this.runWallMs + (this.stateValue === "running" ? this.options.clock.now() - this.lastWall : 0);
  }

  /** Simulated per wall time over the last `realTimeWindowMs` of running; 1 before enough data exists. */
  get realTimeFactor(): number {
    if (this.samples.length < 2) return 1;
    const first = this.samples[0];
    const last = this.samples.at(-1) ?? first;
    const wall = last.wall - first.wall;
    return wall > 0 ? (last.sim - first.sim) / wall : 1;
  }

  start(): void {
    this.expectState(["idle"], "start");
    this.stateValue = "running";
    this.rebase();
    this.schedule("now");
  }

  pause(): void {
    this.expectState(["running"], "pause");
    this.accountWall();
    this.cancel();
    this.stateValue = "paused";
  }

  resume(): void {
    this.expectState(["paused"], "resume");
    this.stateValue = "running";
    this.rebase();
    this.schedule("now");
  }

  stop(): void {
    this.expectState(["running", "paused"], "stop");
    this.finish({ reason: "stop" });
  }

  /**
   * RESET button: a new machine from the same image, the run goes on. EEPROM
   * content, outside pin levels and analog voltages persist; serial input not
   * yet received is lost.
   */
  reset(): void {
    this.expectState(["idle", "running", "paused"], "reset");
    const outside = this.pinsValue.outsideLevels();
    const volts = this.analogValue.pins.map((pin) => [pin, this.analogValue.volts(pin)] as const);
    const aref = this.analogValue.arefVolts;
    this.simOffsetMs += this.machineSimMs();
    this.carriedOutput.push(...this.serialValue.takeOutput());
    this.machineValue = createMachine(this.image, { eeprom: this.machineValue.eeprom });
    this.pinsValue = new PinModel(this.machineValue);
    this.analogValue = new AnalogInputs(this.machineValue);
    this.serialValue = new SerialPorts(this.machineValue);
    for (const [pin, level] of outside) this.pinsValue.setDigital(pin, level);
    for (const [pin, value] of volts) this.analogValue.setVolts(pin, value);
    this.analogValue.setArefVolts(aref);
    if (this.stateValue === "running") this.rebase();
  }

  /** Serial output since the previous call, including output from before a reset. */
  takeSerialOutput(): SerialOutput[] {
    const output = [...this.carriedOutput, ...this.serialValue.takeOutput()];
    this.carriedOutput = [];
    return output;
  }

  /** Serial input; refused while paused or stopped (PauseResume SSOT §10). */
  sendSerial(port: number, text: string): boolean {
    if (this.stateValue === "paused" || this.stateValue === "stopped") return false;
    this.serialValue.send(port, text);
    return true;
  }

  setDigital(pin: number, level: Level): boolean {
    return this.pinsValue.setDigital(pin, level);
  }

  setAnalog(pin: number, value: number): void {
    this.analogValue.setAnalog(pin, value);
  }

  /** Runs `action` once simulated time reaches `atMs` (headless stimuli, corpus scripts). */
  at(atMs: number, action: () => void): void {
    this.actions.push({ atMs, sequence: this.actionSequence++, action });
    this.actions.sort((a, b) => a.atMs - b.atMs || a.sequence - b.sequence);
  }

  /** Headless: emulates `simMs` as fast as possible, without wall clock, timeout or pacing. */
  advance(simMs: number): void {
    this.expectState(["idle", "paused"], "advance");
    this.runUntil(this.simTimeMs + simMs, () => false);
  }

  private readonly tick = (): void => {
    this.cancelTask = undefined;
    if (this.stateValue !== "running") return;
    const { clock } = this.options;
    try {
      this.accountWall();
      if (this.runWallMs >= this.options.timeoutMs) {
        this.finish({ reason: "timeout" });
        return;
      }
      if (clock.now() - this.wallBase - (this.simTimeMs - this.simBase) > this.maxLagMs) this.rebase();
      const sliceStart = clock.now();
      let ahead = false;
      this.runUntil(Number.POSITIVE_INFINITY, () => {
        const now = clock.now();
        ahead = this.simTimeMs >= this.simBase + (now - this.wallBase);
        return ahead || now - sliceStart >= this.sliceMs;
      });
      this.accountWall();
      this.sample();
      this.schedule(ahead ? "wait" : "now");
    } catch (error) {
      this.finish({ reason: "fault", error: error instanceof Error ? error.message : String(error) });
    }
  };

  /** Executes chunks until `targetMs` or until `shouldYield` says so; fires due timed actions. */
  private runUntil(targetMs: number, shouldYield: () => boolean): void {
    const cyclesPerMs = this.machineValue.board.clockHz / 1000;
    while (this.simTimeMs < targetMs) {
      while (this.actions.length > 0 && this.actions[0].atMs <= this.simTimeMs) this.actions.shift()?.action();
      const nextAction = this.actions[0]?.atMs ?? Number.POSITIVE_INFINITY;
      const stopMs = Math.min(targetMs, nextAction);
      const { cpu } = this.machineValue;
      const end = Math.min(cpu.cycles + CHUNK_CYCLES, Math.ceil((stopMs - this.simOffsetMs) * cyclesPerMs));
      while (cpu.cycles < end) {
        avrInstruction(cpu);
        cpu.tick();
      }
      if (shouldYield()) return;
    }
  }

  private machineSimMs(): number {
    return (this.machineValue.cpu.cycles * 1000) / this.machineValue.board.clockHz;
  }

  private rebase(): void {
    const now = this.options.clock.now();
    this.wallBase = now;
    this.simBase = this.simTimeMs;
    this.lastWall = now;
  }

  private accountWall(): void {
    const now = this.options.clock.now();
    this.runWallMs += now - this.lastWall;
    this.lastWall = now;
  }

  private sample(): void {
    const wall = this.runWallMs;
    this.samples.push({ wall, sim: this.simTimeMs });
    while (this.samples.length > 2 && wall - this.samples[1].wall >= this.realTimeWindowMs) this.samples.shift();
  }

  private schedule(when: "now" | "wait"): void {
    const { clock } = this.options;
    this.cancelTask = when === "now" ? clock.postTask(this.tick) : clock.setTimeout(this.tick, this.waitMs);
  }

  private cancel(): void {
    this.cancelTask?.();
    this.cancelTask = undefined;
  }

  private finish(info: Omit<StopInfo, "simTimeMs" | "wallTimeMs">): void {
    if (this.stateValue === "running") this.accountWall();
    this.cancel();
    this.stateValue = "stopped";
    this.options.onStop?.({ ...info, simTimeMs: this.simTimeMs, wallTimeMs: this.runWallMs });
  }

  private expectState(allowed: readonly RunState[], action: string): void {
    if (!allowed.includes(this.stateValue)) throw new Error(`cannot ${action} while ${this.stateValue}`);
  }
}
