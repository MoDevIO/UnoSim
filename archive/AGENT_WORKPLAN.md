# 🤖 Agent Workplan: IO-Registry & Analog Pin Frames

**Ziel**: Gelbe Rahmen für alle Pins mit `pinMode(INPUT/INPUT_PULLUP)` anzeigen. Zusätzlich gestrichelte Rahmen für A0-A5 wenn `analogRead()` verwendet.

**Pin-Regeln**:
- **A0-A5 (Pins 14-19)**: 
  - `analogRead()` → **gestrichelt** (dashed)
  - `pinMode(INPUT/INPUT_PULLUP)` → **solid line**
  - Nicht verwendet → kein Rahmen
- **Alle anderen Pins (0-13)**:
  - `pinMode(INPUT/INPUT_PULLUP)` → **solid line**
  - Sonst → kein Rahmen

**Strategie**: Debug-Console ZUERST erstellen, dann schrittweise die Pin-Visualisierung implementieren und dabei die Console zur Verifikation nutzen.

---

## Phase 1: Debug-Console implementieren

### 1.1 Komponente erstellen
**Datei**: `client/src/components/debug-console.tsx`

```typescript
// Dark-themed Console mit:
// - Filterung nach Nachrichtentyp (io_registry, PIN_MODE, simulation_status)
// - Export als JSON
// - Copy to Clipboard
// - Tastenkürzel: Ctrl+Shift+D zum Öffnen
```

**Kern-Features**:
- `useDebugConsole` Hook für Message-Sammlung
- Filterbarer Message-Log
- JSON-Export Button
- Dark Theme (bg-gray-900, text-gray-100)

### 1.2 Integration in Settings-Dialog
**Datei**: `client/src/components/features/settings-dialog.tsx`

- Checkbox "Debug Console aktivieren"
- Speicherung in localStorage

### 1.3 WebSocket-Messages loggen
**Datei**: `client/src/pages/arduino-simulator.tsx`

Bei diesen Message-Typen Debug-Log hinzufügen:
- `io_registry`: Komplette Registry mit allen Pins und usedAt-Operationen
- `PIN_MODE`: Einzelne pinMode-Änderungen
- `simulation_status`: Status-Wechsel (running/paused/stopped)

### ✅ Verifikation Phase 1
```bash
npm run build
```
- [ ] Build erfolgreich
- [ ] Ctrl+Shift+D öffnet Console
- [ ] Sketch laden → Simulate → Console zeigt io_registry Message
- [ ] usedAt-Array enthält Operationen (digitalRead, analogRead, etc.)

---

## Phase 2: IO-Registry Datenfluss sicherstellen

### 2.1 Server: C++ Operations-Tracking prüfen
**Datei**: `server/mocks/arduino-mock.ts`

**Erforderliche Funktionen**:
```cpp
void trackIOOperation(int pin, const std::string& operation) {
  // Fügt Operation zu ioRegistry[pin].operations hinzu
  // operations ist ein Array von {operation, line}
}
```

**Aufgerufene Stellen**:
- `digitalRead()` → `trackIOOperation(pin, "digitalRead")`
- `digitalWrite()` → `trackIOOperation(pin, "digitalWrite")`
- `analogRead()` → `trackIOOperation(pin, "analogRead")`
- `analogWrite()` → `trackIOOperation(pin, "analogWrite")`

**Output-Format** (outputIORegistry):
```
[[IO_PIN:14:0:0:0:analogRead@16:analogRead@17]]
```
Bedeutung: `[[IO_PIN:pin:defined:definedLine:pinMode:op1@line1:op2@line2...]]`

### 2.2 Server: Registry-Parsing prüfen
**Datei**: `server/services/sandbox-runner.ts` (ca. Zeile 490-530)

**Sicherstellen**:
```typescript
// Parse Operations aus "analogRead@16:digitalRead@17" Format
const usedAt: { line: number; operation: string }[] = [];
const opsStr = pinMatch[5];  // Nach dem 5. Doppelpunkt
if (opsStr) {
  const ops = opsStr.split(":");
  ops.forEach(op => {
    const [operation, lineStr] = op.split("@");
    usedAt.push({ line: parseInt(lineStr, 10), operation });
  });
}
```

### 2.3 Client: Registry-State prüfen
**Datei**: `client/src/pages/arduino-simulator.tsx`

**WebSocket Handler** (case "io_registry"):
```typescript
const { registry } = message;
setIoRegistry(registry);
setAnalogPinsUsed(registry
  .filter(r => r.usedAt?.some(u => u.operation === "analogRead"))
  .map(r => parseInt(r.pin, 10))
);
```

