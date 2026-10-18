# Spike P0.2: Compile-Sandbox

> **Nicht normativ.** Spike-Bericht zu Arbeitspaket P0.2 aus
> [browser-emulation-plan.md](browser-emulation-plan.md). Die Ergebnisse gehen
> in ADR 0010 (Entscheidung E6) ein; der Bericht wird danach mit dem Plan
> gelöscht. Prototypcode: [spikes/p0-2/](../../spikes/p0-2/).

## Ziel

Prüfen, ob `arduino-cli` 1.5.1 mit `arduino:avr@1.8.8` in einem kurzlebigen
Container je Compile (Netz aus, Root-FS read-only, Projekt read-only, Build im
tmpfs) schnell genug ist und keine fremden Dateien mehr in Flash-Abbild oder
Diagnosen bringt.

**Kriterium (Plan):** höchstens etwa 1 s Mehraufwand p95 gegenüber heute,
keine fremde Datei lesbar.

## Aufbau

- Image [spikes/p0-2/Dockerfile](../../spikes/p0-2/Dockerfile): Debian
  bookworm-slim, `arduino-cli` 1.5.1 und der Core über die bestehenden Skripte
  `scripts/install-arduino-cli.sh` und `scripts/install-arduino-avr-core.sh`,
  Nutzer `compile` (UID 1000), Core-Cache für Uno, Nano und Mega im Image
  vorkompiliert. Größe 737 MB (382 MB davon Toolchain unter `~/.arduino15`).
- Sandbox-Flags je Compile: `--network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --pids-limit 128 --memory 512m --cpus 1|2
  --tmpfs /tmp:rw,size=256m`, Projekt als einziges Bind-Mount read-only unter
  `/sketch/<name>`, Owner-Label.
- Vergleichsbasis „heute“: dasselbe Image als langlebiger Container, Compile
  per `docker exec` mit frischem `--build-path` je Auftrag, also wie der
  heutige Compile im Backend-Container (ohne den Node-Anteil des Backends).
- Messung [spikes/p0-2/bench.mjs](../../spikes/p0-2/bench.mjs): alle 51
  Beispiele aus UnoSim-Examples `v3.0.0`, seriell 20 Compiles, parallel je
  3 Durchgänge mit 8 bzw. 20 gleichzeitigen Compiles.
- Angriffe [spikes/p0-2/attack.mjs](../../spikes/p0-2/attack.mjs): `.incbin`
  (Inhalt landet im Flash) und GAS-`.include` (Inhalt erscheint in
  Assembler-Meldungen) auf `/etc/passwd`, `/app/package.json`, das Projekt
  eines anderen Nutzers und `/proc/self/environ`, jeweils „heute“ (ein
  Container sieht alle Projekte und `/app`) und in der Sandbox.
- Messgerät: Apple M2 Pro, Docker Desktop 29.8.2 (linux/arm64, 10 CPUs).
  Das ist nicht der Referenz-Host des Kapazitätsmodells; P7.1 misst dort.

## Befunde zur Toolchain

1. **Core-Cache und `--build-path`.** `arduino-cli` 1.5.1 legt den
   kompilierten Core unter `build_cache.path` ab (Standard
   `~/.cache/arduino/cores/<fqbn>_<hash>/core.a`) und nutzt ihn nur bei Builds
   **ohne** `--build-path`. Mit `--build-path` wird der Core bei jedem Compile
   neu übersetzt. Der heutige Compile übergibt ein frisches `--build-path` je
   Auftrag; das Flag `--build-cache-path` ist veraltet und wird von
   `buildCompileArgs` nicht übergeben. Heute wird der Core also bei jedem
   Compile neu gebaut.
2. **Read-only-Cache aus dem Image geht nicht.** Ohne `--build-path` schreibt
   `arduino-cli` den Sketch-Build unter `build_cache.path/sketches`; liegt
   der Cache read-only im Image, bricht der Compile mit
   `mkdir …/sketches: read-only file system` ab.
3. **Strategie „kopieren“.** Der vorkompilierte Cache ist 1,1 MB groß (je
   FQBN 344–392 KB). Ihn je Compile in den tmpfs zu kopieren
   (`cp -a ~/.cache/arduino /tmp/cache`, dann
   `ARDUINO_BUILD_CACHE_PATH=/tmp/cache … --output-dir /tmp/out`) kostet kaum
   Zeit und spart den Core-Build.

## Messwerte

Compile-Latenz in ms, Wanduhr bis zum Ende von `docker exec` bzw.
`docker run --rm`:

| Variante | seriell p50 / p95 | 8 parallel p50 / p95 | 20 parallel p50 / p95 |
|---|---|---|---|
| heute (`docker exec`, Core je Compile neu) | 400 / 420 | 817 / 918 | 2139 / 3244 |
| Sandbox, `--build-path`, 2 CPUs | 613 / 650 | 1425 / 1544 | 3207 / 3418 |
| Sandbox, Core-Cache kopiert, 2 CPUs | 429 / 456 | 919 / 1113 | 1998 / 2164 |
| Sandbox, Core-Cache kopiert, 1 CPU | 444 / 464 | 855 / 928 | 2209 / 2352 |

