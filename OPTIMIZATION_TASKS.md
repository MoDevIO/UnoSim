# UnoSim - Optimierungsaufgaben für Agenten

Diese Aufgabenliste enthält priorisierte Optimierungsaufgaben für das UnoSim-Projekt. 
Die Aufgaben sind nach Priorität absteigend sortiert (Kritisch → Hoch → Mittel → Niedrig).

---

## 🔴 KRITISCH (Priorität 1)

### ✅ TASK-001: Toter Code entfernen - `.!36764!code-parser.ts` [ERLEDIGT]
**Datei:** [server/services/.!36764!code-parser.ts](server/services/.!36764!code-parser.ts)
**Problem:** Beschädigte/temporäre Datei im Repository
**Aktion:** Datei löschen - ist eine Duplikat/korrupte Version von `shared/code-parser.ts`
**Geschätzte Zeit:** 5 Minuten
**Status:** ✅ Erledigt am 15.01.2026 - Datei erfolgreich gelöscht

---

### ✅ TASK-002: Duplikat-Datei entfernen - `README copy.md` [ERLEDIGT]
**Datei:** [README copy.md](README%20copy.md)
**Problem:** Unnötige Kopie der README
**Aktion:** Datei löschen
**Geschätzte Zeit:** 2 Minuten
**Status:** ✅ Erledigt am 15.01.2026 - Duplikat-Datei erfolgreich gelöscht

---

### TASK-003: Ungenutzter `ArduinoRunner` entfernen
**Datei:** [server/services/arduino-runner.ts](server/services/arduino-runner.ts)
**Problem:** Klasse wird im Produktionscode NICHT verwendet - nur in Tests. `SandboxRunner` hat die Funktionalität übernommen.
**Überprüfen:**
- Nur ein Import in `tests/server/services/arduino-runner.test.ts`
- Kein Import in `routes.ts` oder anderen Server-Dateien
**Aktion:** 
1. Tests auf SandboxRunner migrieren oder entfernen
2. `arduino-runner.ts` löschen
3. Export `arduinoRunner` entfernen
**Geschätzte Zeit:** 1 Stunde

---

### TASK-004: Demo-Komponente entfernen
**Datei:** [client/src/components/features/parser-output-demo.tsx](client/src/components/features/parser-output-demo.tsx)
**Problem:** Demo-Datei im Produktionscode, wird nirgends importiert
**Aktion:** Datei löschen
**Geschätzte Zeit:** 5 Minuten

---

## 🟠 HOCH (Priorität 2)

### TASK-005: Duplizierung zwischen SandboxRunner und ArduinoRunner beheben
**Dateien:** 
- [server/services/sandbox-runner.ts](server/services/sandbox-runner.ts)
- [server/services/arduino-runner.ts](server/services/arduino-runner.ts)
**Problem:** ~490 Zeilen duplizierter Code
**Gemeinsame Patterns:**
1. Baudrate-Parsing Regex
2. Setup/Loop Detection
3. Footer-Code-Generierung
4. Arduino.h Stripping
5. Pin-State Parsing (4x in sandbox-runner)
6. Error Buffer Processing

**Aktion:** Utility-Modul erstellen: `server/services/runner-utils.ts`
```typescript
export function parseBaudrate(code: string): number;
export function detectSketchStructure(code: string): { hasSetup: boolean; hasLoop: boolean };
export function generateMainFooter(hasSetup: boolean, hasLoop: boolean): string;
export function stripArduinoHeader(code: string): string;
export function parsePinStateMessage(line: string): PinStateUpdate | null;
export function processBufferedLines(buffer: string, newData: string): { lines: string[]; remaining: string };
```
**Geschätzte Zeit:** 3-4 Stunden

---

### TASK-006: Deutsche Texte in User-Facing Components übersetzen
**Dateien mit höchster Priorität:**

