# @unosim/avr-emulator

AVR emulation core of UnoSim, built on [avr8js](https://github.com/wokwi/avr8js)
(MIT, pinned to exactly 0.21.1). The package runs the flash image that
`arduino-cli` builds for a board: MCU profiles, board pin maps, peripherals,
timing and the event protocol to the UI.

Status: scaffold, simulation image, ATmega328P with Uno and Nano, pin model with PWM, analog inputs, serial ports, timing and lifecycle, runtime I/O detection, diagnostics, event protocol, worker host (plan packages P1.1–P1.12 of
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
  USART one byte per frame time once the sketch enabled the receiver
  (`Serial.begin`); earlier input waits. The core's receive buffer behaves as
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
`watchdog-reset` and `sleep-interrupts-disabled`. The stack check needs the
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

## Tests

`npm run test:unit` in the repository root runs the Vitest project
`unit-emulator` (`packages/avr-emulator/tests/`); `npm run check` type-checks
the sources with the strict `tsconfig.json` (no Node or DOM types, so the code
stays usable in a Web Worker) and the tests with `tsconfig.test.json`. The
coverage guard requires
at least 90 % line coverage for `src/`.

## License

MIT, like UnoSim.