Mehraufwand p95 gegenüber heute mit kopiertem Core-Cache: seriell +36 bis
+44 ms, 8 parallel +10 ms (1 CPU) bzw. +195 ms (2 CPUs), 20 parallel −892 bis
−1080 ms. Keine Fehlschläge (0 von 312 Compiles). Ohne Core-Cache kostet die
Sandbox seriell etwa +230 ms p95.

Im Betrieb begrenzt der Worker-Pool heute auf 8 gleichzeitige Compiles; der
Wert für 20 zeigt das Verhalten ohne diese Grenze.

## Angriffe

| Ziel | `.incbin` heute | `.incbin` Sandbox | `.include` heute | `.include` Sandbox |
|---|---|---|---|---|
| `/etc/passwd` | im Flash | im Flash (Datei des Sandbox-Images) | Zeilenanfänge in Meldungen | Zeilenanfänge in Meldungen (Sandbox-Image) |
| `/app/package.json` | **im Flash** | Datei nicht vorhanden | **Zeilenanfänge in Meldungen** | Datei nicht vorhanden |
| Projekt eines anderen Nutzers | **im Flash** | Datei nicht vorhanden | **Zeilenanfänge in Meldungen** | Datei nicht vorhanden |
| `/proc/self/environ` | leer | leer | **erste Zeichen einzelner Anweisungen** | erste Zeichen der Sandbox-Umgebung |

- In der Sandbox ist keine Datei des Backends und kein fremdes Projekt
  lesbar. Lesbar bleiben nur Dateien des Sandbox-Images selbst
  (Toolchain, Debian-Basis); sie enthalten nichts Geheimes. Die Abbildung
  `/etc/passwd` des Images ist öffentlich bekannt.
- Heute bringt `.incbin` Backend-Dateien und fremde Projekte vollständig ins
  Flash-Abbild; das bestätigt Befund B1 des Plans.
- **Neu:** GAS-`.include "/proc/self/environ"` liest die Umgebung des
  Assemblers nicht als leer. Der Assembler meldet je Anweisung das erste nicht
  erkannte Zeichen (gemessen: `h` aus `HOME=/home…`, `u` aus `PATH=/usr…`).
  `ProcessExecutor` startet `arduino-cli` ohne eigene `env`, die Toolchain
  erbt also die Umgebung des Backends. Ein Sentinel-Secret erschien im Test
  nicht, einzelne Zeichen von Umgebungswerten aber schon. [SECURITY.md](../SECURITY.md)
  sagt, `/proc/*/environ` lese sich für beide Compiler leer; das gilt für
  `#include` und `.incbin` (Archiv: S1-ENV), nicht für `.include`.

## Ressourcengrenzen

Eine Compile-Bombe (10⁵ Anweisungen per Makro) endet mit `--memory 256m
--pids-limit 64 --cpus 1` nach 4,8 s mit Exit-Code 1, ohne den Host zu
belasten. Die Ursache des Abbruchs (Speicher oder Compilerfehler) ist nicht
weiter untersucht; ein Zeitlimit (`timeout --signal=KILL`) gehört zusätzlich
in die Umsetzung.

## Kriterium

**Erfüllt.** Mehraufwand p95 höchstens +195 ms (Kriterium etwa 1 s), mit
Core-Cache bei 20 parallelen Compiles schneller als heute; keine fremde Datei
lesbar. Ein Pool warmer Container ist nicht nötig.

## Folgen für die Entscheidungen

- **E6 (Compile-Sandbox):** tragfähig wie geplant. Für P2.4:
  - Core-Cache je FQBN im Image vorkompilieren und je Compile in den tmpfs
    kopieren; `ARDUINO_BUILD_CACHE_PATH` statt `--build-path`, Ausgabe mit
    `--output-dir`.
  - Sandbox mit **expliziter, minimaler Umgebung** starten (`HOME`, `PATH`,
    `ARDUINO_BUILD_CACHE_PATH`), nie mit der Umgebung des Backends.
  - Zeitlimit per `timeout --signal=KILL` zusätzlich zu den Docker-Grenzen;
    Startwerte `COMPILE_SANDBOX_CPU_LIMIT=1`, `COMPILE_SANDBOX_MEMORY_MB=512`,
    `COMPILE_SANDBOX_PIDS_LIMIT=128`, tmpfs 256 MiB. P7.1 bestätigt sie auf dem
    Referenz-Host.
  - Der Vertragstest (Plan 7.8) übernimmt die Angriffe dieses Spikes,
    einschließlich `.include` auf `/proc/self/environ`.
- **E15 (Build-Identität):** keine Änderung. Der Core-Cache im Image gehört
  zur Image-Version; die Core-Version steht ohnehin in der Build-Identität.
- **Bestehender Betrieb (V1, außerhalb dieses Plans):** Der `.include`-Befund
  betrifft den heutigen REST-Compile. Bis P2.4 hilft eine minimale `env` für
  den `arduino-cli`-Aufruf im Backend; SECURITY.md sollte die Aussage zu
  `/proc/*/environ` präzisieren. Das ist eine Fehlerbehebung für `main` und
  gehört nicht in diesen Spike. Ebenso könnte V1 den Core-Cache nutzen
  (Befund 1), was jeden Compile um etwa 200 ms verkürzt.
