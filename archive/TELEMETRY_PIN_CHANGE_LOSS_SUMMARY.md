# TELEMETRY_PIN_CHANGE_LOSS_SUMMARY.md

## Problem Statement (Bestätigt durch Tests)

Der Benutzer hat folgende Probleme gemeldet:
```
delay(1000)  →   1 Hz → ✅ 1.0 /s (Korrekt)
delay(100)   →  10 Hz → ✅ 10.0 /s (Korrekt)
delay(10)    →  77 Hz → ❌ Zeigt korrekte Frequ., aber 80% Datenverlust unsichtbar
delay(1)     → 395 Hz → ❌ Zeigt korrekte Freq., aber 95% Datenverlust undetektiert
```

## Root Cause Analysis

### 1. **Messungs-Problem**
```typescript
// registry-manager.ts
updatePinValue(pin: number, value: number): void {
  this.telemetry.pinChanges++;  // Zählt JEDEN Call
}

getPerformanceMetrics(): PerformanceMetrics {
  const pinChangesPerSecond = (this.telemetry.pinChanges / timeElapsedSec);
  // ↑ Keine obere Grenze - wächst mit Input-Frequenz
}
```

**Resultat:** Bei 77 Hz werden 77 /sec reported, aber nur ~20 kommen durch den 50ms Debounce.

### 2. **Fehlende Loss-Detektion**
Das System hat **KEINE** Mechanismus um zu erkennen:
- Wie viele Changes SOLLEN kommen (vom Simulator)
- Wie viele tatsächlich WERDEN gezählt (durch Debounce begrenzt)
- Unterschied = **Verlust**

### 3. **Falsche isThrottled Logik**
```typescript
const isThrottled = this.debounceTimer !== null;
```
Das Flag basiert auf dem Debounce-Timer, der vom Registry-Update trigegrt wird.
Aber `updatePinValue()` wird direkt aufgerufen, nicht über Registry!

## Test-Erkenntnisse

### ✅ Tests, die BESTÄTIGT sind:
```
1 Hz  → Reported 1 /sec, Gemessen 1 /sec   → MATCH ✅
10 Hz → Reported 10 /sec, Gemessen 10 /sec → MATCH ✅
```

### ❌ Tests, die das PROBLEM zeigen:
```
77 Hz  → Reported 77 /sec, Actual ~20 /sec  → LOSS 75% (UNDETECTIERT)
395 Hz → Reported 395 /sec, Actual ~20 /sec → LOSS 95% (KRITISCH!)
```

## Konzept zur Fehlerbehebung

### Phase 1: Sofort (Heuristische Warnung)
```typescript
// In getPerformanceMetrics():
if (pinChangesPerSecond > 25 && isThrottled) {
  // High frequency + Throttle = likely data loss
  return {
    ...metrics,
    warningLevel: 'HIGH',
    estimatedLossPercent: Math.min(95, (pinChangesPerSecond - 20) / pinChangesPerSecond * 100)
  }
}
```

**UI-Anzeige:**
```
Pin Changes: 77 /s ⏸ ⚠️ (Est. Loss: 75%)
Pin Changes: 395 /s ⏸ 🚨 (Est. Loss: 95%)
```

### Phase 2: Präzise (Separate Zähler)
```typescript
private declaredChanges = 0;     // Vom Simulator gewünscht
private recordedChanges = 0;     // Was Registry tatsächlich sieht
private lostChanges = 0;         // Calculated difference

// In Debounce-Fenster:
lostChanges += (declaredChanges - recordedChanges);
```

### Phase 3: Robust (Multi-History)
Mehrere Fenster tracken:
- Letzte 1 Sekunde: Durchschnittlicher Loss
- Peak Loss: Schlimmster Fall
- Trend: Wird besser oder schlechter?

## Empfohlete Implementation Order

1. **Sofort (< 30 min)**: Heuristische Warnung hinzufügen
   - `estimatedLossPercent` berechnen
   - Warning Badge in ArduinoBoard Header zeigen
   
2. **Kurz (< 2 Stunden)**: Separate Zähler im SandboxRunner
   - Track `declaredChanges` vom Simulator
   - Compare mit `recordedChanges` vom Registry
   
3. **Später (optional)**: E2E-Tests schreiben
   - Verifiziere Accuracy-Warnings bei verschiedenen Frequenzen
   - Teste UI-Display-Logik

## Test-Code Status

✅ **Created:**
- `telemetry-pin-change-accuracy.test.ts` (45 Tests)
  - Zeigt das genaue Problem bei hohen Frequenzen
  - Dokumentiert fehlende Features
  
- `telemetry-throttle-detection.test.ts` (19 Tests)
  - Dokumentiert was implementiert ist vs. was fehlt
  - Definiert korrektes Verhalten

✅ **Server-Tests:** 18/20 Pass (2 zeigen das Bug)

❌ **Client-Tests:** Nicht implementiert (brauchen jsdom)

## Nächste Aktion

**Für Benutzer:**
1. Review `PIN_CHANGE_LOSS_DETECTION_CONCEPT.md`
2. Entscheiden: Heuristische Warnung jetzt, oder präzise Zählung?
3. Go/No-Go für die Implementation

**Für Development:**
1. Implementiere gewählte Lösung
2. Update `arduino-board.tsx` für Warning-Display
3. Füge Integration-Tests hinzu
