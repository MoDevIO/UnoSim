# @unosim/avr-emulator

AVR emulation core of UnoSim, built on [avr8js](https://github.com/wokwi/avr8js)
(MIT, pinned to exactly 0.21.1). The package runs the flash image that
`arduino-cli` builds for a board: MCU profiles, board pin maps, peripherals,
timing and the event protocol to the UI.

Status: scaffold, simulation image, ATmega328P with Uno and Nano, ATmega2560 with Mega 2560, pin model with PWM, analog inputs, serial ports, timing and lifecycle, runtime I/O detection, diagnostics, event protocol, worker host (plan packages P1.1–P1.12, P5.1 and P5.2 of
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
| `UNO`, `NANO`, `MEGA2560`, `boardHardware(id)` | board pin maps as the pinned core numbers them: Arduino pin, label, port/bit, ADC channel, PWM timer channel, serial role; serial ports; `LED_BUILTIN`; clock and VCC |
| `ATMEGA328P`, `mcuProfile(id)` | flash, SRAM layout, EEPROM and the avr8js peripherals: ports B/C/D, timers 0–2, USART0, ADC (8 channels), EEPROM, watchdog, clock prescaler |
| `ATMEGA2560` | flash (256 KiB, 22-bit PC), SRAM 0x0200–0x21FF, 4 KiB EEPROM, ports A–L (without I) with INT0–INT7 and PCINT0–2, timers 0–5, USART0–3, ADC with 16 channels (MUX5), watchdog, clock prescaler; every peripheral has the vectors of the Mega, see below |
| `createMachine(loadedImage)` | CPU with the data space of the MCU (plan 4.3), its peripherals and the board |

| Board | MCU | Pins | PWM | Analog |
|---|---|---|---|---|
| `uno` | ATmega328P, 16 MHz | 0–19 (A0–A5 = 14–19) | 3, 5, 6, 9, 10, 11 | A0–A5 |
| `nano` | ATmega328P, 16 MHz | as Uno plus A6/A7 = 20/21, analog only | as Uno | A0–A7 |
| `mega2560` | ATmega2560, 16 MHz | 0–53 digital, A0–A15 = 54–69 | 2–13, 44–46 | A0–A15 |

On the Uno the ADC channels 6 and 7 have no pin and read 0 V. The Mega has
four hardware serial ports (`Serial` on pins 0/1, `Serial1` on 19/18,
`Serial2` on 17/16, `Serial3` on 15/14). ATtiny85 has an ID but no profile yet
(`boardHardware` throws).
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

While a timer drives an output pin with PWM, the snapshot carries `pwm`, the
duty cycle 0–255 from compare-output mode, waveform (TOP: 0xFF, 9/10 bit, ICR
or OCRA) and compare register, and `level` is the rounded mean level; edges
of the waveform are not reported. `analogWrite` with 0 or 255 switches the pin
digitally in the core and therefore shows as a plain output. `pwmDuty()`
computes the duty cycle from registers alone.

`snapshot()` lists all digital pins; `takeChanges()` returns the last state of
every pin that changed since the previous call plus the number of changes
(for the telemetry pin rate) and resets both.

### Analog inputs

`new AnalogInputs(machine)` sets the voltages of the analog pins.
`setAnalog(pin, value)` takes a slider value 0–1023 and applies
`(value + 0.5) / 1024 · VCC`, so `analogRead()` with the default reference
returns exactly that value; `setVolts(pin, volts)` sets a voltage directly.
The internal references (1.1 V on the ATmega328P) come from the datasheet;
AREF (`analogReference(EXTERNAL)`) is VCC unless `setArefVolts` changes it.

### Serial ports

`new SerialPorts(machine)` owns the hardware serial ports of the board (port
index 0 = `Serial`, from P5.3 also `Serial1`–`Serial3`):

- `takeOutput()` returns the text each port sent since the previous call,
  decoded as UTF-8 across byte and packet boundaries; a multi-byte
  character is delivered only when complete.
- `send(port, text)` queues UTF-8 bytes for the sketch. The queue hands the
  USART one byte per frame time while the sketch has the receiver enabled
  (`Serial.begin`); input that arrives while it is off is discarded, as on the
  chip, and reported as the diagnostic `serial-input-discarded`. The core's receive buffer behaves as
  on the board (64-byte ring buffer, at most 63 unread bytes, the rest is
  lost). Limits as in UnoSim: 4 KiB per message, 1 MiB pending per port
  (`SERIAL_INPUT_LIMITS`). The caller appends the line ending.
- `frameConfig(port)` reports baud rate (from UBRR and U2X), data bits,
  parity and stop bits.

`Utf8StreamDecoder` and `encodeUtf8` work without platform APIs.

### Emulator: timing and lifecycle

`new Emulator(loadedImage, { clock, timeoutMs, eeprom?, onStop? })` runs one
image with its pin model (`pins`), analog inputs (`analog`) and serial ports
(`serial`, output via `takeSerialOutput()`). Timing follows plan 4.7:

| Situation | Behaviour |
|---|---|
| simulated time | `cpu.cycles / clockHz`, resets included (`simTimeMs`) |
| behind the wall clock | slices of at most 8 ms (`sliceMs`) back to back; a backlog above 100 ms (`maxLagMs`) resets the wall-clock reference, no cycle is skipped |
| ahead of the wall clock | waits about 4 ms (`waitMs`) instead of computing on |
| `realTimeFactor` | simulated per wall time over the last 3 s of running |
| `pause()` / `resume()` | simulated time and `millis()` stop; serial input is refused while paused (`sendSerial` returns `false`), pins may be set |
| timeout | wall-clock run time without pauses (`wallTimeMs`); `onStop` gets both times |
| `reset()` | RESET button: a new machine from the same image, the run goes on; EEPROM content, outside pin levels, analog voltages and untaken serial output persist, serial input not yet received is lost |
| internal error | stops with reason `fault` |

`at(simMs, action)` schedules an action in simulated time; `advance(simMs)`
runs headless as fast as possible, without wall clock or timeout.
`systemClock()` uses `setImmediate` in Node and a `MessageChannel` in Web
Workers, so a busy emulator never starves timers; tests inject an artificial
clock (`RuntimeClock`).

### Runtime I/O detection

`emulator.usage` (`IoUsageObserver`, one per machine, also after `reset()`)
reports which Arduino I/O functions the sketch really used (plan 4.9, spike
P0.4 level R2). It hooks DDR, PORT, PIN, ADCSRA and the PWM timer registers
and decodes the accessing instruction; the run loop calls `usage.step()`
before each instruction only while `needsStep` is set. `takeUsages()` returns
the findings since the last call, `snapshot()` all of them.

- Only pin-exact findings: `{ pin, fn, mode? }` with `fn` one of `pinMode`
  (with `INPUT`, `OUTPUT` or `INPUT_PULLUP`), `digitalWrite`, `digitalRead`,
  `analogRead`, `analogWrite`. Each is reported once per pin and function, a
  `pinMode` again for a new mode.
- `analogWrite` does not count its internal `pinMode(OUTPUT)`; `analogWrite(0)`
  and `analogWrite(255)` are `digitalWrite`, as in the core.
- `digitalWrite` without level change is not pin-exact from the registers
  alone (IoRegistry SSOT case 7) and stays unreported, unless the image
  carries the symbol (`LoadedImage.symbols`, rare after LTO).

### Diagnostics

`emulator.takeDiagnostics()` returns the cases of plan P1.10 since the last
call, each with `simTimeMs`: `stack-overflow` (SP below `__bss_end`, or below
`__brkval` once `malloc` grew the heap), `pc-out-of-program` (erased flash),
`watchdog-reset`, `sleep-interrupts-disabled` and `serial-input-discarded`
(`{ port, bytes }`: serial input arrived while the receiver was off, i.e.
before `Serial.begin()`; sinngemäß for the UI: "Serial input discarded because
the receiver was not enabled yet (Serial.begin() has not run)"; reported once
per situation, again only after the receiver was enabled in between, never as
serial output). The stack check needs the
ELF symbol `__bss_end`. Stack and PC are checked at the end of every
4000-cycle chunk and on SPL writes; an overflow that returns in between goes
unnoticed (`PUSH`, `CALL` and interrupts change SP without a hook in avr8js).
A watchdog reset restarts the whole machine like the RESET button. Details
and limits: [ssot_function_definition_SimulationRuntime.md](../../ssot/ssot_function_definition_SimulationRuntime.md).

### Event protocol

`protocol/` holds the commands and events between UI and worker (plan 4.5):
`Command` and `WorkerEvent` types with `PROTOCOL_VERSION`, `parseCommand`
(validation of incoming messages, limits in `COMMAND_LIMITS`), `EventBatcher`
(about 60 packet groups per second, pins merged to the last state, serial text
joined per port, telemetry once per second, bounded memory) and `RunGate`
(UI side: `runId` per run, events of other runs discarded, state only after the
confirmation). The worker (P1.12) builds on these. See
[ssot_function_definition_SimulationRuntime.md](../../ssot/ssot_function_definition_SimulationRuntime.md).

### Worker host

`WorkerHost` (`{ clock, post }`) is the worker side of the protocol: it checks
commands, runs the `Emulator`, collects pins, serial text, usage and
diagnostics, bundles them with the `EventBatcher` and posts `RunEvent`s with
the run's `runId`. `installWorker(scope)` wires it to a Web Worker scope; the
package entry `@unosim/avr-emulator/worker` does so on the global scope when
imported inside a worker. Supervision from outside (deadlines, `terminate()`)
stays with the main thread (P3.2).

### Headless runner and tool

`runHeadless(image, { simMs, events, expectState })` runs an image as fast as
possible and returns serial text, pins, I/O findings, diagnostics, state checks
and the speed; stimuli and checks follow the `case.json` format of the
reference corpus (plan 7.4). `npm run emulate -- sketch.hex --ms 3000 --events
'[[500,"serial","42"],[1000,"pin",2,0]]'` prints the result; `--case`, `--elf`,
`--json` and `--repeat n` (median speed) are available. Format and exit codes:
[ssot_function_definition_SimulationRuntime.md](../../ssot/ssot_function_definition_SimulationRuntime.md).

## Tests

`npm run test:unit` in the repository root runs the Vitest project
`unit-emulator` (`packages/avr-emulator/tests/`); `npm run check` type-checks
the sources with the strict `tsconfig.json` (no Node or DOM types, so the code
stays usable in a Web Worker) and the tests with `tsconfig.test.json`. The
coverage guard requires
at least 90 % line coverage for `src/`.

## avr8js 0.21.1: corrections and known differences

- **Receive-complete flag** (`src/mcu/usart.ts`): avr8js clears a pending `RXC`
  flag on every write to `UCSRnB`; on the chip only reading `UDRn` does. The
  Arduino core writes `UCSR0B` with every `Serial.write`, so a byte that
  arrived while the sketch printed lost its interrupt and the next byte
  replaced it. `createUsart` restores the flag after such a write. Found by the
  reference corpus (`probes/serial_read_while_printing`).
- **Receive buffer:** the chip buffers two received bytes plus the shift
  register, avr8js one. A sketch that keeps interrupts disabled for longer than
  one frame time can lose a byte that the board would still deliver.
- **Input before `Serial.begin()`** (resolved): the emulator used to hold
  such input and deliver it later, where a real Uno loses it
  (`docs/proposals/results/p1-14/serial_before_begin`: `Serial.available()` 0
  on the board, 3 in the emulator). It now discards it like the chip and
  reports the diagnostic `serial-input-discarded`; the corpus case
  `probes/serial_before_begin` is recorded on the board.
- **Watchdog reset:** avr8js resets only PC and SP; see the diagnostics section.
- **ADC reference on the ATtiny85** (`src/mcu/attiny85.ts`): avr8js reads
  REFS2 at bit 3 of ADMUX, the ATtiny85 has it at bit 4 (bit 3 is MUX3). With
  `analogReference(INTERNAL2V56)` avr8js would measure against VCC (spike
  P0.5: 102 instead of 200 for 0.5 V). The profile reads REFS2 itself.
- **Shared interrupt registers on the ATtiny85:** INT0 and the pin-change
  interrupt share GIMSK and GIFR. avr8js hooks GIMSK only for INT0 and gives
  GIFR to the pin-change interrupt alone, so enabling PCIE did not raise a
  pending pin change and writing 1 to INTF0 did not clear INT0. The profile
  wraps both hooks.
- **Timer 1 PWM on the ATtiny85:** `ATtinyTimer1` models PWM mode as
  phase-correct counting and drives no OC1A/OC1B waveform when CTC1 is set,
  which is how ATTinyCore configures it for `analogWrite` on PB1/PB4. On the
  chip the counter runs from 0 to OCR1C either way, OC1x is set at 0 and
  cleared at OCR1x (COM1x = 01 or 10; inverted with 11). The profile drives
  OC1A/OC1B from the counter and replaces the phase-correct count by that
  sawtooth. Not modelled: the inverted outputs on PB0/PB3 of COM1x = 01.

## ATmega2560 profile

avr8js ships configurations for the ATmega328P only (spike P0.6: with them the
Mega prints nothing, its timer and USART interrupts jump to wrong vectors).
`src/mcu/atmega2560.ts` therefore takes only register addresses from avr8js
and sets its own vectors for every peripheral (two words per entry, vector
number n at word 2·n, from `avr/iomxx0_1.h` of the pinned toolchain):

- **Data space:** `new CPU(progMem, 0x2200 − 0x100)` so that SP starts at
  RAMEND 0x21FF; the avr8js default (8192) would put the stack outside.
- **Ports** A–L: avr8js' port configurations B, C and D carry the pin-change
  wiring of the 328P; the profile drops it (it would raise pin-change
  interrupts on the vectors of INT3 and INT4) and wires INT0–INT3 to PD0–PD3,
  INT4–INT7 to PE4–PE7, PCINT0 to port B, PCINT1 to PE0 and PJ0–PJ6 (offset 1
  in PCMSK1) and PCINT2 to port K.
- **Timers 0–2** with Mega vectors and comparator pins, **timers 3–5** as
  16-bit timers with channel C (`OCFnC`/`OCIEnC` at bit 3).
- **USART0–3**, each through `createUsart`; **ADC** with the vector 29, 16
  channels, `MUX5` (ADCSRB bit 3) for ADC8–15 and the reference selection
  AREF / AVCC / 1.1 V / 2.56 V; **EEPROM** ready and **watchdog** vectors.

Known differences (not modelled by avr8js): compare-match C interrupts of the
16-bit timers cannot be enabled through `TIMSKn` (the Arduino core never uses
them); sketches above 64 KB of PROGMEM may push the core's pin tables out of
the `lpm` range, as on the board (spike P0.6).

## ATtiny85 profile

`src/mcu/attiny85.ts` (plan P6.2, spike P0.5): one port (B), timer 0 with its
own registers and vectors, avr8js' `ATtinyTimer1`, a 4-channel ADC (ADC0–3 on
PB5, PB2, PB4, PB3; references VCC, AREF, 1.1 V, 2.56 V), 512 bytes EEPROM
with write times for 8 MHz, watchdog and clock prescaler; no USART (the core's
`Serial` is a software UART). Vectors have one word each (RJMP), vector n at
word n. Data space up to RAMEND 0x25F (`new CPU(progMem, 0x160)`). Tests:
`tests/attiny85-profile.test.ts` with the fixtures `attiny85-tiny_*.hex`.

Board hardware `ATTINY85_BOARD` (`src/boards/attiny85-board.ts`, P6.4): pins
0–5 = PB0–PB5, 8 MHz, `LED_BUILTIN` 1; A0–A3 are second names of pins 5, 2, 4,
3 (`analogName`); PWM on 0 (timer 0 A), 1 (timer 1 A) and 4 (timer 1 B), the
duty cycle of timer 1 read from TCCR1/GTCCR/OCR1x/OCR1C (`pwm.ts`); PB5 is
RESET; `Serial` is a serial port of kind `software` on 0 (TX) and 1 (RX), for
which `SerialPorts` creates a `SoftwareUart` (`setFallbackBaud` sets the rate
it uses until the line reveals the sketch's). Checked against
`variants/tinyX5/pins_arduino.h` in the toolchain gate.

## Software UART (ATtiny85)

`src/io/software-uart.ts` (plan P6.3): the ATtiny85 has no USART; ATTinyCore's
`Serial` (`TinySoftwareSerial`) sends on PB0 and receives on PB1 through the
analog comparator. `SoftwareUart` offers the members of `AVRUSART` that
`SerialPorts` uses (`onByteTransmit`, `writeByte`, `rxEnable`, `rxBusy`,
`baudRate`, …), so the ATtiny85 board can use the same serial port (P6.4).

- **TX:** edges of PB0 while it is an output and timer 0 does not drive it
  (OC0A). The baud rate is the largest standard rate of which at least 90 % of
  at least 8 in-frame edge distances are whole bit multiples (±20 %); the bit
  width is then averaged from them (the core's delay loop runs a few percent
  slow: 863 cycles per bit at 9600 baud and 8 MHz instead of 833). A start bit
  must still be low at its middle, so the pulses of the pin set-up are no
  bytes. Until the rate is found, an idle line (12 bit times) is decoded with
  `configuredBaud` (the Serial Monitor's).
- **RX:** `writeByte` drives PB1 bit by bit in simulated time; the comparator
  compares it with the bandgap (`ACBG`, as the core sets it) or AIN0 and
  raises its interrupt (vector 7) on the configured edge. The receiver counts
  as enabled while the comparator interrupt is enabled (`Serial.begin()`).
  ACME (ADC multiplexer as negative input) is not modelled.
- **Limits of the board, not of the model:** half duplex (the core disables
  interrupts while it sends, so input during output is lost); no reception
  when the sketch uses PB1 otherwise; no output on PB0 while it is PWM.

Tests: `tests/software-uart.test.ts` (9600 and 19200 baud, UTF-8, the
fallback rate, echo over the comparator, input refused before `Serial.begin()`,
synthetic waveforms) with the fixtures `attiny85-tiny_serial*.hex` and
`attiny85-tiny_echo.hex`.

## License

MIT, like UnoSim.
