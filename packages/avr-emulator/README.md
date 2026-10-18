# @unosim/avr-emulator

AVR emulation core of UnoSim, built on [avr8js](https://github.com/wokwi/avr8js)
(MIT, pinned to exactly 0.21.1). The package runs the flash image that
`arduino-cli` builds for a board: MCU profiles, board pin maps, peripherals,
timing and the event protocol to the UI.

Status: scaffold (plan package P1.1 of
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

## Tests

`npm run test:unit` in the repository root runs the Vitest project
`unit-emulator` (`packages/avr-emulator/tests/`); `npm run check` type-checks
the package with its own strict `tsconfig.json`. The coverage guard requires
at least 90 % line coverage for `src/`.

## License

MIT, like UnoSim.