### ✅ Verifikation Phase 2
Mit Debug-Console prüfen:
- [ ] io_registry Message enthält `usedAt` Array mit Objekten
- [ ] Objekte haben Format: `{ line: 16, operation: "analogRead" }`
- [ ] `analogPinsUsed` State enthält Pins 14-19 bei analogRead-Nutzung

---

## Phase 3: Pin Frames in SVG - Digital & Analog

### 3.1 Digitale Pins Loop (0-13)
**Datei**: `client/src/components/features/arduino-board.tsx` (ca. Zeile 280-290)

**Logik für Pins 0-13**:
```typescript
for (let i = 0; i < 14; i++) {
  const frame = svg.querySelector(`#pin-${i}-frame`);
  const click = svg.querySelector(`#pin-${i}-click`);
  
  // Zeige Frame nur wenn INPUT/INPUT_PULLUP
  const isInput = isPinInput(i);
  
  if (frame) {
    frame.style.display = isInput ? "block" : "none";
    frame.style.strokeDasharray = "";  // Immer solid
    frame.style.filter = isInput ? "drop-shadow(0 0 2px #ffff00)" : "none";
  }
  
  if (click) {
    click.style.pointerEvents = isInput ? "auto" : "none";
    click.style.cursor = isInput ? "pointer" : "default";
  }
}
```

### 3.2 Analog Pins Loop (A0-A5, Pins 14-19)
**Datei**: `client/src/components/features/arduino-board.tsx` (ca. Zeile 290-345)

**Logik für A0-A5 (Pins 14-19)**:
```typescript
for (let i = 0; i < 6; i++) {
  const pinNumber = 14 + i;  // A0=14, A1=15, ..., A5=19
  const frame = svg.querySelector(`#pin-A${i}-frame`);
  const click = svg.querySelector(`#pin-A${i}-click`);
  
  // Zwei Anzeige-Gründe:
  const isInput = isPinInput(pinNumber);           // pinMode(Ax, INPUT/INPUT_PULLUP)
  const usedAsAnalog = analogPins.includes(pinNumber);  // analogRead(Ax)
  
  const show = isInput || usedAsAnalog;
  const isDashed = show && usedAsAnalog;  // Gestrichelt NUR bei analogRead
  
  if (frame) {
    frame.style.display = show ? "block" : "none";
    // Gestrichelt WENN analogRead, sonst solid
    frame.style.strokeDasharray = isDashed ? "3,2" : "";
    frame.style.filter = show ? "drop-shadow(0 0 2px #ffff00)" : "none";
  }
  
  if (click) {
    click.style.pointerEvents = show ? "auto" : "none";
    click.style.cursor = show ? "pointer" : "default";
  }
}
```

### 3.3 Pin-Mapping verstehen
```
Arduino Code    Interner Pin    SVG-Element       Rahmen-Typ
-----------    ------------    -----------       ----------
0-13           0-13            #pin-0-13-frame   Nur wenn INPUT
A0             14              #pin-A0-frame     INPUT=solid / analogRead=dashed
A1             15              #pin-A1-frame     INPUT=solid / analogRead=dashed
A2             16              #pin-A2-frame     INPUT=solid / analogRead=dashed
A3             17              #pin-A3-frame     INPUT=solid / analogRead=dashed
A4             18              #pin-A4-frame     INPUT=solid / analogRead=dashed
A5             19              #pin-A5-frame     INPUT=solid / analogRead=dashed
```

### ✅ Verifikation Phase 3
Test-Sketch:
```cpp
void setup() { 
  pinMode(A0, INPUT);      // A0 = solid frame
  pinMode(2, INPUT);       // Pin 2 = solid frame
}
void loop() { 
  digitalRead(2);          // Pin 2 = solid frame (INPUT)
  digitalRead(A0);         // A0 = solid frame (INPUT)
  analogRead(A2);          // A2 = dashed frame
  analogRead(A3);          // A3 = dashed frame
}
```

Mit Debug-Console verifizieren:
- [ ] io_registry zeigt Pin 2 mit INPUT + digitalRead
- [ ] io_registry zeigt Pin 14 (A0) mit INPUT + digitalRead
- [ ] io_registry zeigt Pin 16 (A2) mit analogRead
- [ ] Pin 2 hat SOLID gelben Rahmen (INPUT)
- [ ] Pin A0 hat SOLID gelben Rahmen (INPUT)
- [ ] Pin A2 hat DASHED gelben Rahmen (analogRead)
- [ ] Pin A3 hat DASHED gelben Rahmen (analogRead)
- [ ] Pin A1, A4, A5 haben KEINEN Rahmen (nicht verwendet)
- [ ] Pin 3-13 haben KEINEN Rahmen (INPUT nicht gesetzt)

---

## Phase 4: ParserOutput-Tabelle erweitern

### 4.1 Operations in Registry-Tab anzeigen
**Datei**: `client/src/components/features/parser-output.tsx`

**Spalten**:
| Pin | pinMode | digitalRead | digitalWrite | analogRead | analogWrite |

**Daten aus usedAt extrahieren**:
```typescript
const ops = record.usedAt || [];
const digitalReads = ops.filter(u => u.operation === "digitalRead");
const analogReads = ops.filter(u => u.operation === "analogRead");
// etc.
```

### ✅ Verifikation Phase 4
- [ ] Registry-Tab zeigt alle Pins mit Operationen
- [ ] Operationen sind den richtigen Spalten zugeordnet
- [ ] Leere Zellen zeigen "—" statt leer

---

## Phase 5: Click-Handler für Analog-Dialog

### 5.1 Dialog bei Klick öffnen
**Datei**: `client/src/components/features/arduino-board.tsx` (ca. Zeile 680-730)

```typescript
const handleAnalogClick = (pin: number) => {
  const isInputPin = state && (state.mode === "INPUT" || state.mode === "INPUT_PULLUP");
  const usedAsAnalog = analogPins.includes(pin);
  
  if ((isInputPin || usedAsAnalog) && onAnalogChange) {
    setAnalogDialog({
      open: true,
      pin,
      value: currentValue,
      min: 0,
      max: 1023
    });
  }
};
```

### ✅ Verifikation Phase 5
- [ ] Klick auf A0-A5 Frame öffnet Slider-Dialog (0-1023)
- [ ] Wert-Änderung wird an Simulation gesendet
- [ ] Nur klickbar wenn INPUT oder analogRead verwendet

---

## ⚠️ Kritische Implementierungsregeln

### React State in Loops
```typescript
// ❌ NIEMALS:
while (match) {
  setParserMessages(prev => [...prev, msg]);  // RENDER LOOP!
}

