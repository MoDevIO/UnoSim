# Changelog

All notable changes to UnoSim. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Changed

- **Tutor panel focuses on the current question** (LearningQuestions 10.7–10.9):
  the question, the feedback that belongs to it and the answer field stand
  together; **Senden** is the one primary action. The help (question mark at
  the answer field) opens on demand without a request and offers only the
  actions the server allows now; the unlock rules are one click away. Ratings,
  the session average and the teacher's-focus progress moved to **Verlauf**;
  key, model and difficulty to **⋯ → Einstellungen**; **⋯ → Neue Lernrunde
  starten** replaces the header question mark. The Tutor toggle and panel use
  a graduation cap. Failures keep the draft and offer a matching action
  (**Erneut versuchen**, **Modell wählen**, **Zugang prüfen**). The Tutor
  speaks German throughout. The learning step loads with the Tutor column.
- **Tutor: deliberate step to the next question, stars at the feedback**
  (LearningQuestions 10.7): an answer that closes its question keeps it shown
  with the answer, the feedback and its stars; **Weiter zur nächsten Frage**
  (focused, no request, nothing counted again) shows the next one. A weak
  answer keeps the question editable. **Erneut versuchen** repeats exactly the
  failed request, with its code, answer and action id; after an edit of code or
  draft it is no longer offered and **Senden** sends the current inputs.
- **Tutor feedback takes up a recurring misunderstanding** (LearningQuestions
  R-SUP-9): weak earlier attempts at the asked question reach the model apart
  from the rated history, without their rating, so the feedback can name the
  misunderstanding instead of repeating a hint; a correct observation of the
  sketch is acknowledged and a differing question assumption named. Prompt
  revision v9; the evaluation corpus v14 adds the IT06.1 case
  (`TQ-SUP-IT061-*`).

- **Colors follow one contract** (`client/src/STYLE_GUIDE.md`): red means
  error. Delete File, its confirmation and the serial, compiler and debug clear
  actions are neutral; labels and the confirmation stay. One primary color for
  Start, the Tutor's main actions, Done and the mobile selection, readable at
  4.8:1 (before 2.2:1 to 3.4:1); Stop has its own run color (5.0:1). The TX
  badge, active pins on the board (now amber) and the second plot series are no
  longer red. Telemetry labels are gray, dropped serial bytes and the legacy
  engine use the warning color. Toolbar icons (workspace toggles, output
  toolbars) hover on a neutral surface, so an active icon stays readable. Gates:
  a color-contract unit test and a browser contrast test.
- **Tutor feedback stays in view:** after an answer that closed its question
  the column shows the stars and the start of the feedback, Weiter stays as a
  bar at the bottom; while the floating navigation is shown (phone, and tablet
  with the Tutor) no text and no button lies under it. A
  weak answer to changed code keeps the question open (the server now says
  whether an answer closed its question).

### Added

- **Tutor evaluation: turn-level reveal literals.** A multi-step case can
  forbid naming the solution before the correct answer while its last turn
  confirms it; IT06.1 uses this (corpus v15).
- **E2E on another port:** `E2E_PORT` runs the Playwright test server on a
  chosen port; the iframe test follows it.

- **Tutor learning support** (LearningQuestions 3.10): besides answering, the
  learner can have the question explained or ask for a hint at any time; after
  two explanations the question may be skipped, after three own answers a
  reviewed reference answer with explanation can be requested. None of these
  is rated or counts as understanding. The server keeps the counters, so a
  retry or a parallel request does not count twice. Course content can add
  reference answers with annotation and Topic `schemaVersion: 3`; a reference
  applies only while the learner's program and board are exactly the reviewed
  ones, apart from the initial value the question itself sets.
- **Tutor model choice for operators:** `UNOSIM_TUTOR_AUTO_MODELS` names the
  exact models **Automatic** may use, in order (default `openai-gpt5.5`, the
  only model that passed the live comparison); **Automatic** never falls back
  to another model and instead asks the learner to choose one manually. No
  model family is preferred by the application, and embedding models are
  never chosen. The
  key view names the model of the last answer. `openai-gpt5.5`, which accepts
  only temperature 1, now receives that value and can be used with the Tutor.
