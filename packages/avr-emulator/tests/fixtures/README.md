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

The reproducible fixture set of the runtime corpus (plan 7.4) is separate.
