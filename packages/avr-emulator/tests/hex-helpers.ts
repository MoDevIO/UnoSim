/** Builds Intel HEX records with correct checksums for tests. */
export function record(type: number, address: number, data: readonly number[]): string {
  const bytes = [data.length, (address >> 8) & 0xff, address & 0xff, type, ...data];
  const checksum = (0x100 - (bytes.reduce((a, b) => a + b, 0) & 0xff)) & 0xff;
  return `:${[...bytes, checksum].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

export const EOF_RECORD = ":00000001FF";