#### sketch-tabs.tsx (17 Stellen)
```
Zeile 213: "Zu viele .ino Dateien" → "Too many .ino files"
Zeile 214: "Es darf nur eine .ino Datei geladen werden." → "Only one .ino file can be loaded."
Zeile 231: "Header-Dateien geladen" → "Header files loaded"
Zeile 254: "Datei(en) geladen" → "file(s) loaded"
Zeile 268: "Header-Dateien geladen" → "Header files loaded"
Zeile 269: "Header-Datei(en) hinzugefügt" → "header file(s) added"
Zeile 273: "Keine Header-Dateien" → "No header files"
Zeile 274: "Es waren nur .ino Dateien vorhanden." → "Only .ino files were present."
Zeile 307: "Datei(en) werden heruntergeladen" → "file(s) downloading"
Zeile 313: "Unbekannter Fehler" → "Unknown error"
Zeile 541-553: Dialog vollständig übersetzen
```

#### arduino-simulator.tsx (5 Stellen)
```
Zeile 1661: "Simulation zurücksetzen" → "Reset Simulation"
Zeile 1687: "Simulation nicht aktiv" → "Simulation not active"
Zeile 1688: "Starte die Simulation..." → "Start the simulation..."
Zeile 1715-1716: Gleiche Übersetzungen
```

**Geschätzte Zeit:** 2 Stunden

---

### TASK-007: Deutsche Texte in Server-Code übersetzen
**Dateien:**

#### server/services/sandbox-runner.ts
```
Zeile 95: "Docker Daemon läuft" → "Docker Daemon running"
Zeile 104: "Sandbox Docker Image nicht gefunden" → "Sandbox Docker Image not found"
Zeile 109: "Docker nicht verfügbar" → "Docker not available"
Zeile 219: "Konnte temp Verzeichnis nicht löschen" → "Could not delete temp directory"
Zeile 807: "Simulator läuft nicht" → "Simulator is not running"
Zeile 869: "setPinValue: Simulator läuft nicht" → "setPinValue: Simulator is not running"
```

#### server/services/arduino-compiler.ts
```
Zeile 75: "Fehlende Arduino-Funktionen" → "Missing Arduino functions"
Zeile 146: "Arduino CLI nicht verfügbar" → "Arduino CLI not available"
Zeile 150, 255: "Compilation fehlgeschlagen" → "Compilation failed"
```

#### server/index.ts
```
Zeile 177: "Server läuft auf" → "Server running at"
```

**Geschätzte Zeit:** 1 Stunde

---

### TASK-008: console.log/console.debug Statements entfernen
**Dateien:**
- [client/src/pages/arduino-simulator.tsx](client/src/pages/arduino-simulator.tsx) - 15+ Stellen
- [client/src/hooks/use-websocket.tsx](client/src/hooks/use-websocket.tsx) - 5 Stellen
- [client/src/lib/monaco-error-suppressor.ts](client/src/lib/monaco-error-suppressor.ts) - 1 Stelle

**Aktion:** 
1. Produktiv relevante Logs auf den Logger (`@shared/logger`) umstellen
2. Debug-Logs entfernen oder mit `if (process.env.NODE_ENV === 'development')` schützen

**Stellen in arduino-simulator.tsx:**
```
Zeile 340, 489, 596, 900, 983, 1641, 1781-1784, 1793, 1801, 1804, 2385, 2650
```

**Geschätzte Zeit:** 1-2 Stunden

---