- **Tutor quality evaluation over HTTP:** corpus cases with
  `transport: http` replay the learning-support dialog over the Tutor routes
  and report application, raw-model and technical results apart.

- I/O Registry now has **Programmed Pins (n)**, **All Pins**, and **Pin Infos**
  tabs. The usage views retain runtime provenance, conflict markers, and
  file-aware source links with the shared eye-button state. Pin Infos provides
  a searchable reference for all four boards with one bus column, nine
  columns, and a single sticky header and Pin column. RESET/analog-only/core
  restrictions and nonprogrammable reference contacts remain explicit;
  hardware bus capability is distinguished from simulation support.
- Usage-row RX/TX and PWM markers now follow the selected board, including
  the ATtiny software UART directions and all four Mega serial ports.

### Fixed

- **Format Code shows the program's structure** (SSOT CodeFormatting): the
  statement after a brace-less `if`, `else`, `for`, `while` or `do` is indented
  one level deeper, nested ones further, and `else` stays with the `if` it
  belongs to. Braces, semicolons and keywords in strings, character literals,
  raw strings, comments and preprocessor lines no longer count as structure,
  and their text stays unchanged; line continuations (backslash at the line
  end) are read as the compiler reads them. No braces are added; the built-in
  examples compile to the same HEX before and after formatting. The fallback without an
  editor uses the same formatter, and Undo restores the text before formatting
  even right after typing.
