import type { IOPinRecord } from "@shared/schema";
import type { PinStateBatch } from "./pin-state-batcher";

interface RunSketchCallbacks {
  onOutput: (line: string, isComplete?: boolean) => void;
  onError: (line: string) => void;
  onExit: (code: number | null) => void;
  onCompileError?: (error: string) => void;
  onCompileSuccess?: () => void;
  onPinState?: (
    pin: number,
    type: "mode" | "value" | "pwm",
    value: number,
  ) => void;
  onIORegistry?: (
    registry: IOPinRecord[],
    baudrate?: number,
    reason?: string,
  ) => void;
  onTelemetry?: (metrics: any) => void;
  onPinStateBatch?: (batch: PinStateBatch) => void;
}

export interface RunSketchOptions extends RunSketchCallbacks {
  code: string;
  timeoutSec?: number;
  tempDir?: string;
  /** Optional tracing context for traceability */
  context?: { sessionId?: string; label?: string };
}
