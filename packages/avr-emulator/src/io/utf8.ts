const REPLACEMENT = "�";

/**
 * Incremental UTF-8 decoder: multi-byte characters may be split across
 * calls (USART bytes arrive one at a time). Invalid sequences become U+FFFD.
 */
export class Utf8StreamDecoder {
  private codePoint = 0;
  private needed = 0;
  private seen = 0;
  private lowerBound = 0x80;

  /** Feeds bytes and returns the text completed by them. */
  decode(bytes: Iterable<number>): string {
    let out = "";
    for (const byte of bytes) out += this.push(byte & 0xff);
    return out;
  }

  /** Text of an unfinished sequence at the end of the stream (U+FFFD or empty). */
  flush(): string {
    const pending = this.needed > 0;
    this.needed = 0;
    return pending ? REPLACEMENT : "";
  }

  private push(byte: number): string {
    if (this.needed > 0) {
      if ((byte & 0xc0) === 0x80) {
        this.codePoint = (this.codePoint << 6) | (byte & 0x3f);
        if (++this.seen < this.needed) return "";
        const codePoint = this.codePoint;
        this.needed = 0;
        const valid = codePoint >= this.lowerBound && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
        return valid ? String.fromCodePoint(codePoint) : REPLACEMENT;
      }
      this.needed = 0; // truncated sequence; the byte starts something new
      return REPLACEMENT + this.push(byte);
    }
    if (byte < 0x80) return String.fromCodePoint(byte);
    const lead = [
      { mask: 0xe0, value: 0xc0, bits: 0x1f, needed: 1, lowerBound: 0x80 },
      { mask: 0xf0, value: 0xe0, bits: 0x0f, needed: 2, lowerBound: 0x800 },
      { mask: 0xf8, value: 0xf0, bits: 0x07, needed: 3, lowerBound: 0x10000 },
    ].find(({ mask, value }) => (byte & mask) === value);
    if (!lead) return REPLACEMENT;
    this.codePoint = byte & lead.bits;
    this.needed = lead.needed;
    this.seen = 0;
    this.lowerBound = lead.lowerBound;
    return "";
  }
}

/** UTF-8 bytes of a string (lone surrogates become U+FFFD). */
export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    let codePoint = char.codePointAt(0) ?? 0xfffd;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = 0xfffd;
    if (codePoint < 0x80) bytes.push(codePoint);
    else if (codePoint < 0x800) bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint < 0x10000) bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    else bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
  }
  return Uint8Array.from(bytes);
}