- **Menus reopen reliably:** a click on a menu's trigger while the menu just
  closed still faded out opened it and closed it again at once (for example the
  Tutor's **⋯** after **Einstellungen** and back).
- **Tutor: answers to a question that sets its own values are graded with
  those values.** Example IT06.4 asks what the first loop pass prints when `a`
  is 200 while the sketch starts with `a = 37`; the correct answer `1` could be
  called wrong. The grading now uses the question's values, and a reviewed
  reference answer corrects a contradicting rating.

- **The page no longer crashes with "Maximum update depth exceeded"** when a
  sketch prints without `delay()` and the run is paused, resumed or stopped
  with the debug log on. Emptying the incoming message queue raced with
  messages still arriving, so after a Stop the same messages were handled
  again in a loop; the queue now hands each message over exactly once.
- **Legacy: pause halts `millis()` and `micros()` without a jump.** After a
  resume the clock went on from a value that still contained the paused time
  and then dropped back (with a 500 ms pause: `223, 833, 343`). The runtime
  now freezes its clock before the server stops the process, and goes on from
  the frozen value after the resume.
- **Legacy: a pause no longer shortens `delay()` and `delayMicroseconds()`.**
  They slept in wall-clock time, so the paused time counted as waiting: a
  `delay(1000)` cut by a pause could end after 169 ms of `millis()`. They now
  wait in simulated time and go on with their remaining time after a resume.

## v2.0.0-beta.1 – 2026-10-24

First pre-release of version 2 from the integration branch `feature/browser-emulation`
for a pilot instance next to the V1 instance (plan 9.2). Version 2 runs the compiled sketch in the browser instead of on the server and
adds the Arduino Nano, the Arduino Mega 2560 and the ATtiny85 as preview
boards. Contracts: REST API `1.1.0` (additive, `1.0.0` clients stay
supported), WebSocket `1.0.0` (unchanged; serial messages may carry an optional
`port`), embedding API (`postMessage`) `1.5.0` (additive). The decisions are
drafted in ADR 0009 and ADR 0010 (`Proposed`).

### Behaviour changes for teaching

Check slides and exercises against these points; the user guide section
"Grenzen der Simulation" describes the model, "Legacy" keeps the former
behaviour for the Uno.

- **Data types are those of the board:** `int` has 16 bit (`32767 + 1` is
  −32768, formerly 32768), `long` 32 bit, `double` is the 32-bit `float`,
  `sizeof(int)` is 2.
- **`Serial.print(2.5)` prints `2.50`** (two decimals without a precision
  argument), as on the board; formerly `2.5`.
- **`Serial.parseInt()` without input waits one second** (the stream timeout)
  and then returns 0; formerly it returned at once.
- **Speed is the board's:** `loop()` runs as often per second as on a 16 MHz
  board (ATtiny85: 8 MHz); counters in `loop()` without `delay()` reach other
  values than before.
- **Memory is the board's:** 2 KB SRAM on the Uno and Nano; a large array can
  crash the sketch as on the board. UnoSim reports a stack that grows into the
  globals or the heap, but not every memory error.
- **`random()` gives the Uno's sequence.**
- **Pause halts `millis()`.**
- **An open input (`INPUT`) reads LOW**, `INPUT_PULLUP` reads HIGH until a
  level is set at the board.
- **Serial input sent before `Serial.begin()` is lost** as on the board; a
  system line reports it.
- **The run time counts wall-clock time:** on a device slower than real time
  (real-time factor below 1 in the header) a 30-second run ends after less
  simulated time.
- **EEPROM content stays per board while the tab is open**; a reload starts
  with an erased EEPROM.

### Upgrade notes for operators

- **Three images** from the same commit: `unosim-server`, `unosim-sandbox`
  (host mock) and the new `unosim-compile-sandbox`; `npm run build:sandbox`
  builds both sandbox images. In the Docker profile every compile runs
  `arduino-cli` in its own container without network; the backend image no
  longer contains `arduino-cli` or `g++` (1.62 GB → 726 MB). The backend
  checks the compile sandbox image at startup.
- **New variables** (Compose passes them from `.env`; empty means default):
  `UNOSIM_RUNTIME_BACKENDS` (`browser`, `host-mock`), `UNOSIM_DEFAULT_RUNTIME`,
  `UNOSIM_BOARDS`, `UNOSIM_DEFAULT_BOARD`. `ARDUINO_FQBN` remains as an alias
  for the default board and is deprecated.
- **Docker profile default stays the host mock** until the release is accepted;
  a pilot instance sets `UNOSIM_DEFAULT_RUNTIME=browser` (INSTALL_SERVER.md,
  "Browser-Emulation im Docker-Profil (Pilot)"). Without the browser backend only the Uno is offered.
- **Return to V1** works with the unchanged `.env` and `storage/`
  (INSTALL_SERVER.md, "Update und Rollback").
- **Local installations** need ATTinyCore 1.5.2 for the ATtiny85:
  `sh scripts/install-attinycore.sh` (INSTALL_LOCAL.md).
- `npm run capacity:calibrate` measures compile capacity as well
  (CAPACITY_MODEL.md, "Compile capacity").

### Added

- **Tools → Board** with the Arduino Nano (A6/A7 as analog-only inputs), the
  Arduino Mega 2560 (pins 0–69, four serial ports with a port bar in the
  Serial Monitor) and the ATtiny85 (ATTinyCore 1.5.2, 8 MHz, `Serial` as a
  half-duplex software UART), each with its own board view and with warnings
  for its pins. The choice is kept per browser; a change stops the run.
- **Examples can name their board**; loading one for another board asks first.
- **Diagnostics** in the Serial Monitor: stack collision, program counter
  outside the program, watchdog reset, `sleep` with interrupts disabled.
- **Debug bar:** engine (`BROWSER` or `LEGACY`) and real-time factor.
- **I/O Registry** keeps the static entries during a run and marks what the
  run confirmed ("+ runtime").
- **Tutor** questions name the board; the Tutor knows its data type sizes.
- **Embedding API `1.5.0`:** `GET_STATE` with board, runtime and serial ports;
  pins are checked against the selected board; `SERIAL_INPUT` and serial
  events carry the port.

### Changed

- **E2E startup:** Playwright rebuilds the application before starting its own
  test server, so local pipeline runs use the current client and board artwork.
- **Mega board artwork:** uses the supplied illustration, with contact-aligned
  pin targets, LEDs and reset. The duplicate SDA/SCL sockets share D20/D21.
- **Nano board artwork:** uses the supplied illustration, with all 22 signal
  contacts, four LEDs and reset aligned to the drawing; A6/A7 remain analog-only.
- **ATtiny85 artwork:** shows a bare DIP-8 chip with metal leads, package notch
  and pin-1 mark. The carrier, external LEDs, reset switch and board logo are
  removed; pin input and the existing reset controls remain available.
- **Board size hierarchy:** a shared display area presents Mega at 125 %, Uno
  at 100 %, Nano at 85 % and ATtiny at 65 % relative width. Compact panels
  soften the differences while preserving the order and overlay alignment.
- **PWM pin markings:** Mega, Nano and ATtiny now show `~` next to their PWM
  pin labels, following the Uno convention and the board's hardware profile.
- **Board readability:** ATtiny pin subtitles are larger and have more
  contrast; Mega and Nano reset caps use the Uno's dark-red colours.
- **Sketches run in the browser by default** (local profile): the compiled
  machine code runs in an emulator of the board's microcontroller (avr8js in a
  Web Worker). A started run keeps going when the connection to the server is
  lost. File → Settings → "Simulation engine" switches to "Legacy" (the former
  server-side simulation, Uno only).