// ✅ IMMER:
const msgs = [];
while (match) {
  msgs.push(msg);
}
setParserMessages(prev => [...prev, ...msgs]);
```

### IO-Registry Struktur
```typescript
interface IORegistryEntry {
  pin: string;           // "0", "14", etc.
  defined: boolean;      // pinMode aufgerufen?
  pinMode?: string;      // "INPUT" | "OUTPUT" | "INPUT_PULLUP"
  usedAt: Array<{
    line: number;
    operation: "digitalRead" | "digitalWrite" | "analogRead" | "analogWrite";
  }>;
}
```

### Analog Pin Anzeige-Priorität
1. **A0-A5 mit `analogRead()`** → **gestrichelt** (dashed)
2. **Beliebiger Pin mit `pinMode(INPUT/INPUT_PULLUP)`** → **solid line**
3. Nicht verwendet → kein Rahmen

---

## 🧪 Finaler Test

**io-test.ino**:
```cpp
void setup() {
  pinMode(A0, INPUT);           // A0 = solid frame (INPUT)
  for (byte i=0; i<7; i++) {
    pinMode(i, INPUT);          // 0-6 = solid frames (INPUT)
  }
}

void loop() {
  for (byte i=0; i<7; i++) {
    digitalRead(i);             // Operations in table
  }
  analogRead(A2);               // A2 = dashed frame (analogRead)
  analogRead(A3);               // A3 = dashed frame (analogRead)
  analogRead(A4);               // A4 = dashed frame (analogRead)
  analogRead(A5);               // A5 = dashed frame (analogRead)
}
```

**Erwartetes Ergebnis**:
- Pins 0-6: SOLID gelbe Rahmen (INPUT)
- Pin A0: SOLID gelber Rahmen (INPUT)
- Pins A2-A5: DASHED gestrichelte gelbe Rahmen (analogRead)
- Pins A1: Kein Rahmen (nicht verwendet)
- Registry-Tabelle: Alle Operations sichtbar
- Debug-Console: Vollständige io_registry mit usedAt

---

## 📁 Dateien-Übersicht

| Priorität | Datei | Änderungen |
|-----------|-------|------------|
| 1 | `client/src/components/debug-console.tsx` | NEU erstellen |
| 2 | `client/src/pages/arduino-simulator.tsx` | Debug-Logging, io_registry Handler |
| 3 | `server/mocks/arduino-mock.ts` | trackIOOperation prüfen |
| 4 | `server/services/sandbox-runner.ts` | usedAt Parsing prüfen |
| 5 | `client/src/components/features/arduino-board.tsx` | Analog Frame Logic |
| 6 | `client/src/components/features/parser-output.tsx` | Operations-Spalten |

---

**Geschätzte Bearbeitungszeit**: 2-3 Stunden
**Abhängigkeiten**: Jede Phase baut auf der vorherigen auf
**Erfolgskriterium**: io-test.ino zeigt alle Frames korrekt + Operations in Tabelle
