# Runtime reference corpus

Reference cases for the browser emulation (plan section 7.4 of
[browser-emulation-plan.md](../../../docs/proposals/browser-emulation-plan.md)).
Rules, classes and gates: [TESTING_STANDARDS.md](../../../docs/TESTING_STANDARDS.md).

```text
probes/<case>/            <case>.ino, case.json, expected.<board>.txt
hex/<board>/<case>.hex    precompiled for the unit gate
```

Toolchain of all fixtures: `arduino-cli` 1.5.1, `arduino:avr@1.8.8`,
`arduino:avr:uno` (Nano: `arduino:avr:nano:cpu=atmega328`), as UnoSim compiles
(with LTO). `npm run fixtures:runtime` rebuilds `hex/`; `npm run
fixtures:runtime -- --check` compares a rebuild with the checked-in files.

## `case.json`

| Field | Meaning |
|---|---|
| `board` | `uno`, `nano`, … (a board id of the package) |
| `simMs` | simulated duration; serial output must have left the UART by then |
| `provenance` | `hardware`, `derived` or `regression` |
| `basis` | how the expectation was obtained (the independent source for `derived`) |
| `recordedOn` | board and revision, required for `hardware` |
| `toolchain` | toolchain the expectation holds for |
| `description` | what the case checks |
| `events` | stimuli: `[ms, "serial", text]`, `[ms, "pin", pin, level]`, `[ms, "adcVolts", channel, volts]` |
| `expectState` | state checks: `[ms, "pin", pin, mode, level]`, `[ms, "pwm", pin, duty]`, `[ms, "adcRaw", channel, value]` |
| `tolerances` | `{ pattern, plusMinus, reason }` for time values only; `pattern` has one capture group holding the number |

## Probes

| Case | Class | Checks | Basis |
|---|---|---|---|
| `data_types` | derived | sizes and limits of the AVR types | avr-gcc ABI, avr-libc |
| `int_overflow` | derived | wrap-around, division, remainder, shifts | two's complement arithmetic of the 16/32-bit operands |
| `float_math` | derived | float arithmetic and `Serial.print(float)` | `Print::printFloat` modelled in float32 |
| `parse_int` | derived | `Stream::parseInt` with skipped characters and leftovers | core source |
| `random_numbers` | derived | `randomSeed`/`random` sequences | Park-Miller generator of avr-libc |
| `millis_delay` | derived | `delay`, `delayMicroseconds`, `millis`, `micros` | timer 0 core (`wiring.c`) |

Cases of the class `hardware` are recorded once on a real board by a person
and are not part of this change; until then no case claims agreement with the
board.
