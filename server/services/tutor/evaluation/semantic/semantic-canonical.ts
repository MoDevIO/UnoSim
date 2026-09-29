import { createHash } from "node:crypto";

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function serializeCanonical(value: unknown, active: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not allow non-finite numbers");
    return JSON.stringify(value);
  }
  if (value === undefined) return "null";
  if (typeof value !== "object") throw new TypeError("Canonical JSON accepts only JSON values");
  if (active.has(value)) throw new TypeError("Canonical JSON does not allow cyclic values");
  active.add(value);
  try {
    if (Array.isArray(value)) return `[${Array.from(value, (entry) => serializeCanonical(entry, active)).join(",")}]`;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Canonical JSON accepts only plain objects");
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort(compareUtf8)
      .map((key) => `${JSON.stringify(key)}:${serializeCanonical(object[key], active)}`);
    return `{${entries.join(",")}}`;
  } finally {
    active.delete(value);
  }
}

export function canonicalSemanticJson(value: unknown): string {
  return serializeCanonical(value, new Set());
}

export function semanticSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalSemanticDigest(value: unknown): string {
  return semanticSha256(canonicalSemanticJson(value));
}

export function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  if (!Object.isFrozen(value)) Object.freeze(value);
  return value;
}
