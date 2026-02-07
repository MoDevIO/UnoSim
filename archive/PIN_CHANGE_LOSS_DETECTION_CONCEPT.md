# PIN_CHANGE_LOSS_DETECTION_CONCEPT.md

**Problem:** Bei Frequenzen > ~20Hz werden Pin-Changes durch Debouncing verlorengegangen und nicht erkannt.

## Aktuelle Situation

### Debounce-Mechanismus
- **50ms Debounce-Timer** in `registry-manager.ts`
- Verhindert zu häufige Registry-Updates an den Client
- **Seiteneffekt:** Viele Pin-Changes werden nicht gezählt!

### Beispiele
```
delay(1000)  → 1 Hz   → ✅ Alle Changes erfasst
delay(100)   → 10 Hz  → ✅ Alle Changes erfasst  
delay(10)    → 100 Hz → ❌ ~80 Changes verlorengegangen (nur ~20 erfasst)
delay(1)     → 1000 Hz → ❌ ~980 Changes verlorengegangen (nur ~20 erfasst)
```

### Warum passiert das?
```
Debounce-Fenster = 50ms
Max erfassbare Changes = 1000ms / 50ms = 20 Changes/sec

Bei 77Hz (10ms Delay):
- 77 tatsächliche Changes in 1 Sekunde
- Nur 20 werden durch Registry-Callbacks gezählt
- 57 werden "verschluckt" vom Debounce
```

## Lösungskonzept: Digitale Fingerprinting

### Idee
Statt Pin-Changes über Registry-Callbacks zu zählen, **digitale Signatur des letzten Zustands** vergleichen:

```
lastStateFingerprint = {
  timestamp: ms,
  state: {
    "13": { mode: "OUTPUT", value: 1, pwm: null },
    "12": { mode: "INPUT", value: 0, pwm: null },
    ...
  }
}

currentStateFingerprint = {
  timestamp: ms + elapsed,
  state: {...}
}

deltaPins = count(changed properties)
```

### Vorteil
- **Unabhängig vom Debounce-Mechanismus**
- Zählt **tatsächliche** Pin-Changes, nicht nur die, die durch Registry kommen
- Erkennt auch mehrfache Changes im selben Debounce-Fenster

## Implementierungsstrategie

### A) Minimalistisch: "Throttle Indicator" (jetzt machbar)
```typescript
interface PerformanceMetrics {
  pinChangesPerSecond: number;      // Current count (may be capped)
  pinChangesDeclared: number;       // What was declared (new!)
  isThrottled: boolean;              // Current debounce active
  throttledChanges?: number;         // Detected loss (new!)
}
```

**Anzeige im UI:**
```
Pin Changes: 20 /s (⏸ Throttled - 57 lost)
```

### B) Präzise: Change Counter im Sandbox-Runner (empfohlen)
```typescript
// sandbox-runner.ts
private pinChangeCounter = 0;

onPinValueChange = (pin: number, value: number) => {
  this.pinChangeCounter++;
  // Periodically report to registry manager
}
```

Dann:
```typescript
// registry-manager.ts
private declaredPinChanges = 0;  // From sandbox-runner
private recordedPinChanges = 0;  // What we counted

getLossPercentage(): number {
  return (declaredPinChanges - recordedPinChanges) / declaredPinChanges * 100;
}
```

### C) Advanced: Heuristische Schätzung (robust)
```typescript
// Wenn isThrottled === true und pinChangesPerSecond nahe an Limit (20),
// schätze fehlende Changes basierend auf:
// - Debounce Häufigkeit
// - Zeitverlauf seit letztem nicht-throttled State
// - Input-Signal-Frequenz (falls erkennbar)

estimatedLoss = debounceCount * (averageChangesPerDebounceWindow - 1)
```

## Empfohlene Umsetzung: 2-Phasen

### Phase 1: Immediate Win (heute)
1. Zeige `isThrottled` Flag in Pin-Changes Header
2. Zeige "Throttled - Possible Loss Detected" Warnung
3. Implementiere Heuristische Schätzung der verlorenen Changes

### Phase 2: Precise Counting (später)
1. Baue Change-Counter im Sandbox-Runner
2. Compare mit Registry-Manager-Zähler
3. Berechne echte Verlustquote

## Test-Szenarien

### Test 1: No Loss (1 Hz)
```cpp
delay(1000);  // 1 Hz
// Expected: pinChangesPerSecond ≈ 1, isThrottled ≈ false, loss ≈ 0%
```

### Test 2: No Loss (10 Hz)
```cpp
delay(100);  // 10 Hz
// Expected: pinChangesPerSecond ≈ 10, isThrottled ≈ false, loss ≈ 0%
```

### Test 3: Moderate Throttling (50 Hz)
```cpp
delay(20);  // 50 Hz
// Expected: pinChangesPerSecond ≈ 20, isThrottled ≈ true, loss ≈ 60%
```

### Test 4: Severe Throttling (100+ Hz)
```cpp
delay(10) or delay(1);  // 100+ Hz
// Expected: pinChangesPerSecond ≈ 20, isThrottled ≈ true, loss ≈ 80-99%
```

## Display-Konzept

### Arduino Board Header
```
Current:
Pin Changes: 20.5 /s ⏸

Improved:
Pin Changes: 20 /s ⏸ (Est. Loss: 75%) ⚠️
```

### Serial Monitor Header (optional)
```
Serial Output: 150 /s (No Loss)
```

### Info Tooltip (on hover)
```
Throttled: Pin changes are being debounced
The system can process max 20 changes/sec
You're sending ~77+ per second
Detected Loss: ~57 changes
Solution: Increase delay() or use different output strategy
```

## Code-Änderungen Nötig

1. **registry-manager.ts**
   - Add `throttledChanges` counter
   - Track debounce events
   - Calculate loss percentage

2. **arduino-board.tsx**
   - Display throttle status with loss estimate
   - Show warning when loss > threshold

3. **Tests**
   - Verify loss detection at various frequencies
   - Verify throttle flag accuracy
   - Verify UI warning visibility

## Metriken zur Überwachung

1. **Throttle Hit Rate**: `throttleActiveTime / totalTime %`
2. **Loss Percentage**: `(declaredChanges - recordedChanges) / declaredChanges %`
3. **Effective Sample Rate**: `recordedChanges / maxPossibleChanges`
4. **Signal-to-Noise**: Only measure when isThrottled === true

---

**Status:** Konzept fertig, wartend auf Freigabe für Implementation
**Priorität:** High - Benutzer sollen wissen, wenn Daten verloren gehen!
