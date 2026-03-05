# 📋 Project Status: Foundation Solidified & Performance Ready

**Letztes Update:** 03. März 2026
**Aktueller Meilenstein:** Phase 0: Cleanup & Infrastruktur-Härtung (ABGESCHLOSSEN ✅)
**Nächstes Ziel:** Phase 1: High-Concurrency Optimierung (STARTBEREIT 🚀)

---

## 🛡️ 1. Erreichte Meilensteine (Status Quo)

### Repository-Hygiene & Struktur
* **Root-Cleanup:** Das Hauptverzeichnis wurde von über 30 obsoleten Dateien befreit. Alle historischen Berichte, Audit-Ergebnisse und Legacy-Skripte wurden nach `/archive` verschoben.
* **Test-Organisation:** Klare Trennung der Test-Suiten für bessere Wartbarkeit:
    * `/e2e`: Playwright End-to-End Tests (UI & User Flows).
    * `/tests/core`: Zentrale Logik- und Sanity-Tests (ehemals Root-Tests).
    * `/tests/server` & `/tests/client`: Spezifische Integrationstests.
* **Dokumentations-Update:** Alle zentralen Handover- und Status-Dokumente wurden auf den aktuellen Stand gebracht.

### Test-Infrastruktur & Pipeline
* **Stabile Pipeline:** Das neue `./run-tests.sh` Skript ist das Herzstück der CI. Es beinhaltet:
    * Automatisches Port-Cleanup & Server-Management (Kill-Switch für Port 3000).
    * Intelligente Log-Filterung (unterdrückt `SERIAL_EVENT` & `DEBUG` Rauschen).
    * Vermeidung von Compiler-Kollisionen durch `maxConcurrency: 1` in kritischen Unit-Test-Phasen.
* **Coverage:** Die Test-Suite umfasst nun **882 Tests**. Der "verschollene" 3. Cache-Test (TTL-Eviction) wurde erfolgreich identifiziert und implementiert.

---

## 🚩 2. Offene Positionen & Bekannte Probleme

### A. Der "Serial-Monitor Timing Flake" ⚠️
* **Problem:** Ein Test in `serial-monitor-baudrate-rendering.test.tsx` schlägt gelegentlich fehl.
* **Ursache:** Vermutlich Race-Conditions zwischen virtuellem Baudrate-Timer und React-Rendering-Zyklen.
* **Priorität:** Hoch (Ziel: 100% deterministische Pipeline).

### B. Cache-Testbarkeit & DI
* **Problem:** Der Cache-TTL-Wert ist hardcodiert (5 Min), was automatisierte Zeit-Tests erschwert.
* **Priorität:** Mittel.
* **Lösung:** Einführung von Dependency Injection für `CACHE_TTL` in `compiler.routes.ts`.

---

## 🚀 3. Die nächsten 3 Hebel (Performance Roadmap)

Mit dem stabilen Fundament beginnt nun die Optimierung für den Classroom-Einsatz (Ziel: 200+ parallele User).



| Hebel | Zielsetzung | Status |
| :--- | :--- | :--- |
| **1. Compilation-Worker-Pool** | Umstellung auf `piscina`, um parallele Kompiliervorgänge ohne Blocking des Main-Threads zu ermöglichen. | **Bereit für Start** |
| **2. WebSocket Compression** | Aktivierung von `perMessageDeflate` in `simulation.ws.ts`, um die Bandbreitennutzung um ca. 50% zu senken. | **Bereit für Start** |
| **3. Runner-Recycling** | Implementierung eines Pools für `SandboxRunner`, um Memory-Peaks durch Prozess-Neustarts zu minimieren. | **In Planung** |

---

## 📊 Erfolgs-Indikatoren für die nächste Phase

* [ ] **Pipeline-Stabilität:** `./run-tests.sh` läuft 10-mal hintereinander ohne einen einzigen "Flaky"-Fehler durch.
* [ ] **Latenz-Reduktion:** Die durchschnittliche Antwortzeit bei 50 gleichzeitigen Kompiliervorgängen sinkt um >30%.
* [ ] **Zero-Warning Policy:** `npm run check` liefert 0 Fehler und 0 Warnungen.

---

## 🛠️ Schnellstart-Kommandos

* **Tests ausführen:** `./run-tests.sh` (Log landet in `run-tests_output.log`)
* **Entwicklungs-Server:** `npm run dev` (Erreichbar auf Port 3000)
* **Typen-Check:** `npm run check`

---
**Nächster Schritt:** Start des Branches `feature/compilation-workers`.