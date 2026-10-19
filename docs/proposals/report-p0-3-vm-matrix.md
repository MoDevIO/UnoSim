# P0.3 Ersatzmessung: synthetische Low-End-Umgebung

> **Nicht normativ.** Messbericht zu P0.3 aus [browser-emulation-plan.md](browser-emulation-plan.md).
> **Dies ist eine synthetische Messung in Linux-Containern, keine Messung auf realen
> Schulgeräten.** Der Bericht wird mit dem Plan gelöscht.

## Aufbau (reproduzierbar mit `spikes/p0-3/run-vm-matrix.sh`)

| | |
|---|---|
| Host | Apple M2 Pro (`Mac14,9`), 10 Kerne, 32 GB, macOS 26.6.2 |
| Virtualisierer | Docker Desktop 29.8.2 (Linux-VM, Kernel 7.0.14-linuxkit, aarch64) |
| Umgebung | Container `mcr.microsoft.com/playwright:v1.58.2-noble` (Ubuntu 24.04.3), Linux/arm64 |
| Konfiguration A | **1 vCPU / 2 GB**: `--cpuset-cpus=0 --memory=2g --memory-swap=2g` |
| Konfiguration B | **2 vCPU / 4 GB**: `--cpuset-cpus=0,1 --memory=4g --memory-swap=4g` |
| Browser | Chromium 145.0.7632.0 und Firefox 146.0.1 (die Browser des Playwright-Images), headless |
| Werkzeug | `npm run spike:p03`-Seite (`spikes/p0-3`), gesteuert von `run-matrix.mjs` (Playwright), je Konfiguration und Browser **3 Läufe** à 3 Sketches (2 s Höchsttempo + 10 s Echtzeit) |
| Rohdaten | [results/p0-3/](results/p0-3/): ein JSON je Konfiguration und Browser mit Umgebung, Zusammenfassung und allen Läufen |

Die CPU-Zuteilung erfolgt über `cpuset` (feste Kerne), nicht über eine Zeitquote,
damit keine Drosselungsartefakte (CFS-Quote in 100-ms-Perioden) die UI-Latenz
verfälschen. Der Container sieht trotzdem alle 10 CPUs der Docker-VM
(`visibleCpus`); maßgeblich sind `cpuset` und `cgroupMemoryMax` in den JSON-Dateien.

## Ergebnis (Median der drei Läufe; Kriterium: `peakSpeed` IT05.5 ≥ 1,2)

| Konfiguration | Browser | IT05.5 `peakSpeed` (min–max) | int-probe | IT11.5 | `realTimeFactorMedian` | UI-Verzögerung p95 / max |
|---|---|---|---|---|---|---|
| 1 vCPU / 2 GB | Chromium | **3,89–3,98** | 5,3–5,5 | 5,4–5,6 | 1,00 | 0,8–1,7 ms / 3,6–24 ms |
| 1 vCPU / 2 GB | Firefox | **2,11–2,14** | 2,4–3,0 | 2,9–3,1 | 1,00 | 3–4 ms / 5–10 ms |
| 2 vCPU / 4 GB | Chromium | **4,35–4,42** | 5,9–6,1 | 5,8–6,0 | 1,00 | 0,9–1,1 ms / 3,2–12 ms |
| 2 vCPU / 4 GB | Firefox | **2,18–2,23** | 3,1–3,2 | 3,2–3,2 | 1,00 | 2 ms / 4–7 ms |

Alle zwölf Läufe erfüllen das Kriterium (kleinster Wert 2,11 mit Firefox). Die
Streuung zwischen den Läufen ist gering (unter 5 %). Der Echtzeitfaktor ist
überall 1,00 (die Worker warten auf die Wanduhr), die Seite bleibt reaktionsfähig.
Ein zweiter Kern bringt wenig, weil die Emulation einen Thread nutzt; der
Unterschied zwischen A und B liegt im Rauschen.

## Aussagekraft und Grenzen

- Die Kerne eines M2 Pro gehören zu den schnellsten Einzelkernen überhaupt. Die
  Kernzahl und der Arbeitsspeicher der VM sind niedrig, die **Einzelkernleistung
  nicht**. Wesentlich ist aber gerade sie, deshalb zeigt die Matrix nicht, wie ein
  schwaches Schulgerät abschneidet.
- Der Sicherheitsabstand ist trotzdem messbar: Mit 2,11 gegenüber 1,2 darf ein
  Gerät höchstens etwa **1,75-mal langsamer** (Einzelkern, Firefox) bzw. **3,2-mal**
  (Chromium) als dieser Kern sein. Ältere Celeron- oder ARM-Geräte sind nach
  Schätzung (nicht gemessen) um den Faktor 3 bis 5 langsamer; damit wäre Firefox
  auf einem solchen Gerät grenzwertig.
- Die Container teilen sich Kern und Speicherbus mit dem Host (Hintergrundlast
  unbekannt); es fehlt GPU-Rendering und ein echter Desktop. Browser sind
  headless und Linux/arm64; Safari und Windows-Browser wurden nicht gemessen.
- Chromium war in allen Fällen etwa doppelt so schnell wie Firefox; die
  Firefox-Werte sind die für die Entscheidung relevanten.

## Vorschlag

P0.3 kann unter dieser Ersatzmethodik als **"bedingt ausreichend"** gelten: Das
Kriterium ist in der synthetischen Umgebung mit Faktor 1,75 (Firefox) bis 3,3
(Chromium) Reserve erfüllt, und die Messung ist reproduzierbar. Um die Aussage für
Schulgeräte zu belegen, genügt später **eine** reale Messung auf dem schwächsten
verfügbaren Gerät (Anleitung: [human-tests.md](human-tests.md), Teil 1, rund 10 Minuten;
bei weniger als 1,2 greifen die Gegenmaßnahmen aus Abschnitt 10 des Plans). Eine
CPU-Drosselung (Chromium DevTools `Emulation.setCPUThrottlingRate`) wäre eine
günstige zusätzliche Näherung; sie wurde hier nicht erprobt, weil unklar ist, ob
sie auch Worker erfasst.