- `POST /api/compile` returns the flash image as `artifact` (REST `1.1.0`);
  the HEX file never leaves the server.

### Fixed

- The serial input field could not be typed into while it was empty.
- A sketch printing without pause (`Serial.println(millis())`) froze the
  browser; the Serial Monitor keeps the last 40 000 characters.
- The editor keeps the indentation on Enter, indents after `{` and closes
  brackets and quotes.
- On phones the panel navigation covered pins of the board view.
- The ATtiny85 drives the PWM signal of timer 1 on PB1 and PB4.
- A hidden browser tab no longer ends a run as "stopped responding".
- **The Tutor knows the board and the whole project:** it receives the selected
  board and the header files (whatever tab is open) and reads pins as that
  board has them; on the ATtiny85 `LED_BUILTIN` was taken as pin 13 instead
  of 1. `/api/tutor/question` and `/api/tutor/dialog` accept `headers` and
  `entryFile` like `POST /api/compile` (REST `1.1.0`, additive).
- The I/O Registry merges runtime findings per pin of the board: on the Mega
  2560 a finding of `A0` landed on digital pin 14.
- A browser run shows `running` or `paused` only once the emulator confirmed
  it; a pause sent right after the start no longer shows "paused" while the
  sketch runs on.
- A cached compile result is served only under the toolchain and libraries it
  was built with.
- Stop, a loaded example, replaced files, `LOAD_CODE` or a board change end a
  browser start that is still loading the emulator; before, the run could begin
  afterwards, with a build that was already discarded.
- The Tutor's topic selection and follow-up decision read the header files of
  the project as well, not only the entry file.
- **Security:** oversized arrays of invalid elements in a request (headers,
  libraries, Tutor history, example and curriculum lists) are refused with one
  check of their length instead of one issue per element; a 1 MiB body no
  longer costs several hundred MiB and up to a second of blocked event loop.
  Responses are unchanged.
- **Security:** a sketch of unterminated block comments (96 KB took 6.6 s) or of
  array declarations without closing bracket (1.3 s) no longer holds the server;
  the comment scan and the Tutor's array facts are linear.
- A quick Stop and Start no longer lets the late stop confirmation switch off
  the start supervision of the new run, and a worker that does not confirm a
  stop ends together with the start that waits behind it.
- **Security:** a client can no longer make the server validate the content of
  server events: the direction of a WebSocket message is decided by its type
  first (before, a 256 KiB message of empty `pin_state_batch` entries cost
  240 000 issues and about 100 MiB of heap).
- The late answer of a standalone Compile no longer shows the errors of the old
  project after another project was loaded.
- Resume works offline for a paused browser run (the button was disabled once the
  client had noticed the missing server).
- **Security:** body-parser 1.20.9 (a compressed request with trailing bytes
  could end the process with an uncaught exception, GHSA-27r3-jxmh-p828) and
  ip-address 10.7.5 (quadratic matching of a zone identifier, used by the rate
  limiter).
