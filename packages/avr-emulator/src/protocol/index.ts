/**
 * Entry `@unosim/avr-emulator/protocol`: the commands, events and the UI-side
 * run management of the worker protocol without any emulation code (no
 * avr8js), so the main thread can talk to the worker without loading the
 * emulator.
 */
export { COMMAND_LIMITS, PROTOCOL_VERSION, RUN_STARTING_COMMANDS } from "./messages";
export type { Command, CommandType, RunEvent, RunStatus, TelemetrySample, WorkerEvent, WorkerEventType } from "./messages";
export { RunGate } from "./run-gate";
export type { DiagnosticEvent, StopReason } from "../runtime/emulator";
export type { IoUsage } from "../io/io-usage";
export type { PinSnapshot } from "../io/pin-model";
