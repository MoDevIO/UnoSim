export {
  canonicalJson as canonicalSemanticJson,
  canonicalDigest as canonicalSemanticDigest,
  isSha256Digest,
  sha256 as semanticSha256,
} from "../canonical";

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  if (!Object.isFrozen(value)) Object.freeze(value);
  return value;
}