- An edit while a browser run is starting (waiting for the worker's
  confirmation) stops it; before, the confirmation started the old source.
- Opening another tab, for example a header, no longer stops a running
  simulation: only an edit of a file does.

## v1.0.1 – 2026-10-18

Bug-fix release covering #239–#252. The REST API and the WebSocket protocol
still report version `1.0.0`; the embedding API (`postMessage`) stays at
`1.4.0`. The examples catalog `UnoSim-Examples` `v3.0.0` needs this release
(IT08.4, IT11 and the pull-up observations in IT03.6/IT04.4).

### Upgrade notes for operators

- **Prepare the runtime directories once** if you run Compose manually:
  `sudo ./scripts/prepare-runtime-dirs.sh` hands `server/arduino-cache`,
  `temp` and `storage` to the container user (UID/GID 1000). Without it,
  compiles fail with `EACCES` on hosts where these directories belong to
  another user. The Ubuntu/VBox installer runs the script itself.
- **`capacity.env` values now take effect.** Compose forwards
  `SIMULATION_QUEUE_TIMEOUT_MS` and reads `SIMULATION_MAX_CONCURRENT` from
  `.env` (default unchanged: 200). Recreate the backend container after
  changing `.env` and check the values under `/api/status` → `capacity`.
- **No third-party hosts any more.** Fonts are bundled and the Content
  Security Policy no longer allows `replit.com` or Google Fonts. A proxy or
  firewall rule for those hosts is no longer needed.
- Point students to the new section "Grenzen der Simulation" in the user
  guide.

### Fixed

- **Tutor keeps answering while GitHub is unavailable.** When the Course
  Content source cannot be refreshed (outage, rate limit or load limit), Tutor
  questions and dialogs fall back to the free Tutor without a Course Content
  session instead of failing with `INVALID_REQUEST` (Course Content SSOT §11,
  case G).
- **Sketches with `typedef` types, constant array sizes or default arguments
  in function signatures run.** The generated function prototypes now sit
  directly before the first function the sketch defines, without default
  arguments, as in the Arduino IDE. Before, they stood at the top of the
  file, so `Vektor add(Vektor a, Vektor b)`, `void f(double m[M][N])` and
  `void f(byte precision = 2)` compiled with the Arduino compiler but failed
  in the simulation.
- **An open `INPUT_PULLUP` pin reads `HIGH`.** The simulation now models the
  internal pull-up resistor; before, such a pin read `LOW` as if a button
  were pressed.
