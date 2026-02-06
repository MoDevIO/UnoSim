# Refactoring-Plan — Priorisierte Aufgabenliste

**Stand:** 5. Februar 2026  
**Aktuelle Testabdeckung:** 57,2 % Statements → **Ziel: >80 %**  
**Benötigte zusätzliche Statements:** ca. +760

---

## Phase 1 — Sofort: Totcode & Ballast entfernen

> Senkt Komplexität, reduziert Bundle-Größe, macht Coverage-Berechnung realistischer.  
> Jede Aufgabe ist unabhängig und kann einzeln abgearbeitet werden.

### Aufgabe 1.1 — Unbenutzte UI-Komponenten löschen
**Dateien löschen:**
```
client/src/components/ui/alert.tsx
client/src/components/ui/badge.tsx
client/src/components/ui/breadcrumb.tsx
client/src/components/ui/carousel.tsx
client/src/components/ui/chart.tsx
client/src/components/ui/collapsible.tsx
client/src/components/ui/command.tsx
client/src/components/ui/hover-card.tsx
client/src/components/ui/input-otp.tsx
client/src/components/ui/label.tsx
client/src/components/ui/popover.tsx
client/src/components/ui/select.tsx
client/src/components/ui/sidebar.tsx
client/src/components/ui/textarea.tsx
client/src/components/ui/toggle.tsx
```
**Prüfung:** `npm run build` muss fehlerfrei laufen.

---

### Aufgabe 1.2 — Unbenutzte Feature-Komponente löschen
**Dateien löschen:**
```
client/src/components/features/secret-dialog.tsx
```

---

### Aufgabe 1.3 — Duplikate und leere Dateien im src/ Ordner löschen
**Dateien löschen:**
```
src/arduinoOutputParser.ts            # Duplikat von server/services/arduino-output-parser.ts
src/utils/arduino-output-parser.js    # Kompiliertes JS-Artefakt
src/components/ui/Button.tsx          # Leere Datei (0 Bytes)
src/components/ui/button.css          # Leere Datei (0 Bytes)
```
**Hinweis:** `src/utils/arduino-output-parser.ts` wird noch von 3 Testdateien importiert. Dort die Imports auf `server/services/arduino-output-parser` umstellen, dann auch diese Datei löschen.
**Betroffene Testdateien prüfen:**
```
tests/unit/arduino-output-parser.test.ts
```

---

### Aufgabe 1.4 — Kompiliertes vite.config.js löschen
**Datei löschen:**
```
vite.config.js
```
In `.gitignore` die Zeile `!vite.config.js` entfernen — die aktive Config ist `vite.config.ts`.

---

### Aufgabe 1.5 — Unbenutzte Skripte löschen
**Dateien löschen:**
```
scripts/collect-button-sizes.py
scripts/update-lockfile-branch.sh
scripts/verify-tab-alignment.mjs
scripts/bin/                          # Ganzer Ordner
```

---

### Aufgabe 1.6 — Unbenutzte npm-Abhängigkeiten entfernen
**Aus `package.json` entfernen und `npm install` laufen lassen:**
```
dependencies:
  @radix-ui/react-accordion
  @radix-ui/react-aspect-ratio
  @radix-ui/react-avatar
  @radix-ui/react-context-menu
  @radix-ui/react-menubar
  @radix-ui/react-navigation-menu
  @radix-ui/react-progress
  @radix-ui/react-radio-group
  @radix-ui/react-slider
  @radix-ui/react-switch
  @radix-ui/react-toggle-group
  react-day-picker
  react-hook-form
  vaul
  cmdk
  embla-carousel-react
  input-otp

devDependencies:
  @types/connect-pg-simple
  @types/express-session
  concurrently
```
**Prüfung:** `npm run build && npm run test` müssen fehlerfrei laufen.

---

### Aufgabe 1.7 — Tote Exports in shared/ aufräumen
In `shared/schema.ts`:
- Export `LoopContext` entfernen (nirgends importiert)
- Export `parserMessageSchema` entfernen (nirgends importiert)

In `shared/reserved-names-validator.ts`:
- Export von `RESERVED_STANDARD_NAMES` entfernen (nur intern genutzt → `const` statt `export const`)
- Klasse `ReservedNamesValidator` muss nicht exportiert werden — nur die Instanz `reservedNamesValidator` wird extern verwendet. Idealerweise nur die Instanz exportieren.

---

## Phase 2 — Kernrefactoring: arduino-simulator.tsx aufteilen

> Dies ist der **größte einzelne Hebel** für die Testabdeckung.  
> Die Datei hat 3.908 Zeilen und 27 % Coverage → +31 Prozentpunkte Potenzial.  
> **Ohne dieses Refactoring ist 80 % unerreichbar.**

