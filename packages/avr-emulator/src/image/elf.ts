import { ImageError } from "./image-error";

export interface ElfSymbol {
  readonly value: number;
  readonly size: number;
  readonly kind: "function" | "object" | "other";
}

const EM_AVR = 83;
const SHT_SYMTAB = 2;
const STT_OBJECT = 1;
const STT_FUNC = 2;
const SYMBOL_ENTRY_BYTES = 16;

/** Symbol table of an AVR ELF32 file (little endian), read without external tools. */
export function readElfSymbols(elf: Uint8Array): ReadonlyMap<string, ElfSymbol> {
  if (elf.length < 52 || elf[0] !== 0x7f || elf[1] !== 0x45 || elf[2] !== 0x4c || elf[3] !== 0x46) {
    throw new ImageError("not an ELF file");
  }
  if (elf[4] !== 1 || elf[5] !== 1) throw new ImageError("only 32-bit little-endian ELF is supported");
  const view = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  if (view.getUint16(18, true) !== EM_AVR) throw new ImageError("ELF file is not for AVR");
  const shoff = view.getUint32(32, true);
  const shentsize = view.getUint16(46, true);
  const shnum = view.getUint16(48, true);
  if (shoff + shnum * shentsize > elf.length || shentsize < 40) throw new ImageError("ELF section table out of range");

  const section = (index: number) => {
    const o = shoff + index * shentsize;
    return { type: view.getUint32(o + 4, true), offset: view.getUint32(o + 16, true), size: view.getUint32(o + 20, true), link: view.getUint32(o + 24, true) };
  };
  const symbols = new Map<string, ElfSymbol>();
  for (let index = 0; index < shnum; index++) {
    const symtab = section(index);
    if (symtab.type !== SHT_SYMTAB) continue;
    if (symtab.link >= shnum) throw new ImageError("ELF symbol table has no string table");
    const strtab = section(symtab.link);
    if (symtab.offset + symtab.size > elf.length || strtab.offset + strtab.size > elf.length) {
      throw new ImageError("ELF symbol table out of range");
    }
    for (let o = symtab.offset; o + SYMBOL_ENTRY_BYTES <= symtab.offset + symtab.size; o += SYMBOL_ENTRY_BYTES) {
      const name = readName(elf, strtab.offset + view.getUint32(o, true), strtab.offset + strtab.size);
      if (name === "") continue;
      const type = elf[o + 12] & 0xf;
      const kind = type === STT_FUNC ? "function" : type === STT_OBJECT ? "object" : "other";
      symbols.set(name, { value: view.getUint32(o + 4, true), size: view.getUint32(o + 8, true), kind });
    }
  }
  return symbols;
}

function readName(elf: Uint8Array, start: number, limit: number): string {
  let end = start;
  while (end < limit && elf[end] !== 0) end++;
  let name = "";
  for (let i = start; i < end; i++) name += String.fromCharCode(elf[i]);
  return name;
}
