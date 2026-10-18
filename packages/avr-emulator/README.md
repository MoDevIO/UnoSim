# @unosim/avr-emulator

AVR emulation core of UnoSim, built on [avr8js](https://github.com/wokwi/avr8js)
(MIT, pinned to exactly 0.21.1). The package runs the flash image that
`arduino-cli` builds for a board: MCU profiles, board pin maps, peripherals,
timing and the event protocol to the UI.

Status: scaffold, simulation image, ATmega328P with Uno and Nano, pin model (plan packages P1.1–P1.4 of
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

### Boards, MCU profiles, machine

| Export | Purpose |
|---|---|
| `UNO`, `NANO`, `boardHardware(id)` | board pin maps as the pinned core numbers them: Arduino pin, label, port/bit, ADC channel, PWM timer channel, serial role; serial ports; `LED_BUILTIN`; clock and VCC |
| `ATMEGA328P`, `mcuProfile(id)` | flash, SRAM layout, EEPROM and the avr8js peripherals: ports B/C/D, timers 0–2, USART0, ADC (8 channels), EEPROM, watchdog, clock prescaler |
| `createMachine(loadedImage)` | CPU with the data space of the MCU (plan 4.3), its peripherals and the board |

| Board | MCU | Pins | PWM | Analog |
|---|---|---|---|---|
| `uno` | ATmega328P, 16 MHz | 0–19 (A0–A5 = 14–19) | 3, 5, 6, 9, 10, 11 | A0–A5 |
| `nano` | ATmega328P, 16 MHz | as Uno plus A6/A7 = 20/21, analog only | as Uno | A0–A7 |

On the Uno the ADC channels 6 and 7 have no pin and read 0 V. Mega 2560 and
ATtiny85 have IDs but no profile yet (`boardHardware` throws).
`tests/integration/avr-emulator-board-pinmap.test.ts` (toolchain gate) checks
the pin maps against `pins_arduino.h` of `arduino:avr@1.8.8`.

### Pin model

`new PinModel(machine)` tracks the digital pins of the board with the model
assumptions of plan 4.8:

| Situation | Model |
|---|---|
| open input (`INPUT`, not driven) | reads LOW |
| `INPUT_PULLUP` | reads HIGH until driven LOW from outside |
| level driven from outside (`setDigital(pin, level)`) | holds until the sketch makes the pin an OUTPUT, then it is dropped; ignored while the pin is an OUTPUT (`setDigital` returns `false`) |
| analog-only pins (Nano A6/A7) | not digital pins; `setDigital` and `state` throw |

`snapshot()` lists all digital pins; `takeChanges()` returns the last state of
every pin that changed since the previous call plus the number of changes
(for the telemetry pin rate) and resets both.

## Tests

`npm run test:unit` in the repository root runs the Vitest project
`unit-emulator` (`packages/avr-emulator/tests/`); `npm run check` type-checks
the sources with the strict `tsconfig.json` (no Node or DOM types, so the code
stays usable in a Web Worker) and the tests with `tsconfig.test.json`. The
coverage guard requires
at least 90 % line coverage for `src/`.

## License

MIT, like UnoSim.
