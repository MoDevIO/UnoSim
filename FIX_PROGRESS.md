# Test-Isolation Fix - Status & Nächste Schritte

## Problem (Diagnostiziert)

E2E Tests schlugen fehl weil:
- ❌ Pin-Frames waren nach `resetAllStores()` nicht sichtbar  
- ❌ Die Reset-Logik löschte ALLE Pin-States (auch die vom WebSocket)
- ❌ Nachgeladene States kamen nicht zurück, weil WebSocket bereits verbunden war

## Lösung (Implementiert)

### 1. **Store Reset Logik korrigiert** ✅

**`client/src/hooks/use-simulation-store.ts`:**
```typescript
resetToInitial: () => {
  // Nur pending events löschen, Pin-States BEWAHREN!
  pendingEvents.clear();
  if (rafId !== null) cancelAnimationFrame(rafId);
  // NICHT: snapshot = initialSnapshot (würde States verlieren)
  notify();
}
```

**`client/src/hooks/use-telemetry-store.ts`:**
```typescript
resetToInitial: () => {
  // History löschen, aber Peaks (accumulated stats) bewahren
  snapshot = {
    history: [],
    last: null,
    peaks: snapshot.peaks,  // ← BEWAHREN
    lastHeartbeatAt: null,
  };
  // ...
}
```

### 2. **beforeEach Timing optimiert** ✅

**Alle E2E Tests (`sandbox-ui-batching.spec.ts`, `arduino-board-pin-frames.spec.ts`, `output-panel-floor.spec.ts`):**

```typescript
// 1. Backend reset
await page.context().request.post("/api/test-reset");

// 2. testRunId via addInitScript (ANTES de navigate)
await page.addInitScript((testId) => {
  window.sessionStorage.setItem("__TEST_RUN_ID__", testId);
}, testRunId);

// 3. Navigieren
await page.goto("/");

// 4. App laden
await page.waitForSelector(".monaco-editor", { timeout: 10000 });

// 5. WebSocket Zeit geben sich zu verbinden
await page.waitForTimeout(800);

// 6. Stores aufräumen (nur pending events)
await page.evaluate(() => {
  (window as any).__SIM_DEBUG__.resetToInitial();
});
```

## Was ändert sich für dich?

✅ **Tests sollten jetzt laufen ohne Pin-Frame-Fehler**
✅ **State wird zwischen Tests isoliert aber nicht verloren**
✅ **WebSocket-Verbindung wird richtig initialized**

## Wie es weitergeht

### Option 1: Tests sofort starten

```bash
npm run test:e2e
```

**Erwartete Ergebnisse:**
- ✅ Alle 10 Tests sollten PASS sein
- ✅ Pin 13 sollte sichtbar sein (auch nach anderen Tests)
- ✅ Keine "pin-2-frame not visible" Fehler mehr

### Option 2: Nur einen Test debuggen

```bash
npm run test:e2e -- --grep "master-test integration"
```

### Option 3: Mit Screenshots für Debugging

```bash
npm run test:e2e -- --headed  # Browser sichtbar
```

## Was zu prüfen ist, falls immer noch Fehler

### Falls Pins immer noch nicht sichtbar:

1. **Check WebSocket Connection:**
   ```javascript
   // In devtools während Test:
   console.log(window.__SIM_DEBUG__.getState().pinStates);
   ```
   - Sollte `pinStates` Array mit Pin-Objekten zeigen
   - Falls leer → WebSocket sendet keine States

2. **Check Store Reset:**
   ```javascript
   // In devtools:
   window.__SIM_DEBUG__.resetToInitial();
   console.log(window.__SIM_DEBUG__.getState());
   ```
   - Sollte bestehende pinStates BEWAHREN
   - Sollte batchStats zurücksetzen

3. **Check Backend Reset:**
   ```bash
   curl -X POST http://localhost:5000/api/test-reset
   # Should return: {"status": "reset", "message": "...", ...}
   ```

### Falls setTimeout Timeouts passieren:

- Erhöhe Timeout-Werte in beforeEach
- Beispiel: `await page.waitForTimeout(1200);` statt 800

## Dateien die geändert wurden

```
✅ client/src/hooks/use-simulation-store.ts
   - resetToInitial() nur pending events löschen
   - Neue resetToEmpty() für hard reset

✅ client/src/hooks/use-telemetry-store.ts
   - resetToInitial() peaks bewahren
   - Neue resetToEmpty() für hard reset

✅ e2e/sandbox-ui-batching.spec.ts
   - beforeEach mit addInitScript optimization

✅ e2e/arduino-board-pin-frames.spec.ts
   - beforeEach simplified mit WebSocket timing

✅ e2e/output-panel-floor.spec.ts
   - beforeEach mit store cleanup

✅ NEW: FIX_PROGRESS.md (diese Datei)
```

## Rollback falls nötig

Wenn etwas schiefgeht, revert zu vorherigen Commits:

```bash
git diff client/src/hooks/use-simulation-store.ts  # See what changed
git checkout client/src/hooks/use-simulation-store.ts  # Rollback eine Datei
git checkout HEAD -- e2e/  # Rollback alle E2E Tests
```

---

**Nächster Schritt:** `npm run test:e2e` und berichte die Ergebnisse! 🚀