### TASK-009: Ungenutzte Logger-Instanz korrigieren
**Datei:** [client/src/pages/arduino-simulator.tsx](client/src/pages/arduino-simulator.tsx#L41-L44)
**Problem:**
```typescript
const logger = new Logger("ArduinoSimulator");
// Intentionally reference to satisfy no-unused-locals during type check
void logger;
```
**Aktion:** Logger entweder nutzen (statt console.log) oder entfernen
**Geschätzte Zeit:** 30 Minuten

---

## 🟡 MITTEL (Priorität 3)

### TASK-010: Ungenutzte npm-Dependencies entfernen
**Datei:** [package.json](package.json)

**Komplett ungenutzt (sicher entfernbar):**
```json
"@hookform/resolvers",
"@jridgewell/trace-mapping",
"@neondatabase/serverless",
"connect-pg-simple",
"date-fns",
"express-session",
"framer-motion",
"memorystore",
"next-themes",
"passport",
"passport-local",
"react-icons",
"tw-animate-css",
"ansi-to-html",
"zod-validation-error"
```

**Aktion:** 
```bash
npm uninstall @hookform/resolvers @jridgewell/trace-mapping @neondatabase/serverless connect-pg-simple date-fns express-session framer-motion memorystore next-themes passport passport-local react-icons tw-animate-css ansi-to-html zod-validation-error
```

**Geschätzte Zeit:** 30 Minuten (inkl. Build-Test)

---

### TASK-011: Ungenutzte UI-Komponenten entfernen
**Verzeichnis:** [client/src/components/ui/](client/src/components/ui/)

**Ungenutzte Komponenten (nach Import-Suche):**
```
accordion.tsx
aspect-ratio.tsx
avatar.tsx
calendar.tsx
context-menu.tsx
drawer.tsx
form.tsx (+ react-hook-form Dependency)
menubar.tsx
navigation-menu.tsx
pagination.tsx
progress.tsx
radio-group.tsx
sheet.tsx
skeleton.tsx
slider.tsx
switch.tsx
table.tsx
toggle.tsx
toggle-group.tsx
```

**Aktion:** Vor Löschung prüfen mit:
```bash
grep -r "from.*components/ui/accordion" client/src/
```
Dann löschen falls keine Treffer.

**Geschätzte Zeit:** 1 Stunde

---

### TASK-012: Plattform-Detection Helper erstellen
**Problem:** Gleiche Plattform-Erkennung 4x im Frontend wiederholt
**Stellen:**
- [client/src/App.tsx#L24](client/src/App.tsx#L24)
- [client/src/pages/arduino-simulator.tsx](client/src/pages/arduino-simulator.tsx) (3 Stellen)

**Aktion:** Utility erstellen:
```typescript
// client/src/lib/platform.ts
export const isMac = typeof navigator !== 'undefined' && 
  navigator.platform.toUpperCase().includes('MAC');

export const isWindows = typeof navigator !== 'undefined' && 
  navigator.platform.toUpperCase().includes('WIN');
```

**Geschätzte Zeit:** 30 Minuten

---

### TASK-013: Gemeinsame Interfaces zentralisieren
**Problem:** `OutputLine` Interface 4x definiert
**Stellen:**
- arduino-simulator.tsx L47-50
- serial-monitor.tsx L3-6
- serial-plotter.tsx L4-7
- compilation-output.tsx L8

**Aktion:** Nach `shared/schema.ts` verschieben und importieren
**Geschätzte Zeit:** 30 Minuten

---

### TASK-014: Deutsche Dokumentation übersetzen oder entfernen
**Dateien:**
- [IO_REGISTRY_UI.md](IO_REGISTRY_UI.md) - Komplett Deutsch
- [PARSER_CONCEPT.md](PARSER_CONCEPT.md) - Komplett Deutsch
- [PARSER_UI_IMPLEMENTATION.md](PARSER_UI_IMPLEMENTATION.md) - Komplett Deutsch

**Aktion:** 
Option A: Ins Englische übersetzen
Option B: Falls nur interne Doku, Dateinamen mit `_DE` suffix versehen
**Geschätzte Zeit:** 2-3 Stunden

---

### TASK-015: Deutsche Kommentare in Tests übersetzen
**Dateien:**
- tests/client/components/parser-output.test.tsx - 17 deutsche Testnamen
- tests/client/components/serial-monitor.test.tsx - 3 deutsche Testnamen
- tests/server/services/arduino-compiler.test.ts - Kommentare
- tests/server/services/arduino-compiler-parser-messages.test.ts - Kommentare

**Geschätzte Zeit:** 1-2 Stunden

---

## 🟢 NIEDRIG (Priorität 4)

### TASK-016: Deutsche Kommentare in .gitignore übersetzen
**Datei:** [.gitignore](.gitignore)
**Problem:** Alle Kommentare in Deutsch
**Geschätzte Zeit:** 30 Minuten

---

### TASK-017: Deutsche Kommentare im Arduino Mock übersetzen
**Datei:** [server/mocks/arduino-mock.ts](server/mocks/arduino-mock.ts)
**Stellen:** Zeilen 84, 597, 611, 630, 654
**Geschätzte Zeit:** 15 Minuten

---

### TASK-018: Deutsche Kommentare in Example-Dateien übersetzen
**Dateien:**
- public/examples/02-io-projects/08-lcd-backspace-example.ino
- public/examples/03-projects/led-sine-fade.ino
- public/examples/03-projects/path-finder.ino

**Hinweis:** Falls Examples für deutsche Nutzer gedacht sind, ggf. beibehalten
**Geschätzte Zeit:** 30 Minuten

---

### TASK-019: uuid-Generierung vereinheitlichen
**Problem:** Zwei verschiedene UUID-Generierungsmethoden
- `shared/code-parser.ts`: Eigene `generateUUID()` Funktion
- Rest: `crypto.randomUUID()`

**Aktion:** `generateUUID()` durch `crypto.randomUUID()` ersetzen
**Geschätzte Zeit:** 15 Minuten

---

### TASK-020: Kommentierter Code entfernen
**Dateien:**
- [server/index.ts#L183-185](server/index.ts#L183-185) - Auskommentierter Server-Code
- Andere Dateien mit TODO-Kommentaren prüfen

**Geschätzte Zeit:** 30 Minuten

---

### TASK-021: Performance - recharts Bundle Size reduzieren
**Datei:** [client/src/components/features/serial-plotter.tsx](client/src/components/features/serial-plotter.tsx)
**Problem:** `recharts` ist ~400KB groß
**Option A:** Lazy Loading: `const { LineChart } = await import('recharts')`
**Option B:** Leichtere Alternative (Canvas-basiert)
**Geschätzte Zeit:** 2-3 Stunden

---

### TASK-022: Monaco Editor Lazy Loading
**Datei:** [client/src/components/features/code-editor.tsx](client/src/components/features/code-editor.tsx)
**Problem:** monaco-editor ist ~4MB
**Aktion:** Prüfen ob `@monaco-editor/react` besseres Code-Splitting bietet
**Geschätzte Zeit:** 2-3 Stunden

---

## 📋 Zusammenfassung

| Priorität | Anzahl Tasks | Geschätzte Gesamtzeit |
|-----------|-------------|----------------------|
| 🔴 Kritisch | 4 | ~1,5 Stunden |
| 🟠 Hoch | 5 | ~8-10 Stunden |
| 🟡 Mittel | 6 | ~5-7 Stunden |
| 🟢 Niedrig | 7 | ~6-8 Stunden |
| **Gesamt** | **22** | **~20-26 Stunden** |

---

## Empfohlene Reihenfolge

1. **Zuerst:** TASK-001 bis TASK-004 (Toter Code entfernen)
2. **Dann:** TASK-006 + TASK-007 (Sprache vereinheitlichen)
3. **Dann:** TASK-008 + TASK-009 (Logging aufräumen)
4. **Dann:** TASK-010 + TASK-011 (Dependencies aufräumen)
5. **Danach:** TASK-005 (Große Refactoring-Aufgabe)
6. **Zum Schluss:** Restliche Tasks nach Verfügbarkeit

---

*Erstellt am: 15. Januar 2026*
*Für: UnoSim Projekt*
