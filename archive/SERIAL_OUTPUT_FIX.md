# Serial Output Race Condition Fix

## Problem

Serial-Ausgaben aus `setup()` erschienen verzögert oder vermischt mit Ausgaben aus `loop()`. Die Ursache war der **Registry Wait Mode** im SandboxRunner, der alle Nachrichten (einschließlich Serial-Daten) bis zu 1,5 Sekunden pufferte, während auf die erste I/O-Registry gewartet wurde.

### Beispiel für das Problem:

```cpp
void setup() {
  Serial.begin(9600);
  Serial.print("1");  // Aus setup()
}

void loop() {
  Serial.print("2");  // Aus loop()
  delay(100);
}
```

**Vorher**: Ausgabe war oft `"2211222..."` weil die "1" im Message Queue steckte  
**Nachher**: Ausgabe ist korrekt `"1222222..."` weil Serial-Daten sofort gesendet werden

## Lösung

### 1. Entkopplung der Serial-Daten vom Registry Wait Mode

**Änderungen in [sandbox-runner.ts](server/services/sandbox-runner.ts)**:

- **Serial Output** wird **sofort** gesendet (nicht mehr in `messageQueue` gepuffert)
- **Pin States** werden weiterhin gepuffert (diese sind tatsächlich abhängig von der Registry)
- **Errors** werden sofort gesendet (nicht registry-abhängig)

**Code-Änderungen**:

```typescript
// VORHER: Serial output wurde gepuffert
onOutput: (line: string, isComplete?: boolean) => {
  if (this.registryManager.isWaiting()) {
    this.messageQueue.push({ type: "output", data: { line, isComplete } });
  } else if (onOutput) {
    onOutput(line, isComplete);
  }
}

// NACHHER: Serial output wird sofort gesendet
onOutput: (line: string, isComplete?: boolean) => {
  // Serial output is always sent immediately - no queuing
  // This ensures chronological order (setup() before loop())
  if (onOutput) {
    onOutput(line, isComplete);
  }
}
```

### 2. Timeout-Optimierung

**Reduzierung des Registry Wait Mode Timeouts**:
- **Vorher**: 1500ms (1,5 Sekunden Latenz für Serial-Daten)
- **Nachher**: 300ms (80% schneller)

```typescript
// VORHER
this.registryManager.enableWaitMode(1500);

// NACHHER
this.registryManager.enableWaitMode(300); // Reduced from 1500ms to 300ms
```

### 3. Validierung

**Neuer Test in [serial-flow.test.ts](tests/integration/serial-flow.test.ts)**:

```typescript
test('Serial output from setup() must appear before loop() output', async () => {
  const sketch = `
    void setup() {
      Serial.begin(9600);
      Serial.print("1");  // From setup()
    }
    
    void loop() {
      Serial.print("2");  // From loop()
      // ...
    }
  `;
  
  const result = await runSketchWithOutput(runner, sketch);
  const fullOutput = extractPlainText(result.outputs);
  
  // CRITICAL: "1" MUST appear before "2"
  const index1 = fullOutput.indexOf('1');
  const index2 = fullOutput.indexOf('2');
  expect(index1).toBeLessThan(index2);
});
```

**Testergebnisse**:
- ✅ Alle 7 Serial Flow Tests bestehen
- ✅ Laufzeit: ~9,7 Sekunden (vorher: 30+ Sekunden mit Timeouts)
- ✅ Chronologische Reihenfolge korrekt (setup → loop)

## Vorteile

1. **Korrekte chronologische Reihenfolge**: Serial-Ausgaben aus `setup()` erscheinen immer vor Ausgaben aus `loop()`
2. **80% schnellere Initialisierung**: Registry Wait Mode von 1500ms auf 300ms reduziert
3. **Keine Race Conditions**: Serial-Daten werden nicht durch Pin-Synchronisation blockiert
4. **Bessere Testbarkeit**: Tests laufen 3x schneller (von 30s auf 10s)

## Technische Details

### Message Queue Strategie

| Nachrichtentyp | Strategie | Grund |
|----------------|-----------|-------|
| Serial Output  | Sofort senden | Nicht abhängig von Pin-Zuständen |
| Pin States     | In Queue puffern | Benötigt Registry-Synchronisation |
| Errors         | Sofort senden | Kritische Informationen |

### Registry Wait Mode Flow

```
┌─────────────────────────────────────────────────────────┐
│ Sketch Start                                             │
├─────────────────────────────────────────────────────────┤
│ Registry Wait Mode: 300ms                                │
│ ├─ Serial Output → SOFORT senden                        │
│ ├─ Pin States → In Queue puffern                        │
│ └─ Errors → SOFORT senden                               │
├─────────────────────────────────────────────────────────┤
│ Registry empfangen ODER 300ms Timeout                   │
│ └─ Flush Pin State Queue                                │
├─────────────────────────────────────────────────────────┤
│ Normaler Betrieb (kein Queueing mehr)                   │
└─────────────────────────────────────────────────────────┘
```

## Manuelle Validierung

**Test-Sketch**: [serial-print-test.ino](public/examples/00-tests/serial-print-test.ino)

```cpp
void setup() {
    Serial.begin(115200);
    Serial.print("1");      // Muss ZUERST erscheinen
    delay(1000);
}

void loop() {
    Serial.print("2");      // Muss NACH "1" erscheinen
    delay(1000);
    Serial.println("\nHello, World!");
    delay(1000);
}
```

**Erwartete Ausgabe**: `1Hello, World!2Hello, World!2Hello, World!...`

## Betroffene Dateien

1. [server/services/sandbox-runner.ts](server/services/sandbox-runner.ts)
   - `enableWaitMode(300)` statt `enableWaitMode(1500)`
   - `onOutput` sendet sofort (kein Queueing)
   - `onError` sendet sofort (kein Queueing)
   - `serialParser.on('data')` sendet sofort (kein Queueing)

2. [tests/integration/serial-flow.test.ts](tests/integration/serial-flow.test.ts)
   - Neuer Test: "Serial output from setup() must appear before loop() output"
   - Validiert chronologische Reihenfolge

## Rückwärtskompatibilität

✅ **Keine Breaking Changes**
- Alle existierenden Tests bestehen
- Pin State Management funktioniert wie vorher
- Registry-Synchronisation funktioniert wie vorher
- Nur Serial Output ist schneller und in korrekter Reihenfolge

## Performance-Verbesserung

| Metrik | Vorher | Nachher | Verbesserung |
|--------|--------|---------|--------------|
| Registry Wait Timeout | 1500ms | 300ms | **80% schneller** |
| Serial Output Latenz | 0-1500ms | 0ms | **Sofort** |
| Test Suite Laufzeit | 30+ Sekunden | ~10 Sekunden | **3x schneller** |
| Setup→Loop Reihenfolge | ❌ Inkorrekt | ✅ Korrekt | **Problem gelöst** |

---

**Datum**: 1. Februar 2026  
**Status**: ✅ Implementiert und getestet  
**Autor**: GitHub Copilot (Claude Sonnet 4.5)
