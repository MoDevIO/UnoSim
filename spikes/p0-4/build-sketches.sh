#!/bin/sh
# Spike P0.4 – build each sketch twice: as UnoSim builds it (LTO) and as a
# reference without LTO, where the Arduino I/O functions keep their symbols.
# Usage: spikes/p0-4/build-sketches.sh <src-dir> <out-dir>
# <src-dir>/<name>/<name>.ino; results in <out-dir>/build and <out-dir>/build-nolto.
set -eu
SRC="$1"; OUT="$2"
mkdir -p "$OUT/build" "$OUT/build-nolto"
for dir in "$SRC"/*/; do
  name="$(basename "$dir")"
  arduino-cli compile --fqbn arduino:avr:uno --output-dir "$OUT/build/$name" "$dir" > "$OUT/build/$name.log" 2>&1
  arduino-cli compile --fqbn arduino:avr:uno --output-dir "$OUT/build-nolto/$name" \
    --build-property "compiler.c.flags=-c -g -Os -w -std=gnu11 -ffunction-sections -fdata-sections -MMD" \
    --build-property "compiler.cpp.flags=-c -g -Os -w -std=gnu++11 -fpermissive -fno-exceptions -ffunction-sections -fdata-sections -fno-threadsafe-statics -Wno-error=narrowing -MMD" \
    --build-property "compiler.S.flags=-c -g -x assembler-with-cpp -MMD" \
    --build-property "compiler.c.elf.flags=-w -Os -g -Wl,--gc-sections" \
    "$dir" > "$OUT/build-nolto/$name.log" 2>&1
done
