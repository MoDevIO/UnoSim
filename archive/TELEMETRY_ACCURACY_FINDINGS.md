# TELEMETRY_ACCURACY_FINDINGS.md

## Erkannte Probleme

### Problem 1: Unbegrenzte Pin-Change-Zählung
Die aktuelle Implementation zählt jeden `updatePinValue()` Call ohne Begrenzung:
- **delay(10)** → 100 Hz → reported as **100 /sec** ✗
- **delay(1)** → 1000 Hz → reported as **1000 /sec** ✗

**Erwartetes Verhalten:**
- should be capped at ~20 /sec due to 50ms debounce

**Root Cause:**
```typescript
// registry-manager.ts (aktuell)
updatePinValue(pin: number, value: number): void {
  this.telemetry.pinChanges++;  // ← Zählt jeden Call!
  // Debounce wirkt NICHT auf diesen Counter
}

getPerformanceMetrics(): PerformanceMetrics {
  const pinChangesPerSecond = Math.round(
    (this.telemetry.pinChanges / timeElapsedSec) * 10
  ) / 10;  // ← Keine obere Grenze!
}
```

**Wirkung:**
- User sieht hohe Zahlen (100+) aber denkt, alles ist OK
- Tatsächlich werden viele Changes durch Debounce verschluckt
- **Keine Warnung** dass Daten verloren gehen

### Problem 2: `isThrottled` Flag funktioniert nicht wie erwartet
```typescript
const isThrottled = this.debounceTimer !== null;
```

**Aktuell:** 
- true = Debounce-Timer ist aktiv
- Aber `updatePinValue()` wird direkt aufgerufen, nicht durch Registry

**Konsequenz:**
- `isThrottled` ist oft false, obwohl du 1000 /sec schickst
- User wird nicht gewarnt

### Problem 3: Keine Verlust-Erkennung
Wenn `pinChangesPerSecond` > 25, sollte ein Flag `possibleLoss` gesetzt werden:
```typescript
// MISSING:
const possibleLoss = pinChangesPerSecond > 25 && isThrottled;
```

## Empfohlene Lösungen

### Sofort (Low Effort):
```typescript
// 1. Erkenne wenn Changes zu schnell kommen
const isHighFrequency = pinChangesPerSecond > 25;

// 2. Warnung wenn gleichzeitig throttled
const shouldWarn = isHighFrequency && isThrottled;

// 3. UI zeigt: "⚠️ Throttled - Data Loss Detected"
```

### Kurz (Medium Effort):
```typescript
// Pro Debounce-Fenster: Wie viele Pin-Changes hätten sein sollen vs. sind erfasst?
private debounceActivationCount = 0;
private estimatedChangesInDebounceWindow = 0;

// Nach Debounce abgelaufen:
estimatedLoss = estimatedChangesInDebounceWindow - actualCounted;
```

### Optimal (High Effort):
```typescript
// Separate Zähler für:
private actualPinChanges = 0;      // Alle, was simulator macht
private recordedPinChanges = 0;    // Was erfasst wurde
private lostPinChanges = 0;        // Geschätzte Verluste

// Bei Debounce:
if (this.debounceActive) {
  this.lostPinChanges += (actualPinChanges - recordedPinChanges);
}
```

## Test-Befunde

### Test: delay(1000) - 1 Hz
```
Expected:  1 /sec ✅
Actual:    1 /sec ✅
Status:    OK - No loss
```

### Test: delay(100) - 10 Hz
```
Expected:  10 /sec ✅
Actual:    10 /sec ✅
Status:    OK - No loss
```

### Test: delay(10) - 100 Hz
```
Expected:  ~20 /sec (capped by debounce)
Actual:    100 /sec ✗
Status:    ERROR - Misleading rate, data loss undetected!
Missing:   ⚠️ Warning that 80% data is lost
```

### Test: delay(1) - 1000 Hz
```
Expected:  ~20 /sec (capped by debounce)
Actual:    1000 /sec ✗
Status:    ERROR - Severely misleading, 99% data loss undetected!
Missing:   🚨 CRITICAL warning
```

## UI Impact

### Current Header (Misleading)
```
Pin Changes: 1000 /s ⏸
```
User thinks: "Wow, 1000 pin changes per second, that's fast!"

### Improved Header (Informing)
```
Pin Changes: 1000 /s ⏸ (Est. Loss: 95%)
```
User understands: "Okay, I intended 1000, but 950 are lost due to throttling"

### Warning Threshold
```
Loss < 25%:  No warning
Loss 25-50%: Yellow warning "⚠️ Some data loss"
Loss > 50%:  Red warning "🚨 Severe data loss - increase delay()"
```

## Test Coverage Needed

1. ✅ Verify rates at low frequencies (1, 5, 10 Hz) - should be accurate
2. ❌ Verify cap/warning at high frequencies (50+ Hz) - CURRENTLY FAILING
3. ✅ Verify isThrottled flag
4. ❌ Verify loss estimation - CURRENTLY MISSING
5. ❌ Verify UI warning display - CURRENTLY MISSING

## Next Steps

1. **Document** current behavior (▲ THIS FILE)
2. **Update tests** to reflect realistic expectations
3. **Implement** loss detection in RegistryManager
4. **Update UI** to show warnings
5. **Validate** with actual user scenarios