- **The start page loads without third-party requests** (#244, #245). A
  render-blocking Google Fonts stylesheet could stall the page load; Inter and
  JetBrains Mono are now self-hosted, and the leftover Replit banner script is
  gone.
- **Capacity calibration works on a fresh host** (#248): the generated run ID
  fits the 64-character limit, and a missing client build is reported before
  the backend starts.
- **Compose deployment** (#249): `capacity.env` values reach the backend
  container, the runtime directories are writable for the container user, and
  `storage` is excluded from the Docker build context.

### Documentation

- New user guide `docs/USER_GUIDE.md` and role-based entry points in the
  README for learners, teachers, administrators, developers and course
  authors (#242).
- Finished plans moved to `docs/archive/`; `docs/OPEN_POINTS.md` lists only
  the open points, each verified against the code (#239, #241).
- The Ubuntu/VBox guide mentions how long the first image builds take.
- The user guide lists the known differences between the simulation and a
  real Arduino Uno (section "Grenzen der Simulation"): `int` is 32 bits wide
  instead of 16, `long` and `double` are 64 bits, `Serial.print` of a float
  without a precision prints `2.5` instead of `2.50`, `Serial.parseInt()`
  returns at once instead of waiting for its timeout, and loop speed, memory
  size and `random()` sequences differ. Point students to that section.

### Internal

- Findings of the SonarQube 26.9 rules and of the maintainability scan
  resolved (#246, #251); no rule disabled.
- Route test servers bind to the loopback address they request, which removes
  two sporadic failures under the full suite (#247).
- The redundant `vite-tsconfig-paths` plugin is removed (#250).

## v1.0.0 – 2026-10-09

First versioned release of UnoSim. It covers everything merged since the last
release candidate `rc-2026-09-11-full-3` (#87–#237). The REST API and the
WebSocket protocol report version `1.0.0`; the embedding API (`postMessage`)
stays at `1.4.0`.

### Upgrade notes for operators

- **Docker is the only production profile.** `NODE_ENV=production` requires
  `UNOSIM_SERVER_MODE=docker`; every simulation runs in its own sandbox
  container and there is no local fallback. The former switches
  `UNOSIM_SIMULATION_MODE`, `UNOSIM_TRUST_MODE`, `FORCE_DOCKER` and
  `UNOSIM_ALLOW_INSECURE_PRODUCTION_LOCAL` now stop the server at startup.
- **A trusted gateway is mandatory; user authentication at the gateway is
  optional** ([ADR 0008](docs/adr/0008-optional-gateway-authentication.md)).
  Set `UNOSIM_GATEWAY_SECRET` (at least 32 characters), `UNOSIM_TRUSTED_PROXY`
  (explicit IP or CIDR) and `UNOSIM_ALLOWED_WS_ORIGINS`. The Compose backend
  binds to `127.0.0.1` and uses a fixed network gateway; the Ubuntu/VBox
  installer writes all values together.
- **Capacity:** the application default admits 25 running plus waiting
  simulations, at most 5 per subject. The Ubuntu/VBox installer writes the
  value measured on its reference VM, `SIMULATION_ADMISSION_MAX=40`. Read
  [CAPACITY_MODEL.md](docs/CAPACITY_MODEL.md) before
  raising it on other hosts.
- **New lifetime limits:** a sandbox ends after `SANDBOX_MAX_LIFETIME_SECONDS`
  (default 7200 s) and a run after `SIMULATION_MAX_PAUSED_SECONDS` of total
  pause (default 600 s). Compose rotates the backend log (5 × 10 MB).
- **Set `UNOSIM_INSTANCE_ID`** to a unique value per backend on one Docker
  host (Compose: `unosim-server`); a restarted backend removes the sandboxes
  of its predecessor with that ID.
- **Toolchain is pinned:** Node.js 24.20.0, Arduino CLI 1.5.1, AVR core 1.8.8.
- **API changes:** mutating `/api` requests must be `application/json` (else
  415) and are refused from cross-site senders (403); the sketch mutation
  routes are removed and the sketch API is read-only; `POST /api/compile` no
  longer returns the compiled HEX.
- **Local development** (`npm run dev:full`) is reachable from this machine
  only: Vite listens on `127.0.0.1:3001` and the backend accepts only
  `localhost`/loopback hosts. Open `http://localhost:3001`.

### Security and isolation

- Compile includes that leave the sketch project are rejected before
  `arduino-cli` runs; compiler output is bounded (#160, #162, #223).
- Legacy code fallback, sketch writes, compile cache and rate limits are scoped
  to the request identity; each gateway subject has its own API budget (#161,
  #163).
- WebSocket connections: heartbeat, inbound rate limit, bounded stdin and one
  simulation lifecycle per connection (#167, #216).
- Complete Helmet CSP, JSON-only mutating API with cross-site refusal, sketch
  source redacted from logs (#175, #185, #186, #224).
- Local mode is loopback-only, including protection against LAN access and
  DNS rebinding (#177, #236).
- Dependency updates for npm audit findings (#202, #209).

### Sandbox lifecycle and resources

- Containers carry a deployment owner label; orphans of a crashed backend are
  removed, shutdown is bounded and every sandbox has a hard lifetime (#166,
  #191, #218).
- Runner reuse cannot leak a stopped run into the next one; execution
  ownership, process output and REST compile-to-start ownership are isolated
  and bounded (#164, #165, #187, #190).
- Bounded writable sandbox storage, runtime text output, I/O-registry cycles,
  pause time, compile build paths and shared temp directory (#183, #232, #233,
  #234).

### Capacity and compile

- Admission and sandbox start slots are shared fairly between subjects;
  capacity calibration and mixed-load reports are reproducible (#104, #105,
  #180, #226, #229).
- The compile worker queue is bounded and answers `SYSTEM_BUSY`; crashed
  workers restart; expired slots pass to the next compile; caches are bounded
  (#168, #169, #170, #192).
- Accurate CPU, queue and compile capacity metrics (#170, #188).

### Tutor and Course Content

- Course repository controls curriculum, strategy and learning objectives;
  mastery-driven progression; inline teacher focus in Example annotations
  with handover to the free Tutor (#108–#112, #194–#198).
- Better question quality: answers are rated only against the asked question,
  follow-up questions keep the sought answer out, off-topic replies are
  answered briefly (#135, #204, #206).
- Course Content sessions are subject-owned, bounded and committed only after
  success; the Course revision is derived on the server; request cancellation
  propagates to the provider (#150, #174, #182, #219–#221).
- Deterministic Tutor quality gate and an optional real-provider evaluation
  (manual dispatch only) (#113–#158, #205).

### Examples

- Dynamic external examples from an allowed GitHub repository, validated as a
  complete snapshot and bound to a resolved commit (#87).
- GitHub API quota is respected with a reserve for the default Course; the
  default Course stays loadable under browser override load (#227, #235).

### Simulator and client

- Project-wide multi-file static analysis; pin modes and the runtime I/O
  registry are preserved (#89–#91).
- Stable simulation, WebSocket and compile-slot lifecycle: the configured
  simulation mode is respected, external starts and the serial lifecycle are
  hardened, the Docker running state follows runtime readiness, active compile
  directories are not cleaned up early (#88, #93, #95, #98, #99, #101, #103).
- Embedding API reports operation errors and finds the embedding origin in
  every browser (#97, #228).
- The simulation returns to idle when the server connection drops (#225).
- Vite 8, Tailwind CSS 4 and a smaller initial load (#212–#214).

### Deployment, CI and documentation

- Ubuntu/VBox installer with optional gateway authentication; the CI verifies
  the containerised gateway and the installer topology (#208, #211, #217).
- The installer keeps retrying its readiness checks while Docker's published
  port still resets connections during backend startup; before, a fresh
  installation could abort with "meldet aber keine Readiness" (#237).
- CI runs a clean-room build, knip dead-code gate, zero ESLint warnings,
  Docker sandbox, toolchain and E2E gates (#189, #193, #200).
- Architecture, security, installation and capacity documentation describe the
  implemented system (#159, #176, #178, #230, #231).

### Release validation

- Hosted CI on `main` is green: clean-room build, lint and unit tests,
  toolchain integration, Docker sandbox, Playwright E2E and the production
  gateway deployment.
- The local release gate (`REQUIRE_RELEASE_GATE=1 ./run-tests.sh`) passes,
  including Docker, E2E and the SonarQube quality gate.
- Fresh-VM installation: on a fresh Ubuntu 26.04.1 LTS (aarch64) VirtualBox VM,
  `scripts/install-ubuntu-vbox.sh` from `main` at `c513ec859` completed on the
  first run.
  Backend and HTTPS gateway readiness, TLS on ports 443 and 8443, the gateway
  secret and origin checks, and a Blink simulation in the Docker sandbox were
  verified from a client on the host-only network.
- Ubuntu 26.04 uses sudo-rs: start the installer from an interactive terminal,
  where `sudo -v` asks for the password once.

### Known limitations

- `POST /api/compile` runs `arduino-cli` inside the backend container. An
  inline-assembler `.include` can reveal the first characters of each line of
  a file the backend can read. Do not place secrets as files in the backend
  container; a sandboxed REST compile is an open architecture decision
  ([SECURITY.md](docs/SECURITY.md), S1-ASM).
- In the IP-identified gateway mode of the Ubuntu/VBox installer, clients that
  reach Nginx from the same source IP share one UnoSim identity, its rate
  limits and its simulation admissions; network reachability is the access
  boundary. Use it only on a trusted private network or add gateway
  authentication ([ADR 0008](docs/adr/0008-optional-gateway-authentication.md)).
