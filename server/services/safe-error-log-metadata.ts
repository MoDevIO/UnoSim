export function safeErrorLogMetadata(error: unknown): string {
  const errorType = error instanceof Error ? error.name : typeof error;
  let messageBytes = 0;
  if (error instanceof Error) {
    messageBytes = Buffer.byteLength(error.message);
  } else if (typeof error === "string") {
    messageBytes = Buffer.byteLength(error);
  }
  const errorCode = error instanceof Error && "code" in error && typeof error.code === "string"
    ? " code=" + error.code
    : "";

  return errorType + errorCode + ", " + messageBytes + " diagnostic bytes";
}

export function safeErrorStackFrames(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return "";
  return error.stack.split("\n").slice(1, 6).join("\n");
}