### Aufgabe 2.1 — useBackendHealth Hook extrahieren
**Aus `arduino-simulator.tsx` extrahieren nach `client/src/hooks/use-backend-health.ts`:**
- State: `backendReachable`, `backendPingError`
- Logik: Ping-Intervall, `ensureBackendConnected()`, `isBackendUnreachableError()`, `triggerErrorGlitch()`
- **Testdatei erstellen:** `tests/client/hooks/use-backend-health.test.ts`
- **Test mit `renderHook` aus @testing-library/react**
- **Geschätzte Coverage-Verbesserung:** +2–3 pp

### Aufgabe 2.2 — useMobileLayout Hook extrahieren
**Aus `arduino-simulator.tsx` extrahieren nach `client/src/hooks/use-mobile-layout.ts`:**
- State: `isMobile`, `mobilePanel`
- Logik: matchMedia-Listener, Body-Scroll-Prevention
- **Testdatei erstellen:** `tests/client/hooks/use-mobile-layout.test.ts`
- **Geschätzte Coverage-Verbesserung:** +0.5–1 pp

### Aufgabe 2.3 — useOutputPanel Hook extrahieren
**Aus `arduino-simulator.tsx` extrahieren nach `client/src/hooks/use-output-panel.ts`:**
- State: `compilationPanelSize`, `showCompilationOutput`, `outputPanelManuallyResized`, `activeOutputTab`, `parserPanelDismissed`
- Logik: `enforceOutputPanelFloor()`, `openOutputPanel()`, auto-sizing, Resize-Observer
- **Testdatei erstellen:** `tests/client/hooks/use-output-panel.test.ts`
- **Geschätzte Coverage-Verbesserung:** +2–3 pp

### Aufgabe 2.4 — useSerialIO Hook extrahieren
**Aus `arduino-simulator.tsx` extrahieren nach `client/src/hooks/use-serial-io.ts`:**
- State: `serialInputValue`, `serialOutput`, `serialViewMode`, `autoScrollEnabled`, `txActivity`, `rxActivity`
- Logik: Serial-Queue, `handleSerialInputSend()`, `cycleSerialViewMode()`
- **Testdatei erstellen:** `tests/client/hooks/use-serial-io.test.ts`
- **Geschätzte Coverage-Verbesserung:** +1–2 pp

### Aufgabe 2.5 — useSketchTabs Hook extrahieren
**Aus `arduino-simulator.tsx` extrahieren nach `client/src/hooks/use-sketch-tabs.ts`:**
- State: `tabs`, `activeTabId`, `code`, `isModified`
- Logik: Tab-CRUD (add, close, rename, select), Sketch-Ladung
- **Testdatei erstellen:** `tests/client/hooks/use-sketch-tabs.test.ts`
- **Geschätzte Coverage-Verbesserung:** +2–3 pp

### Aufgabe 2.6 — useCompilation Hook extrahieren
**Aus `arduino-simulator.tsx` extrahieren nach `client/src/hooks/use-compilation.ts`:**
- State: `compilationStatus`, `arduinoCliStatus`, `gccStatus`, `hasCompilationErrors`, `lastCompilationResult`, `cliOutput`
- Logik: `handleCompile()`, `handleCompileAndStart()`, Upload-Mutation
- **Testdatei erstellen:** `tests/client/hooks/use-compilation.test.ts`
- **Geschätzte Coverage-Verbesserung:** +2–3 pp

### Aufgabe 2.7 — useSimulationControls Hook extrahieren
**Aus `arduino-simulator.tsx` extrahieren nach `client/src/hooks/use-simulation-controls.ts`:**
- State: `simulationStatus`, `hasCompiledOnce`, `simulationTimeout`
- Logik: `handleStop/Start/Pause/Resume/Reset()`
- **Testdatei erstellen:** `tests/client/hooks/use-simulation-controls.test.ts`
- **Geschätzte Coverage-Verbesserung:** +1–2 pp

### Aufgabe 2.8 — useDebugConsole Hook extrahieren
**Aus `arduino-simulator.tsx` extrahieren nach `client/src/hooks/use-debug-console.ts`:**
- State: `debugMessages`, `debugMessageFilter`, `debugViewMode`, `debugMode`
- Logik: `addDebugMessage()`
- **Testdatei erstellen:** `tests/client/hooks/use-debug-console.test.ts`
- **Geschätzte Coverage-Verbesserung:** +0.5–1 pp

