import { ImageError } from "./image-error";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]));

/** Standard Base64 with padding (RFC 4648), independent of Buffer and btoa. */
export function encodeBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(chunk >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? ALPHABET[chunk & 63] : "=";
  }
  return out;
}

export function decodeBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new ImageError("invalid Base64");
  const padding = text.endsWith("==") ? 2 : Number(text.endsWith("="));
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const chunk = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | (LOOKUP.get(text[i + k]) ?? 0), 0);
    for (const shift of [16, 8, 0]) if (o < out.length) out[o++] = (chunk >> shift) & 0xff;
  }
  return out;
}
