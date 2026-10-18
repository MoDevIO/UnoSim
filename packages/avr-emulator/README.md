# @unosim/avr-emulator

AVR emulation core of UnoSim, built on [avr8js](https://github.com/wokwi/avr8js)
(MIT, pinned to exactly 0.21.1). The package runs the flash image that
`arduino-cli` builds for a board: MCU profiles, board pin maps, peripherals,
timing and the event protocol to the UI.

Status: scaffold and simulation image (plan packages P1.1 and P1.2 of
[browser-emulation-plan.md](../../docs/proposals/browser-emulation-plan.md)).
The package is `private` and lives in the UnoSim npm workspace; moving it to
its own repository is an optional follow-up (F1).

## Boundaries

- Hardware only. The package imports nothing from UnoSim (`client/`,
  `server/`, `shared/`); ESLint enforces this. UnoSim's `shared/` may import
  the package.
- The only runtime dependency is avr8js, pinned exactly.

## API

| Export | Purpose |
|---|---|
| `ramEnd(layout)` | RAMEND of an MCU from SRAM start and size |
| `avr8jsSramParameter(layout)` | size parameter for `new CPU(progMem, …)` so that the data space ends at RAMEND (avr8js allocates `parameter + 0x100` bytes); never use the avr8js default |
| `AVR8JS_DATA_SPACE_OFFSET` | the `0x100` avr8js adds |

| MCU | SRAM | RAMEND | parameter |
|---|---|---|---|
| ATmega328P | 0x0100–0x08FF | 0x08FF | 2048 |
| ATmega2560 | 0x0200–0x21FF | 0x21FF | 8448 |
| ATtiny85 | 0x0060–0x025F | 0x025F | 352 |

### Simulation image

| Export | Purpose |
|---|---|
| `buildSimulationImage({ board, hex, elf? })` | Intel HEX (and optionally the ELF) from `arduino-cli` → `SimulationImage`, the transport form of the field `artifact` of `POST /api/compile`: `formatVersion`, `board`, used flash range as `flashBase64`, `flashBytes`, `sha256`, `symbols` |
| `loadSimulationImage(value)` | validates an image from an untrusted source (format, board, size against the MCU flash, length, SHA-256, symbol ranges) and returns the whole flash as `Uint16Array`; bytes beyond the image read 0xFF like erased flash |
| `parseIntelHex(text, maxBytes)` | record types 00–05, checksums, size limit; errors name the line |
| `readElfSymbols(bytes)` | symbol table of an AVR ELF32 file without external tools |
| `sha256Hex`, `encodeBase64`, `decodeBase64` | platform-independent, so server, worker and headless runner produce identical results |

Symbols: entry points of `pinMode`, `digitalWrite`, `digitalRead`,
`analogRead`, `analogWrite` (flash byte addresses; after LTO usually absent)
and `__data_end`, `__bss_end`, `_end`, `__heap_start`, `__brkval` as
data-space addresses (without the ELF offset 0x800000).

Board hardware IDs: `uno`, `nano`, `mega2560`, `attiny85`, mapped to the MCUs
`atmega328p`, `atmega2560`, `attiny85`.

## Tests

`npm run test:unit` in the repository root runs the Vitest project
`unit-emulator` (`packages/avr-emulator/tests/`); `npm run check` type-checks
the sources with the strict `tsconfig.json` (no Node or DOM types, so the code
stays usable in a Web Worker) and the tests with `tsconfig.test.json`. The
coverage guard requires
at least 90 % line coverage for `src/`.

## License

MIT, like UnoSim.
