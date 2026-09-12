import type { ExamplesErrorCode } from "@shared/examples";

const STATUS_BY_CODE: Record<ExamplesErrorCode, number> = {
  INVALID_SELECTION: 400,
  INVALID_REF: 400,
  INVALID_REVISION: 400,
  INVALID_SNAPSHOT: 422,
  SOURCE_UNAVAILABLE: 503,
  EXAMPLE_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  LOAD_CAPACITY_EXCEEDED: 503,
};

export class ExamplesError extends Error {
  readonly status: number;

  constructor(
    readonly code: ExamplesErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ExamplesError";
    this.status = STATUS_BY_CODE[code];
  }
}

export function asExamplesError(error: unknown): ExamplesError {
  return error instanceof ExamplesError
    ? error
    : new ExamplesError("SOURCE_UNAVAILABLE", "External examples source is unavailable");
}
