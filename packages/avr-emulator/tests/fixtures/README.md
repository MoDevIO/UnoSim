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
the proposal (section 2). A comparison of `memory_probe` with a real Uno is
still open (hardware).

The reproducible fixture set of the runtime corpus (plan 7.4) is separate.
