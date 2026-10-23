# Test fixtures

Built once with `arduino-cli` 1.5.1 and `arduino:avr@1.8.8` for
`arduino:avr:uno` from UnoSim-Examples `v3.0.0`
`examples/IT03/it03-04-led-blinken.ino`. The unit gate needs no toolchain;
these files are inputs, not expectations.

| File | Origin |
|---|---|
| `uno-blink.hex` | `arduino-cli compile --fqbn arduino:avr:uno --output-dir out <sketch>` → `<sketch>.ino.hex` (with LTO, as UnoSim builds) |
| `uno-blink.elf` | the matching `<sketch>.ino.elf`, `avr-objcopy --strip-debug` |
| `uno-blink-nolto.elf` | the same sketch built without LTO (build properties as in `spikes/p0-4/build-sketches.sh`), `avr-objcopy --strip-debug`; keeps the symbols `pinMode` and `digitalWrite` |

Expectations derived independently with the toolchain:
`avr-objcopy -I ihex -O binary uno-blink.hex` gives 932 bytes with SHA-256
`08ca27a87a1a5a0ecaf805be862333766f2fba5328f086089d123b4144cf776f`;
`avr-nm` lists `__bss_end` and `_end` at `0x800109` in both ELF files and
`digitalWrite` at `0x12a`, `pinMode` at `0x1c2` in `uno-blink-nolto.elf`.

`<board>-<sketch>.hex` are `arduino-cli compile` outputs of `sketches/<sketch>/`
for `uno` (`arduino:avr:uno`) and `nano` (`arduino:avr:nano:cpu=atmega328`),
same toolchain. Derived expectations: RAMEND 0x8FF and E2END 1023 from the
datasheet, `__bss_end` 0x800210 for `memory_probe` from `avr-nm`, ADC values
`floor(V / 5 · 1024)`; `int_probe` outputs are those measured on a real Uno in
the proposal (section 2). `uno-delay_probe.hex` and `uno-tick_probe.hex` (`sketches/delay_probe`,
`sketches/tick_probe`) check `delay(587)` against the 586–587 ms measured on a
real Uno (proposal section 2) and print `<n> <millis>` every 10 ms.
`uno-ssot_tc01…11.hex` (`sketches/ssot/`) are the IoRegistry-SSOT cases 1–11 of spike P0.4; `uno-ssot_tc07-nolto.hex/.elf` is case 7 without LTO (symbols for pin-exact `digitalWrite`). `uno-io_analog_write.hex` and `uno-io_analog_edges.hex` (`sketches/io_analog_*`) check `analogWrite` against its `digitalWrite` shortcut for 0 and 255 (`derived` from the core).
`uno-serial_probe.hex` and `uno-serial_overflow.hex` (`sketches/serial_*`)
expect the 1 s timeout of `Stream::parseInt` and 63 kept bytes from the
64-byte ring buffer of `HardwareSerial` (`derived` from the core).
`uno-diag_*.hex` (`sketches/diag_*`) provoke the diagnostics of P1.10: stack into `.bss` and into the heap (with the stripped `uno-diag_stack_*.elf`; `avr-nm`: `__bss_end` 0x361 and 0x113, `__brkval` 0x10f), a modest recursion as negative case, a jump into erased flash, a 15 ms watchdog reset and `sleep` with and without `sei()` (`derived`).
`uno-adc_probe.hex` (`sketches/adc_probe/`) is checked against the datasheet
formula `floor(V / V_ref · 1024)`, at most 1023 (`derived`).
`uno-pwm_probe.hex` (`sketches/pwm_probe/`) expects the duty cycle to equal the
`analogWrite` value on all Uno PWM pins, because the core sets OCR to that
value in 8-bit PWM modes (derived from `wiring_analog.c`).
`uno-pin_probe.hex` is `sketches/pin_probe/` for the Uno; its expected outputs
follow from the sketch and the model assumptions of plan 4.8 (`regression`
until a hardware recording exists). A comparison of `memory_probe` with a real Uno is
still open (hardware).

`mega2560-mega_probe.hex`, `mega2560-mega_interrupts.hex` and `mega2560-mega_io.hex`
(`sketches/mega_*`, `arduino:avr:mega:cpu=atmega2560`, same toolchain) check the
ATmega2560 profile. `mega_probe` is the sketch of spike P0.6 (four serial ports,
PWM on timers 0/2/3/5, `analogRead` of A0 and A15 through MUX5, RAMEND 0x21FF;
expectations `derived` from the core and the datasheet); `mega_interrupts`
counts the edges delivered to INT0–INT5 and PCINT0–2; `mega_io` uses pins on
the ports with extended I/O addresses (H, J, K, L).

The reproducible fixture set of the runtime corpus (plan 7.4) is separate.
`uno-eeprom_counter.hex` (`sketches/eeprom_counter`) prints EEPROM cell 0 and stores the next value; the worker keeps the EEPROM per board between runs (a run sees what the run before wrote, 255 on the first).

`attiny85-tiny_probe.hex`, `attiny85-tiny_interrupts.hex` and
`attiny85-tiny_watchdog.hex` are `sketches/tiny_*/` built with ATTinyCore 1.5.2
(`ATTinyCore:avr:attinyx5:chip=85,clock=8internal`, `scripts/install-attinycore.sh`),
same `arduino-cli` and avr-gcc. They write their results to EEPROM, so the
profile tests need no software-UART decoder. Derived expectations: RAMEND
0x25F from the datasheet; `delay(587)` measured by `millis()` 585–589 ms
(each reading lags by up to one timer-0 overflow, 2.048 ms at 8 MHz and
prescaler 64); ADC `floor(V / V_ref · 1024)`; timer-0 fast PWM duty
`(OCR0A + 1) / 256`; boots counted after 15 ms watchdog resets with WDRF in MCUSR.
`attiny85-tiny_serial.hex` (the `Serial` probe of spike P0.5), `attiny85-tiny_echo.hex`,
`attiny85-tiny_serial_19200.hex` and `attiny85-tiny_serial_ff.hex` (`sketches/tiny_*`,
same toolchain) check the software UART: outputs as measured in the spike,
`parseInt` echo, baud detection at 19200 and the fallback rate for a byte
0xFF (`derived`).