### Aufgabe 2.9 — usePinState Hook extrahieren
**Aus `arduino-simulator.tsx` extrahieren nach `client/src/hooks/use-pin-state.ts`:**
- State: `analogPinsUsed`, `detectedPinModes`, `pendingPinConflicts`, `pinMonitorVisible`
- Logik: `resetPinUI()`, `handlePinToggle()`, `handleAnalogChange()`, `pinToNumber()`
- **Testdatei erstellen:** `tests/client/hooks/use-pin-state.test.ts`
- **Geschätzte Coverage-Verbesserung:** +1–2 pp

**Gesamtgewinn Phase 2:** ca. +12–18 Prozentpunkte (57 % → 69–75 %)

---

## Phase 3 — Bestehende Tests erweitern

> Gezielte Lücken in bereits teilweise getesteten Dateien schließen.

### Aufgabe 3.1 — sandbox-runner.ts Tests erweitern
**Datei:** `tests/server/services/sandbox-runner.test.ts`  
**Aktuelle Coverage:** 68 % → **Ziel: 85 %**  
**Fehlende Tests:**
- Ungültige State-Transitions (z.B. `start()` wenn schon running)
- `flushSerialEvents()` — Serial-Event-Batching
- `flushMessageQueue()` — Message-Queue-Flushing
- Error-Pfade in `runSketch()` (Compile-Fehler, Output-Overflow)
- `sendOutputWithDelay()` — Zeichen-für-Zeichen Logik
- `setPinValue()` im pausierten Zustand
- **Geschätzte Coverage-Verbesserung:** +3–4 pp

### Aufgabe 3.2 — serial-monitor.tsx Tests erweitern
**Datei:** `tests/client/serial-monitor.ui.test.tsx`  
**Aktuelle Coverage:** 66 % → **Ziel: 90 %**  
**Fehlende Tests:**
- `processAnsiCodes()` mit Backspace, `\r`, `\r\n`, kombinierten Sequenzen (pure Funktion, einfach)
- `applyBackspaceAcrossLines()` mit Multi-Line-Backspace (pure Funktion, einfach)
- `hasControlChars()` Grenzfälle (pure Funktion, einfach)
- Komponenten-Rendering mit Timestamps, Farben, Overflow
- **Geschätzte Coverage-Verbesserung:** +1 pp

### Aufgabe 3.3 — parser-output.tsx Tests erweitern
**Datei:** `tests/client/parser-output-pinmode.test.tsx`  
**Aktuelle Coverage:** 75 % → **Ziel: 90 %**  
**Fehlende Tests:**
- Rendering mit leerem ioRegistry → "No Pins Detected" Empty-State
- Rendering mit Analog-Pins → Analog-Spalte
- Rendering mit Interrupt-Records → Interrupt-Spalte
- `formatLabel()` und `filterByPin()` Edge-Cases (pure Funktionen, einfach)
- **Geschätzte Coverage-Verbesserung:** +0.5 pp

### Aufgabe 3.4 — logger.ts Tests erweitern
**Datei:** `tests/shared/logger.test.ts`  
**Aktuelle Coverage:** 81 % → **Ziel: 95 %**  
**Fehlende Tests:**
- Objekt mit zirkulärer Referenz → `JSON.stringify` catch
- `console.log` mocken, um zu werfen → Error-Catch-Pfad
- `NODE_ENV !== "test"` → `console.error` Branch
- **Geschätzte Coverage-Verbesserung:** +0.15 pp

---

## Phase 4 — Neue Testdateien für ungetestete Module

### Aufgabe 4.1 — Test für storage.ts erstellen
**Neue Datei:** `tests/server/storage.test.ts`  
**Zu testen:** Alle 6 CRUD-Methoden von `MemStorage`  
**Schwierigkeit:** Einfach (pure Logik, keine Abhängigkeiten)  
**Geschätzte Coverage-Verbesserung:** ca. +0.5 pp

### Aufgabe 4.2 — Test für rate-limiter.ts erstellen
**Neue Datei:** `tests/server/services/rate-limiter.test.ts`  
**Zu testen:** `isAllowed()`, `getStats()`, `cleanup()`, `isBlocked()`, `getRemainingTokens()`  
**Schwierigkeit:** Einfach (pure Logik, Timer mocken)  
**Geschätzte Coverage-Verbesserung:** ca. +0.5 pp

### Aufgabe 4.3 — Test für input-group.tsx erstellen
**Neue Datei:** `tests/client/input-group.test.tsx`  
**Zu testen:** Enter → `onSubmit`, `disabled`-Guard, `onKeyDown`-Forwarding  
**Schwierigkeit:** Einfach  
**Geschätzte Coverage-Verbesserung:** +0.2 pp

