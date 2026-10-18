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
the proposal (section 2). `uno-serial_probe.hex` and `uno-serial_overflow.hex` (`sketches/serial_*`)
expect the 1 s timeout of `Stream::parseInt` and 63 kept bytes from the
64-byte ring buffer of `HardwareSerial` (`derived` from the core).
`uno-adc_probe.hex` (`sketches/adc_probe/`) is checked against the datasheet
formula `floor(V / V_ref · 1024)`, at most 1023 (`derived`).
`uno-pwm_probe.hex` (`sketches/pwm_probe/`) expects the duty cycle to equal the
`analogWrite` value on all Uno PWM pins, because the core sets OCR to that
value in 8-bit PWM modes (derived from `wiring_analog.c`).
`uno-pin_probe.hex` is `sketches/pin_probe/` for the Uno; its expected outputs
follow from the sketch and the model assumptions of plan 4.8 (`regression`
until a hardware recording exists). A comparison of `memory_probe` with a real Uno is
still open (hardware).

The reproducible fixture set of the runtime corpus (plan 7.4) is separate.
