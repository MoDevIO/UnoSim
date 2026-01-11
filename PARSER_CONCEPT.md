# Parser & Validierungs-Fenster - Konzept

## 1. Existierende Parsing-Funktionen

### 1.1 Im `ArduinoCompiler` (server/services/arduino-compiler.ts)

**Serial-Validierung (Lines 70-88):**
- ✅ `Serial.begin()` vorhanden?
- ✅ `Serial.begin()` ist auskommentiert?
- ✅ Baudrate korrekt? (erwartet: 115200)
- Ausgabe: Warnings im Array (Lines 44, 76, 83, 88)

**Struktur-Validierung:**
- ✅ `void setup()` vorhanden?
- ✅ `void loop()` vorhanden?

### 1.2 Im `SandboxRunner` (server/services/sandbox-runner.ts)

**Struktur-Parsing während Ausführung:**
- Detektiert Pin-State Nachrichten: `[[PIN_MODE:...]]`, `[[PIN_VALUE:...]]`, `[[PIN_PWM:...]]`
- Detektiert Serial-Events: `[[SERIAL_EVENT_JSON:...]]`
- Output-Size-Limitierung: "Output size limit exceeded"

### 1.3 Im Frontend (client/src/pages/arduino-simulator.tsx)

**Pin-Konflikt-Analyse:**
- Lines ~1100-1200: Analysiert `pinMode()`, `digitalWrite()`, `analogRead()`, `analogWrite()`
- Erkennt Konflikte: Pins als Digital UND Analog benutzt
- Gibt Warnung: `⚠️ Pin usage conflict: ...`

**Memory-Parsing:**
- Extrahiert aus Compiler-Output: Speichernutzung RAM/FLASH

---

## 2. Sinnvolle weitere Parser

### 2.1 **Code-Struktur Parser**
- [ ] Unangepasste Funktionssignaturen (z.B. `setup()` mit Parametern)
- [ ] Fehlende oder redundante `void` Keywords
- [ ] Unbekannte Arduino-Funktionen/Bibliotheken

### 2.2 **Serial/Communication Parser**
- [ ] Fehlende `Serial.println()` bei Output-Code
- [ ] Veraltete Baudrate-Werte (unter 115200 -> Performance-Warnung)

### 2.3 **Hardware-Kompatibilität Parser**
- [ ] PWM-Pins richtig verwendet? (nur D3,D5,D6,D9,D10,D11 auf UNO)

### 2.4 **Performance & Sicherheit Parser**
- [ ] Endlose Schleifen ohne delay() oder yield()
- [ ] Sehr große Arrays/Strings (RAM-Overflow Risiko)
- [ ] Stack Overflow Risiko (tiefe Rekursion)
- [ ] Timing-kritische Operationen (z.B. alle 1ms)

### 2.5 **Library/Dependency Parser**
- [ ] Inkompatible Libraries
- [ ] Duplicate includes

---

## 3. Implementierungs-Architektur

### 3.1 **UI-Struktur**

```
┌──────────────────────────────────────────┐
│            Editor                         │
├──────────────────────────────────────────┤
│      Parser Messages (NEW)                │  ← Zeigt PARSER WARNINGS
│  ⚠️ 3 issues found:                       │  
│    • Serial.begin(9600) wrong baudrate   │
│    • Pin conflict: pins 2 & A0           │
├──────────────────────────────────────────┤
│       Compiler Output                     │
│  Board: Arduino UNO                       │
│  Sketch uses 2048 Bytes                   │
└──────────────────────────────────────────┘
```

**Positionierung:**
- ✅ Über dem Compiler-Fenster
- ✅ Unter dem Editor
- ✅ Resizable (Min 50px, Standard 80px)
- ✅ Nur sichtbar, wenn Parser-Meldungen existieren
- ✅ Collapsible Header mit Badge (Anzahl der Issues)

### 3.2 **Datenfluss**

```
CODE ÄNDERN
    ↓
Parser läuft sofort (client-seitig schnell)
    ↓
Sammelt alle Warnings/Errors in Array
    ↓
State Update: parserMessages
    ↓
Panel erscheint/verschwindet automatisch
    ↓
KOMPILIEREN klicken
    ↓
Weitere Server-seitige Parser (ArduinoCompiler)
    ↓
Gesamtergebnis: Parser-Window + Compiler-Output
```

### 3.3 **Parser-Engine Struktur**

#### **Backend-Parser (Server)**
Datei: `server/services/code-parser.ts` (NEW)

```typescript
export interface ParserMessage {
  id: string;
  type: 'warning' | 'error' | 'info';
  category: 'serial' | 'hardware' | 'structure' | 'performance' | 'library';
  severity: 1 | 2 | 3;  // 1=Info, 2=Warning, 3=Critical
  line?: number;
  column?: number;
  message: string;
  suggestion?: string;
  autoFix?: () => string;
}

export class CodeParser {
  parseSerialConfig(code: string): ParserMessage[];
  parseHardwareCompatibility(code: string): ParserMessage[];
  parseStructure(code: string): ParserMessage[];
  parsePerformance(code: string): ParserMessage[];
  parseLibraries(code: string): ParserMessage[];
  
  parseAll(code: string): ParserMessage[];
}
```

