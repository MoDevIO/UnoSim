type EmbeddingWindow = {
  readonly parent: unknown;
  readonly location: { readonly origin: string; readonly ancestorOrigins?: ArrayLike<string> };
  readonly document?: { readonly referrer?: string };
};

/**
 * Origin of the page that embeds the simulator, used as postMessage peer.
 * `location.ancestorOrigins` is Chromium/WebKit only; Firefox gets the origin from
 * the referrer of the iframe navigation instead. Which pages may embed at all is
 * enforced by the browser through the CSP `frame-ancestors` allowlist, and
 * postMessage delivers only to the exact target origin, so a wrong guess fails
 * closed. Top-level, the simulator's own origin is used, as before.
 */
export function detectParentOrigin(win: EmbeddingWindow = globalThis as unknown as EmbeddingWindow): string {
  const ownOrigin = win.location.origin;
  if (win.parent === win) return ownOrigin;
  const ancestor = win.location.ancestorOrigins?.[0];
  if (ancestor) return ancestor;
  return originOf(win.document?.referrer) ?? ownOrigin;
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { origin } = new URL(url);
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}
