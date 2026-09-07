export const SYSTEM_BUSY_MESSAGE =
  "Der Simulator ist momentan ausgelastet. Bitte in wenigen Sekunden erneut versuchen.";

export type OperationErrorCode =
  | "RATE_LIMITED"
  | "SYSTEM_BUSY"
  | "SIMULATION_ALREADY_ACTIVE"
  | "SIMULATION_START_FAILED";

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