#### **Frontend-Parser (Client)**
Datei: `client/src/lib/code-parser.ts` (NEW)

```typescript
export function parseClientCode(code: string): ParserMessage[] {
  const messages: ParserMessage[] = [];
  
  // Schnelle Client-seitige Validierung
  messages.push(...detectPinConflicts(code));
  messages.push(...detectSerialIssues(code));
  messages.push(...detectStructureIssues(code));
  
  return messages;
}
```

### 3.4 **Component-Struktur**

Neue Dateien:
- `client/src/components/features/parser-output.tsx` - Das neue Parser-Panel
- `server/services/code-parser.ts` - Parser-Engine
- Tests für jeden Parser

### 3.5 **Integration mit bestehendem System**

**ArduinoCompiler erweitern:**
```typescript
export interface CompilationResult {
  // ... existierende Felder
  parserMessages?: ParserMessage[];  // NEW
}
```

**WebSocket erweitern:**
```typescript
z.object({
  type: z.literal("parser_messages"),
  messages: z.array(/* ParserMessage */)
})
```

---

## 4. Detailliertes Implementation Plan

### Phase 1: Foundations
1. [ ] `ParserMessage` Interface in `shared/schema.ts` definieren
2. [ ] `CodeParser` Klasse mit bestehenden Validierungen migrieren
3. [ ] Parser-Output Component (`parser-output.tsx`) erstellen
4. [ ] State Management erweitern (`parserMessages`)

### Phase 2: Parser-Funktionen
5. [ ] Serial-Validator komplett ausarbeiten
6. [ ] Pin-Konflikt-Detektor verbessern
7. [ ] Hardware-Kompatibilität Parser
8. [ ] Performance-Warning Parser

### Phase 3: UI/UX
9. [ ] Parser-Panel integrieren in Layout
10. [ ] Styling und Interaktivität
11. [ ] Auto-fix Funktionen (wo sinnvoll)
12. [ ] Quick-Jump zu Problemzeile im Editor

### Phase 4: Testing & Optimization
13. [ ] Unit Tests für alle Parser
14. [ ] E2E Tests
15. [ ] Performance-Optimierung (schnelle Prüfungen first)
16. [ ] User Feedback Loop

---

## 5. Priorisierung der Parser

### Sofort (Quick Wins):
1. **Serial.begin() Validator** → existiert bereits
2. **Pin Conflict Detector** → teilweise vorhanden
3. **Structure Validator** (setup/loop) → existiert bereits

### Kurz-Fristig (High Value):
4. **PWM Pin Validator**
5. **Blocking Loop Detector**
6. **Comment/Whitespace Analyzer**

### Mittelfristig (Nice to Have):
7. **Memory Estimator**
8. **Library Conflict Detector**
9. **Timing Analysis**

### Langfristig (Future):
10. **AI-assisted suggestions**
11. **Performance Profiling**

---

## 6. Message-Kategorien Übersicht

| Kategorie | Icon | Farbe | Beispiele |
|-----------|------|-------|----------|
| **serial** | 📡 | Orange | Baudrate, Serial.begin Fehler |
| **hardware** | 🔌 | Red | Pin-Konflikte, PWM Pins |
| **structure** | 🏗️ | Yellow | setup/loop Fehler |
| **performance** | ⚡ | Purple | Endlosschleifen, Stack |
| **library** | 📚 | Blue | Includes, Dependencies |

---

## 7. Beispiel-Messages

```
⚠️ Serial Configuration Issues (2)
  • ⛔ Critical: Serial.begin(9600) wrong baudrate - use 115200
  • ⚠️ Warning: No Serial output code detected

🔌 Hardware Compatibility Issues (3)
  • Pin 2 & A0 conflict (digital vs analog)
  • PWM on pin 8 not supported on UNO
  • ℹ️ SPI pins in use (11,12,13)

🏗️ Structure Issues (0)

⚡ Performance Warnings (1)
  • ⚠️ Potential blocking loop detected at line 15
  
Suggestions:
  [Auto-Fix] → Change to Serial.begin(115200)
  [Learn More] → PWM Pin Compatibility
```

---

## 8. Technische Notizen

- **Performance**: Parser laufen asynchron, nicht-blockierend
- **Caching**: Parse-Ergebnisse können mit Code-Hash gecacht werden
- **Incrementality**: Nur betroffene Parser-Kategorien neu-evaluieren bei Changes
- **LSP-Integration**: Zukünftig über Language Server Protocol
- **Accessibility**: ARIA-Labels, Tastatur-Navigation

---

## Nächste Schritte

1. **Feedback einholen** zu dieser Konzept-Struktur
2. **Interfaces definieren** und in `shared/schema.ts` eintragen
3. **Parser-Engine** in `server/services/code-parser.ts` implementieren
4. **UI-Component** erstellen
5. **Integration** mit bestehendem Compiler durchführen
