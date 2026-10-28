import { RUN_STARTING_COMMANDS, type CommandType, type RunEvent, type RunStatus } from "./messages";

/**
 * UI side of the run identification (plan 4.5): `load`, `start` and `reset`
 * begin a new run, everything else belongs to the current one. Events of any
 * other run are discarded, so late pins, serial text or status messages of a
 * stopped, reset or replaced run never reach the new one. `stop` takes effect
 * at once: the run ends and all later events of it are dropped. The state
 * changes to `running` or `paused` only with the confirmation of the current
 * run.
 */
export class RunGate {
  private counter = 0;
  private current: number | undefined;
  private confirmed: RunStatus | undefined;

  /** The `runId` for the next command of this type; run-starting commands begin a new run. */
  runIdFor(command: CommandType): number {
    if (RUN_STARTING_COMMANDS.includes(command)) {
      this.current = ++this.counter;
      this.confirmed = undefined;
    }
    return this.current ?? 0;
  }

  get runId(): number | undefined {
    return this.current;
  }

  /** The state the worker has confirmed for the current run. */
  get state(): RunStatus | undefined {
    return this.confirmed;
  }

  /** Ends the current run on the UI side at once (stop); later events of it are dropped. */
  end(): void {
    this.current = undefined;
    this.confirmed = "stopped";
  }

  /** True if the event belongs to the current run; a `status` event also updates the confirmed state. */
  accept(event: RunEvent): boolean {
    if (this.current === undefined || event.runId !== this.current) return false;
    if (event.type === "status") this.confirmed = event.state;
    return true;
  }
}
