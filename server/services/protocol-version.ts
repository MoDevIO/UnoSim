/** Canonical versions for the server-facing HTTP and WebSocket contracts. */
export const REST_API_VERSION = "1.0.0";
export const WEBSOCKET_PROTOCOL_VERSION = "1.0.0";

export const SUPPORTED_REST_API_VERSIONS = [REST_API_VERSION] as const;

/** Accept exact versions and major/minor-compatible shorthand (e.g. `1` or `1.0`). */
export function isSupportedRestApiVersion(requested: string): boolean {
  return SUPPORTED_REST_API_VERSIONS.some((supported) =>
    supported === requested || supported.startsWith(`${requested}.`),
  );
}

export function apiVersionMiddleware(req: { header(name: string): string | undefined }, res: { setHeader(name: string, value: string): void; status(code: number): { json(body: unknown): void } }, next: () => void): void {
  res.setHeader("X-UnoSim-API-Version", REST_API_VERSION);
  const requestedVersion = req.header("accept-version");
  if (requestedVersion && !isSupportedRestApiVersion(requestedVersion)) {
    res.status(406).json({
      error: "unsupported_api_version",
      requestedVersion,
      supportedVersions: SUPPORTED_REST_API_VERSIONS,
    });
    return;
  }
  next();
}