### Aufgabe 4.4 — Test für reserved-names-validator.ts erstellen
**Neue Datei:** `tests/shared/reserved-names-validator.test.ts`  
**Zu testen:** `validateReservedNames()` mit Funktionsdeklarationen reservierter Namen, Block-Kommentare mit `/* pause */`, mehrzeilige Kommentare  
**Schwierigkeit:** Einfach (pure Logik)  
**Geschätzte Coverage-Verbesserung:** +0.3 pp

### Aufgabe 4.5 — Test für websocket-manager.ts erstellen
**Neue Datei:** `tests/client/websocket-manager.test.ts`  
**Zu testen:** Verbindungsaufbau, Reconnect-Logik, Message-Queue, Heartbeat  
**Schwierigkeit:** Mittel (WebSocket mocken)  
**Geschätzte Coverage-Verbesserung:** +1–2 pp

### Aufgabe 4.6 — Test für use-websocket.tsx erstellen
**Neue Datei:** `tests/client/hooks/use-websocket.test.ts`  
**Zu testen:** Hook mit `renderHook`, connection states, `sendMessage`, `consumeMessages`  
**Schwierigkeit:** Mittel  
**Geschätzte Coverage-Verbesserung:** +0.5 pp

---

## Phase 5 — Optionale Verbesserungen

### Aufgabe 5.1 — Drizzle/DB-Infrastruktur entfernen
`shared/schema.ts` enthält `pgTable`-Definitionen und Drizzle-Imports, aber der Server nutzt nur `MemStorage`. Wenn keine DB geplant ist:
- `drizzle.config.ts` löschen
- `drizzle-orm`, `drizzle-zod`, `drizzle-kit` aus `package.json` entfernen
- `@neondatabase/serverless` entfernen
- `shared/schema.ts` bereinigen (nur Types/Zod-Schemas behalten, pgTable entfernen)
- `@types/connect-pg-simple`, `@types/express-session` entfernen

### Aufgabe 5.2 — Replit-spezifische Plugins entfernen
Wenn nicht auf Replit deployed wird:
- `@replit/vite-plugin-cartographer` aus `package.json` entfernen
- `@replit/vite-plugin-runtime-error-modal` aus `package.json` entfernen
- Entsprechende Imports in `vite.config.ts` entfernen

### Aufgabe 5.3 — Skipped Tests reparieren oder entfernen
11 Test-Dateien sind komplett geskippt (32 Tests). Prüfen ob sie:
- Reparierbar sind → reparieren
- Veraltet sind → löschen
```
tests/server/cache-optimization.test.ts (2 skipped)
tests/server/io-registry-pinmode-tracking.test.ts (4 skipped)
tests/server/cli-label-isolation.test.ts (2 skipped)
tests/server/load-test-100-clients.test.ts (3 skipped)
tests/server/load-test-50-clients.test.ts (3 skipped)
tests/server/load-test-200-clients.test.ts (3 skipped)
tests/server/load-test-500-clients.test.ts (3 skipped)
tests/server/pause-resume-digitalread.test.ts (3 skipped)
tests/server/pause-resume-timing.test.ts (4 skipped)
tests/server/timing-delay.test.ts (2 skipped)
```

---

## Zusammenfassung — Erwartete Coverage nach Phase

| Phase | Maßnahme | Erwartete Coverage |
|-------|----------|-------------------|
| Start | Ist-Stand | **57 %** |
| Phase 1 | Totcode entfernen (reduziert Nenner) | **~60 %** |
| Phase 2 | Hooks extrahieren + testen | **~72–75 %** |
| Phase 3 | Bestehende Tests erweitern | **~77–78 %** |
| Phase 4 | Neue Testdateien | **~80–82 %** |
| Phase 5 | Optional: Skipped Tests + DB-Cleanup | **~83–85 %** |

---

## Regeln für Agenten

1. **Eine Aufgabe = ein Commit.** Aufgaben-ID im Commit verwenden (z.B. `refactor(1.1): remove unused UI components`).
2. **Nach jeder Aufgabe:** `npm run build && npm run test` ausführen. Beide müssen grün sein.
3. **Phase 2 ist sequentiell:** Hooks nacheinander extrahieren, nicht parallel, da sie den gleichen Quellcode ändern.
4. **Phase 1, 3, 4 sind parallelisierbar:** Aufgaben innerhalb einer Phase können in beliebiger Reihenfolge abgearbeitet werden.
5. **Keine neuen Abhängigkeiten hinzufügen** ohne explizite Anweisung.
6. **Keine Funktionalität ändern** — nur Struktur und Tests. Keine UI-Änderungen, kein Feature-Work.
