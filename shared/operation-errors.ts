export const SYSTEM_BUSY_MESSAGE =
  "The simulator is busy right now. Please try again in a few seconds.";

export type OperationErrorCode =
  | "RATE_LIMITED"
  | "SYSTEM_BUSY"
  | "SIMULATION_ALREADY_ACTIVE"
  | "SIMULATION_START_FAILED"
  | "RUNTIME_UNAVAILABLE";

export type OperationError = {
  code: OperationErrorCode;
  message: string;
  retryAfter?: number;
};

export function operationError(
  code: OperationErrorCode,
  message: string,
  retryAfter?: number,
): OperationError {
  return retryAfter === undefined
    ? { code, message }
    : { code, message, retryAfter };
}
