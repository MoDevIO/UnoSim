# Runtime reference corpus

Reference cases for the browser emulation (plan section 7.4 of
[browser-emulation-plan.md](../../../docs/proposals/browser-emulation-plan.md)).
Rules, classes and gates: [TESTING_STANDARDS.md](../../../docs/TESTING_STANDARDS.md).

```text
probes/<case>/            <case>.ino, case.json, expected.<board>.txt
examples-v3.0.0/<id>/     copy of an example of UnoSim-Examples (tag v3.0.0), case.json, expected.uno.txt
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
| `tolerances` | `{ pattern, plusMinus, reason }` for time values only; the capture groups of `pattern` hold the numbers that may deviate |

## Probes

| Case | Class | Checks | Basis |
|---|---|---|---|
| `data_types` | derived | sizes and limits of the AVR types | avr-gcc ABI, avr-libc |
| `int_overflow` | derived | wrap-around, division, remainder, shifts | two's complement arithmetic of the 16/32-bit operands |
| `float_math` | derived | float arithmetic and `Serial.print(float)` | `Print::printFloat` modelled in float32 |
| `parse_int` | derived | `Stream::parseInt` with skipped characters and leftovers | core source |
| `random_numbers` | derived | `randomSeed`/`random` sequences | Park-Miller generator of avr-libc |
| `millis_delay` | derived | `delay`, `delayMicroseconds`, `millis`, `micros` | timer 0 core (`wiring.c`) |
| `pwm_duty` | derived | `analogWrite` on all six PWM pins, 0 and 255 as digital, PWM → digital | `wiring_analog.c`, 8-bit PWM modes |
| `adc_read` | derived | `analogRead` against fixed voltages, DEFAULT and INTERNAL reference | datasheet formula `floor(Vin · 1024 / Vref)` |
| `pullup_input` | derived | `INPUT_PULLUP`, driven `INPUT`, outside level on an `OUTPUT` | datasheet 14.2.3 |
| `memory_layout` | derived | RAMEND, E2END, FLASHEND, placement of stack, heap and `.bss`, EEPROM access | datasheet, avr-libc |
| `memory_values` | regression | SP in `setup()`, end of `.bss`, free RAM of this build | emulator output, reviewed; to be replaced by a hardware recording |
| `serial_read_while_printing` | derived | serial input arriving while the sketch prints loses no character | datasheet 19.7.3 (RXC is cleared only by reading UDR); found an avr8js defect |

Cases of the class `hardware` are recorded once on a real board by a person
and are not part of this change; until then no case claims agreement with the
board.

## Examples

`examples-v3.0.0/` holds the 51 examples of [UnoSim-Examples](https://github.com/MoDevIO/UnoSim-Examples)
at tag `v3.0.0` (commit `bdd4c0a`), the sketch under the name `<id>.ino` and
headers next to it (`messung.h`, `mat_func.h`). The sketches are unchanged
copies; `case.json` and `expected.uno.txt` are new. On a new version of
UnoSim-Examples the directory is replaced together with its cases.

Every example has a stimulus script for what the example expects from the
simulator: slider values on A0 to A2 (`adcVolts`, chosen so that `analogRead`
returns a given value), levels on input pins, serial input, and `expectState`
checks for LED and PWM pins sampled in the middle of each phase.

| Class | Examples | Expectation |
|---|---|---|
| `derived` | 50 of 51 | worked out by hand from the sketch source, the 'Beobachtung' comment of the example and C++/avr-gcc semantics (16-bit `int`, truncating division); matrix results and the dice sequence of `it06-02` computed in Python; `Serial.print(float)` through the float32 model of `Print::printFloat` |
| `regression` | `it05-05-intervall-ohne-delay` | the pass count of `loop()` in 500 ms depends on the instruction timing of the build; emulator output, reviewed |

Time values carry tolerances where the example reads `millis()`
(`it03-07`, `it07-05`, `it08-01`, `it08-03`, `it08-05`), each with its reason in
`case.json`. Durations are kept short: examples with `delay(1000)` are run for
one or two passes only.

