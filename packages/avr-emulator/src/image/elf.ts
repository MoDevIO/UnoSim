import { ImageError } from "./image-error";

export interface ElfSymbol {
  readonly value: number;
  readonly size: number;
  readonly kind: "function" | "object" | "other";
}

interface Section {
  readonly type: number;
  readonly offset: number;
  readonly size: number;
  readonly link: number;
}

const EM_AVR = 83;
const SHT_SYMTAB = 2;
const STT_OBJECT = 1;
const STT_FUNC = 2;
const SYMBOL_ENTRY_BYTES = 16;

/** Symbol table of an AVR ELF32 file (little endian), read without external tools. */
export function readElfSymbols(elf: Uint8Array): ReadonlyMap<string, ElfSymbol> {
  const view = checkedView(elf);
  const sections = readSections(view);
  const symbols = new Map<string, ElfSymbol>();
  for (const symtab of sections.filter((section) => section.type === SHT_SYMTAB)) {
    const strtab = sections[symtab.link];
    if (!strtab) throw new ImageError("ELF symbol table has no string table");
    for (const section of [symtab, strtab]) {
      if (section.offset + section.size > elf.length) throw new ImageError("ELF symbol table out of range");
    }
    readSymbolTable(elf, view, symtab, strtab, symbols);
  }
  return symbols;
}

function checkedView(elf: Uint8Array): DataView {
  if (elf.length < 52 || elf[0] !== 0x7f || elf[1] !== 0x45 || elf[2] !== 0x4c || elf[3] !== 0x46) {
    throw new ImageError("not an ELF file");
  }
  if (elf[4] !== 1 || elf[5] !== 1) throw new ImageError("only 32-bit little-endian ELF is supported");
  const view = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  if (view.getUint16(18, true) !== EM_AVR) throw new ImageError("ELF file is not for AVR");
  return view;
}

function readSections(view: DataView): Section[] {
  const shoff = view.getUint32(32, true);
  const shentsize = view.getUint16(46, true);
  const shnum = view.getUint16(48, true);
  if (shoff + shnum * shentsize > view.byteLength || shentsize < 40) throw new ImageError("ELF section table out of range");
  return Array.from({ length: shnum }, (_, index) => {
    const o = shoff + index * shentsize;
    return { type: view.getUint32(o + 4, true), offset: view.getUint32(o + 16, true), size: view.getUint32(o + 20, true), link: view.getUint32(o + 24, true) };
  });
}

function readSymbolTable(elf: Uint8Array, view: DataView, symtab: Section, strtab: Section, out: Map<string, ElfSymbol>): void {
  const end = symtab.offset + symtab.size;
  for (let o = symtab.offset; o + SYMBOL_ENTRY_BYTES <= end; o += SYMBOL_ENTRY_BYTES) {
    const name = readName(elf, strtab.offset + view.getUint32(o, true), strtab.offset + strtab.size);
    if (name === "") continue;
    out.set(name, { value: view.getUint32(o + 4, true), size: view.getUint32(o + 8, true), kind: kindOf(elf[o + 12] & 0xf) });
  }
}

function kindOf(type: number): ElfSymbol["kind"] {
  if (type === STT_FUNC) return "function";
  if (type === STT_OBJECT) return "object";
  return "other";
}

function readName(elf: Uint8Array, start: number, limit: number): string {
  let end = start;
  while (end < limit && elf[end] !== 0) end++;
  return String.fromCodePoint(...elf.subarray(start, end));
}
