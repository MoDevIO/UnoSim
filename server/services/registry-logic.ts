import type { IOPinRecord } from "@shared/schema";

export function mergeRegistryUsage(existing: IOPinRecord["usedAt"], incoming: IOPinRecord["usedAt"]): IOPinRecord["usedAt"] {
  const merged = [...(existing ?? []), ...(incoming ?? [])];
  if (merged.length === 0) return undefined;
  const unique = new Map<string, (typeof merged)[number]>();
  for (const entry of merged) unique.set(`${entry.operation}@${entry.line}`, entry);
  return [...unique.values()];
}

export function cleanRegistryRecord(pin: IOPinRecord): IOPinRecord {
  const cleaned = { ...pin };
  if (cleaned.definedAt?.line === 0) delete cleaned.definedAt;
  if (cleaned.usedAt) {
    cleaned.usedAt = cleaned.usedAt.filter((entry) => entry.line !== 0 || !!entry.operation);
    if (cleaned.usedAt.length === 0) delete cleaned.usedAt;
  }
  return cleaned;
}
