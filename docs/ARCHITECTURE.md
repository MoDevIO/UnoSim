# UnoSim Architekturübersicht

Status: current

Diese Datei beschreibt die grundlegende Architektur von UnoSim mit Fokus auf Datenflüsse und Verantwortlichkeiten.

## 📊 Datenfluss-Diagramm

```mermaid
graph TD
    A[Client/Browser] -->|WebSocket| B[UnoSim Server]
    B -->|REST| C[Arduino Compiler]
    B -->|Docker API| D[Sandbox Runner Pool]
    C -->|Hex-Datei| D
    D -->|Serial Output| B
    B -->|WebSocket| A
```

## 🏗️ Architekturkomponenten

### 1. Client (Frontend)
- **Verantwortung:** UI-Interaktion, WebSocket-Kommunikation, State-Management
- **Technologie:** React 18, TypeScript, Vite, TailwindCSS
- **Hauptkomponenten:**
  - `ArduinoSimulatorPage` – Haupt-Seite mit Simulator-UI
  - `useCompileAndRun` – Orchestrator für Compile→Start und State-Komposition
  - `use-compile-controller.ts` – Compile-Mutation, Parser-/Registry-Updates und Compile-State
  - `use-simulation-controller.ts` – Simulation-Mutationen, WebSocket-Kommandos und Lifecycle
  - `use-ui-feedback-adapter.ts` – Toasts, Debug-Meldungen, Glitch- und Pin-Konflikt-Feedback
  - `useArduinoSimulatorPage` – Composition Root für ViewModels

### 2. UnoSim Server (Backend)
- **Verantwortung:** WebSocket-Server, REST-API, Compilation-Queue, Sandbox-Management
- **Technologie:** Node.js/Express, TypeScript, WebSocket (ws)
- **Hauptkomponenten:**
  - `routes/status.routes.ts` – Status- und Metriken-Endpunkte
  - `routes/simulation.ws.ts` – WebSocket-Lifecycle und Nachrichten-Routing
  - `services/compiler-with-fallback.ts` – Compilation mit Fallback-Mechanismus
  - `services/sandbox-runner-pool.ts` – Pool für Docker-Sandboxen
  - `services/sandbox-runner.ts` – Einzelne Sandbox-Instanz

### 3. Arduino Compiler
- **Verantwortung:** Sketch-Kompilierung, Header-Verarbeitung, Cache-Management
- **Technologie:** arduino-cli (Docker-basiert oder lokal)
- **Hauptkomponenten:**
  - `services/arduino-compiler.ts` – Haupt-Compiler-Logik
  - `services/compiler-with-fallback.ts` – Fallback-Mechanismus für Compilation
  - Cache: In-Memory-Cache für schnelle Rekompilationen

### 4. Sandbox Runner Pool
- **Verantwortung:** Verwaltung von Docker-Containern für Sketch-Ausführung
- **Technologie:** Docker, Node.js Worker Threads
- **Hauptmerkmale:**
  - **Warm Containers:** Vorgehaltene Container für schnelle Startzeiten
  - **Isolation:** Jeder Sketch läuft in eigenem Container
  - **Ressourcenkontrolle:** CPU/Memory/PID-Limits pro Container

## 🔄 Datenflüsse im Detail

### Compile-Flow
1. Client sendet Code an Server via REST (`/api/compile`)
2. Server leitet an Compiler weiter
3. Compiler kompiliert Code zu Hex-Datei
4. Hex-Datei wird an Sandbox Runner Pool übergeben
5. Sandbox Runner führt Sketch aus
6. Serial Output wird an Client gesendet

### Simulation-Flow
1. Client sendet `start_simulation` via WebSocket
2. Server startet Sandbox Runner
3. Runner führt Sketch aus und streamt Serial Output
4. Client empfängt Serial Output und aktualisiert UI
5. Bei `pause_simulation` oder `stop_simulation`: Runner wird gestoppt

### Status-Flow
1. Client fragt `/api/status` ab
2. Server aggregiert Metriken von:
   - Sandbox Runner Pool (verfügbare/genutzte Runner)
   - Compile Semaphore (aktive/queued Compilations)
   - Server-Konfiguration
3. Client zeigt Status in Header an

## 📌 Verantwortlichkeiten (State Ownership)

| Komponente | Verantwortung |
|-----------|---------------|
| `ArduinoSimulatorPage` | UI-State und ViewModel-Komposition |
| `useCompileAndRun` | Props-Merging, State-Komposition und Compile→Start-Orchestrierung |
| `use-compile-controller.ts` | Compile-Mutation, Compile-State, Parser-Messages und I/O-Registry |
| `use-simulation-controller.ts` | Simulation-State, Start/Stop/Pause/Resume und WebSocket-Sendelogik |
| `use-ui-feedback-adapter.ts` | UI-Seiteneffekte für Toasts, Debug-Ausgaben und Konfliktwarnungen |
| `useArduinoSimulatorPage` | State-Derivation und UI-Seiten-Effekte |
| `simulation.ws.ts` | WebSocket-Lifecycle und Nachrichten-Routing |
| `sandbox-runner-pool.ts` | Runner-Lebenszyklus und Pool-Management |
| `arduino-compiler.ts` | Compilation und Cache-Logik |

## 🔒 Sicherheits- und Betriebsmodell

### Sandbox-Sicherheit
- **Isolation:** Jeder Sketch läuft in eigenem Docker-Container
- **Ressourcenlimits:** CPU, Memory, PID-Limits pro Container
- **Read-Only Filesystem:** Container haben nur lesenden Zugriff auf Dateisystem
- **Timeouts:** Maximale Laufzeit pro Sketch (60 Sekunden)

### WebSocket-Sicherheit
- **Authentifizierung:** Nur authentifizierte Clients dürfen WebSocket verbinden
- **Origin-Check:** Nur erlaubte Origins können Nachrichten senden/empfangen
- **Rate-Limiting:** Begrenzung der Nachrichtenfrequenz

### Deployment-Modi
- **Local Mode:** Server und Simulation laufen lokal (für Entwicklung)
- **Docker Mode:** Server in Container, Simulation lokal (für Performance-Tests)
- **Production Mode:** Server und Simulation in Containern (für Produktion)

## 📊 Metriken und Observability

Der UnoSim Server sammelt folgende Metriken:

- **Sandbox Runner:** Verfügbare, genutzte, maximale Runner
- **Compile Slots:** Aktive, queued, maximale Compilations
- **WebSocket Sessions:** Verbundene, verbindende Clients
- **Serial Output:** Bytes pro Sekunde, Drop-Rate
- **Pin States:** Änderungen pro Sekunde, Batch-Größen

Diese Metriken sind über `/api/status` und WebSocket-Events verfügbar.

## 🔄 Versionierung und API-Kontrakte

- **REST API:** Versionierung über URL-Pfad (`/api/v1/status`)
- **WebSocket:** Versionierung über Handshake-Nachrichten
- **Deprecation:** Legacy-Felder und API-Endpunkte werden mit `@deprecated` markiert und nach 2 Major-Releases entfernt

---

**Siehe auch:**
- `docs/PROJECT_ANALYSIS_REPORT_2026-09-04.md` – Detaillierte Projektanalyse
- `docs/TESTING_STANDARDS.md` – Teststrategie und -konventionen