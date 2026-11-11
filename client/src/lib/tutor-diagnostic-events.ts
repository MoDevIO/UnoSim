import type { DebugMessage } from "@/hooks/use-debug-console";

// The lazy runtime installs the decoder before emitting any event.
let decode: ((value: unknown) => DebugMessage | undefined) | undefined;
export function registerTutorDiagnosticDecoder(value: NonNullable<typeof decode>): void { decode = value; }
export function readTutorDebugMessage(value: unknown): DebugMessage | undefined { return decode?.(value); }
