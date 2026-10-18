# ADR 0009: Browser emulation as runtime, host mock as fallback

- Status: Proposed
- Date: 2026-10-18
- Owners: UnoSim maintainers
- Plan: [browser-emulation-plan.md](../proposals/browser-emulation-plan.md)
  (decisions E1–E5, E7–E14, E16)
- Proposal: [browser-emulation.md](../proposals/browser-emulation.md)

> Draft. The decisions marked *pending spike* stay open until the named spike
> report exists; this ADR is accepted only after those reports and by the
> maintainers, not by an implementation session.

## Context

UnoSim checks a sketch with `arduino-cli` for the Uno but runs it as a native
g++ program linked against an Arduino mock, locally or in a Docker sandbox. Data
type sizes, overflow, float output, `Serial.parseInt()` timing, `random()`,
loop speed and memory limits therefore differ from a real board (see the user
guide section "Grenzen der Simulation"). The g++ host cannot provide a 16-bit
`int`, and each mock gap is a separate defect.

A prototype ran the real Uno HEX in avr8js and matched the board on every
probe of the proposal. Emulation costs roughly a quarter core per real-time run;
for the 70 concurrent simulations of the capacity model that is too much for
the server and little for each student's browser.

## Decision

1. **Cut (E1).** UnoSim keeps its UI, Tutor, Course Content, examples, gateway
   and tests and replaces the runtime: compiled sketches run as AVR machine
   code in a Web Worker in the browser.
2. **Scope (E2).** No wiring, breadboard or external parts in the simulation,
   and no connection to real boards (upload, WebSerial). Interaction stays as
   today: click board pins, analog sliders.
3. **Boards (E3).** Uno R3, Nano (ATmega328P), Mega 2560 and ATtiny85. All four
   are in a board catalog from the start (status `planned`) and become
   `preview` and `available` in the order Uno → Nano → Mega → ATtiny85.
   Spike P0.6 ([report](../proposals/spike-p0-6-mega2560.md)) ran the Mega
   2560 in avr8js with its own peripheral profile (Mega vectors for all
   timers, USARTs and the ADC; timers 3–5 and USART1–3 as configurations of
   the existing classes) and matched every probe; the Mega stays in scope.
4. **Package (E4).** The emulation core is the private workspace package
   `@unosim/avr-emulator` in `packages/avr-emulator/`. It imports nothing from
   UnoSim; `shared/` may import it. Its only runtime dependency is avr8js,
   pinned exactly. Moving it to its own repository is an optional follow-up.
5. **Delivery (E5).** A successful `POST /api/compile` returns an additional
   field `artifact`: the used flash range as Base64, board, SHA-256 and
   symbols. There is no separate download endpoint. Whether the artifact may
   be returned at all is decided by ADR 0010.
6. **IO registry and Tutor facts (E7).** The client registry merges static
   analysis and runtime findings per pin and function and records the origin
   (`static`, `runtime`, both) instead of replacing the static registry
   during a run, for both backends. Runtime findings come from observing I/O
   register access (avr8js `readHooks`/`writeHooks`), refined by decoding the
   accessing instruction (bit in SBI/CBI/SBIS/SBIC, single-bit mask from the
   neighbouring OR/AND/SBRS/SBRC). Only pin-exact findings enter the
   registry; port-only findings are not shown. ELF symbols of the I/O
   functions are optional: after LTO they exist in 1 of 62 builds. Spike P0.4
   ([report](../proposals/spike-p0-4-runtime-io.md)) found every executed
   pair of the 51 examples and IoRegistry SSOT cases 1–11 pin-exact except a
   `digitalWrite` without level change through the core's pin table. Line
   numbers come only from static analysis. Tutor facts stay static and
   receive the board as context.
7. **Pause, timeout and limits (E8).** The worker enforces them. Pause stops
   simulated time. The timeout stays wall-clock run time without pauses
   (1–300 s), so a run below real-time ends after less simulated time. The
   pause budget, simulation admission and the start rate limit apply only to
   the host mock.
8. **Fallback (E9).** The host mock stays available for the Uno, selectable
   through the offered backends (server) and the setting "Simulation engine"
   (user). Default: browser emulation in the local profile from milestone M1,
   in the Docker profile from M4.
9. **First milestone (E10).** All 51 examples of UnoSim-Examples `v3.0.0`
   match references recorded on a real Uno. An example without such a
   reference is listed in the acceptance and does not count as a hardware
   comparison.
10. **ATtiny core (E11).** ATTinyCore (SpenceKonde) 1.5.2, LGPL 2.1, FQBN
    `ATTinyCore:avr:attinyx5:chip=85,clock=8internal` with the other menu
    options at their defaults; same avr-gcc as `arduino:avr@1.8.8`. `Serial`
    is a software UART decoded at the TX pin (PB0); serial input runs through
    a model of the analog comparator on PB1. Spike P0.5
    ([report](../proposals/spike-p0-5-attiny85.md)) matched all derived
    expectations; risk: no ATTinyCore release since 2021.
11. **Real time (E12).** The worker paces to the wall clock. A slow device runs
    the simulation slower and shows the real-time factor. A backlog above
    100 ms is not caught up: the wall-clock reference is reset and emulation
    continues without skipping cycles. A worker ahead of time waits. Hidden
    tabs keep running. *Thresholds of the worker watchdog pending spike P0.3.*
12. **Board per sketch (E13).** The board is chosen per browser and workspace
    (localStorage). Examples may name a board (optional, default `uno`).
13. **Contracts (E14).** WebSocket `1.0.0` stays and serves only the host mock
    (new telemetry fields optional). REST becomes `1.1.0` additively (`board`,
    `artifact`), the iframe API `1.5.0` additively (board, pin range per
    board). The worker protocol is new, internal and versioned in the package.
14. **Branches and versions (E16).** v1.0.1 stays the reference for teaching,
    comparison and rollback. V2 is built in `feature/browser-emulation` through
    small PRs per work package; V1 fixes continue on `main` and are merged into
    the integration branch regularly, never rebased. Pre-releases
    `v2.0.0-beta.N` and `v2.0.0-rc.N`; after acceptance a merge to `main` and
    the tag `v2.0.0`.

## Consequences

- In the default path no native student code runs on the server; a browser run
  costs no server CPU, and the compile becomes the server's capacity limit.
- Sketches behave like on the board for the pinned toolchain, including
  undefined behavior such as signed overflow as the pinned avr-gcc compiles
  it. The user guide's deviation table shrinks to the model assumptions of the
  plan (section 4.8); the old table applies only to "Legacy".
- Pause also stops `millis()`; teaching material that relies on the current
  behavior has to be checked.
- Two runtime backends exist until a separate decision removes the host mock.
- The client needs a runtime interface, a worker watchdog and a merged IO
  registry; the board model has to be generalized beyond pins 0–19.
- The bundle gains a worker chunk; avr8js must not enter the initial load path.
