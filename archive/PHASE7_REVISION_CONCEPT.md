# Phase 7 Revision - Konzept & Fahrplan

**Datum:** 10. Februar 2026  
**Status:** Konzept zur Überarbeitung  

---

## 🔴 Gemeldete Probleme

### Problem 1: Dropping funktioniert nicht
**Testcode:**
```cpp
void setup() {
  Serial.begin(115200);
}

void loop() {
  static uint32_t t1;
  if (millis()-t1>300) {
    t1=millis();
    Serial.println("Hallo Welt");  // ~12 Bytes alle 300ms
  }
  
  static uint32_t t2;
  if (millis()-t2>2) {
    t2=millis();
    Serial.println("-------------------------------------------------------------");  // ~62 Bytes alle 2ms
  }
}
```

**Erwartetes Verhalten:**
- Bei 115200 Baud: 576 Bytes/Tick (50ms), Burst 1728 Bytes
- In 50ms werden ~25 Zeilen "---..." = ~1550 Bytes gesendet
- Das sollte das Budget überschreiten → Dropping
- Telemetrie sollte "Dropped /s" > 0 anzeigen (rot)

**Aktuelles Verhalten:**
- Kein Dropping sichtbar
- Telemetrie zeigt möglicherweise 0.0 Drops

**Root-Cause-Hypothesen:**
1. **SerialOutputBatcher wird nicht verwendet**: Vielleicht wird Serial.print() direkt an onOutput gesendet statt über den Batcher?
2. **Baudrate nicht korrekt gesetzt**: Default-Baudrate in SandboxRunner könnte nicht mit Serial.begin() synchronisiert sein
3. **Telemetrie-Display-Problem**: Vielleicht funktioniert Dropping, aber Telemetrie zeigt es nicht an

---

### Problem 2: Debug-Farben inkonsistent im Output-Panel
**Beobachtung:**
- Arduino Board Telemetrie: `text-cyan-400` ✅
- Serial Monitor Telemetrie: `text-cyan-400` ✅
- Output-Panel (Compiler/Messages/Registry/Debug Tabs): Farben noch gemischt ❌

**Erwartung:**
- Alle Debug-Ausgaben sollten `text-cyan-400` / `text-cyan-500/50` verwenden
- Einheitliches Erscheinungsbild für alle Debug-Informationen

**Betroffene Bereiche:**
- Tab-Labels im Output-Panel (arduino-simulator.tsx ~1914-1987)
- Debug-Konsole-Ausgaben (arduino-simulator.tsx ~2100+)
- Registry-Panel-Ausgaben
- Compiler-Output (wahrscheinlich OK, da nicht Debug-spezifisch)

---

### Problem 3: Tastenkürzel ⌘+Shift+D kollidiert mit Browser
**Beobachtung:**
- ⌘+Shift+D (Mac) öffnet "Neue Lesezeichen" im Browser
- Shortcut wird vom Browser abgefangen, bevor React reagieren kann

**Lösung:**
Alternatives Tastenkürzel wählen, das nicht kollidiert:

**Option A: Ctrl+Alt+D / ⌥+D** (empfohlen)
- Weniger Browser-Kollisionen
- Alt-Kombinationen sind typisch für App-Shortcuts
- Win: Ctrl+Alt+D, Mac: ⌥+D oder Ctrl+⌥+D

**Option B: Ctrl+Shift+T**
- Weniger intuitiv als "D" für Debug
- Aber T könnte für "Telemetrie" stehen

**Option C: Ctrl+K dann D** (Chord-Shortcut)
- VSCode-Style (Ctrl+K ist Prefix)
- Sehr sicher, aber etwas umständlich

**Empfehlung: Option A** - `Ctrl+Alt+D` (Windows/Linux) / `⌥+D` (Mac)

---

## 🔍 Technische Analyse

### SerialOutputBatcher Integration-Prüfung

**Architektur-Flow:**
```
Arduino-Code (Serial.println)
    ↓
SandboxRunner → handleSerialOutput()
    ↓
serialOutputBatcher.enqueue(data)
    ↓
[50ms Tick] → onChunk(batchedData)
    ↓
outputCallback(data) → WebSocket
    ↓
Client: SerialOutput anzeigen
```

**Integration-Points:**
1. `sandbox-runner.ts:419` - SerialOutputBatcher wird erstellt
2. `sandbox-runner.ts:432` - RegistryManager.setSerialOutputBatcher()
3. `sandbox-runner.ts:1160+` - handleSerialOutput() muss den Batcher verwenden

**Mögliches Problem:**
`handleSerialOutput()` könnte `outputCallback` direkt aufrufen statt `serialOutputBatcher.enqueue()` zu nutzen.

---

### Baudrate-Synchronisation

**Problem:**
Serial.begin(baudrate) im Arduino-Code setzt die Baudrate, aber:
1. SandboxRunner hat `this.baudrate = 115200` (default)
2. SerialOutputBatcher wird mit dieser Baudrate initialisiert
3. Wenn Arduino-Code `Serial.begin(9600)` aufruft, wird der Batcher nicht aktualisiert

**Lösung:**
- Bei SERIAL_BEGIN Event: `this.serialOutputBatcher?.setBaudrate(newBaudrate)`
- Bereits in Code vorhanden? Prüfen!

---

### Telemetrie-Display-Bedingung

**Aktuell:**
```tsx
{debugMode && (simulationStatus === "running" || simulationStatus === "paused") && telemetryData.last && (
  <div className="...">
    <div>Serial Events /s: {telemetryData.last.serialOutputPerSecond.toFixed(1)}</div>
    <div className={telemetryData.last.serialDroppedBytesPerSecond > 0 ? "text-red-400" : "text-cyan-400"}>
      Dropped /s: {telemetryData.last.serialDroppedBytesPerSecond.toFixed(1)}
    </div>
    ...
  </div>
)}
```

**Potenzielle Probleme:**
- `telemetryData.last` könnte undefined sein
- `serialDroppedBytesPerSecond` könnte 0 sein, obwohl Drops passieren

---

## ✅ Lösungsplan

### Phase 7r1: Dropping-Funktionalität überprüfen & reparieren

**Schritt 1: handleSerialOutput() analysieren**
- Prüfen, ob `serialOutputBatcher.enqueue()` aufgerufen wird
- Falls nicht: direkten `outputCallback()` Aufruf durch Batcher ersetzen

**Schritt 2: Baudrate-Synchronisation prüfen**
- Sicherstellen, dass SERIAL_BEGIN Event den Batcher aktualisiert
- Event-Handler in sandbox-runner.ts verifizieren

**Schritt 3: Telemetrie-Datenfluss testen**
- Unit-Test: SerialOutputBatcher mit High-Frequency Input (>576 Bytes/50ms)
- Integration-Test: SandboxRunner mit Test-Code (siehe oben)
- Verify: `getTelemetryAndReset()` returns dropped > 0

**Erwartet:**
- Telemetrie zeigt Drops korrekt an
- Serial Monitor bleibt sauber (keine Drop-Meldungen)
- Debug-Display zeigt `Dropped /s: X.X` in Rot

---

### Phase 7r2: Farb-Konsistenz im Output-Panel

**Betroffene Bereiche:**
1. **Tab-Labels** (arduino-simulator.tsx ~1914-1987)
   - "Compiler", "Messages", "Registry", "Debug" Tabs
   - Aktuell: `text-white/90` oder `text-muted-foreground`
   - Neu: `text-cyan-400` für Debug-Tab, andere bleiben

2. **Debug-Konsole-Inhalt** (arduino-simulator.tsx ~2100+)
   - Debug-Messages-Rendering
   - Timestamps, Labels
   - Neu: `text-cyan-400` / `text-cyan-500/50`

3. **Registry-Panel** (falls existiert)
   - Status-Anzeigen
   - Neu: `text-cyan-400`

**Richtlinie:**
- Nur **Debug-spezifische** UI-Elemente → `text-cyan-400`
- Normale Output-Panels (Compiler, Messages) → behalten ihre Farben
- Debug-Tab-Label → `text-cyan-500` wenn aktiv

---

### Phase 7r3: Tastenkürzel korrigieren

**Implementierung:**
```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Windows/Linux: Ctrl+Alt+D
    // Mac: Option+D (altKey)
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const correctModifiers = isMac 
      ? (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey)
      : (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey);
    
    if (correctModifiers && e.key === 'd') {
      e.preventDefault();
      // Toggle logic...
    }
  };
  
  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [toast]);
```

**Settings-Dialog Update:**
```tsx
<kbd className="...">
  {navigator.platform.toLowerCase().includes('mac') ? '⌥+D' : 'Ctrl+Alt+D'}
</kbd>
```

---

## 🧪 Test-Strategie

### Unit-Tests (Phase 7r1-Tests)

**Test 1: SerialOutputBatcher High-Frequency Dropping**
```typescript
it("T20: High-frequency output at 115200 baud should drop bytes", () => {
  batcher = new SerialOutputBatcher({
    baudrate: 115200,
    tickIntervalMs: 50,
    onChunk,
  });
  
  batcher.start();
  
  // Simulate 25 lines of 62 bytes each within 50ms (1550 bytes total)
  for (let i = 0; i < 25; i++) {
    batcher.enqueue("-".repeat(61) + "\n"); // 62 bytes
  }
  
  vi.advanceTimersByTime(50);
  
  const telemetry = batcher.getTelemetryAndReset();
  expect(telemetry.intended).toBe(1550);
  expect(telemetry.actual).toBeLessThan(1550);
  expect(telemetry.dropped).toBeGreaterThan(0);
  expect(telemetry.dropped).toBe(telemetry.intended - telemetry.actual);
});
```

**Test 2: Baudrate-Änderung während Laufzeit**
```typescript
it("T21: Changing baudrate during simulation should update budget", () => {
  // Start with 115200, enqueue data, change to 9600, verify new budget
  // ...
});
```

---

### Integration-Tests (Phase 7r1-Tests)

**Test 3: SandboxRunner mit High-Frequency Code**
```typescript
describe("SandboxRunner - Serial Output Dropping", () => {
  it("should drop bytes when output exceeds baudrate limit", async () => {
    const code = `
      void setup() { Serial.begin(115200); }
      void loop() {
        static uint32_t t2;
        if (millis()-t2>2) {
          t2=millis();
          Serial.println("-------------------------------------------------------------");
        }
      }
    `;
    
    // Run for 1 second, collect telemetry
    // Verify: droppedBytesPerSecond > 0
  });
});
```

---

### E2E-Tests (Phase 7r1-Tests)

**Test 4: Dropping UI-Anzeige**
```typescript
test("should display serial drops in telemetry bar", async ({ page }) => {
  // Load simulator
  // Load high-frequency code
  // Compile & Run
  // Enable debug mode
  // Wait 1 second
  // Verify: "Dropped /s:" shows value > 0 in red color
});
```

**Test 5: Tastenkürzel**
```typescript
test("Ctrl+Alt+D should toggle debug mode", async ({ page }) => {
  await page.goto("/");
  
  // Press Ctrl+Alt+D (or Option+D on Mac)
  const modifier = process.platform === 'darwin' ? 'Alt' : 'Control+Alt';
  await page.keyboard.press(`${modifier}+KeyD`);
  
  // Verify: Toast notification appears
  await expect(page.locator('text=Debug Mode Enabled')).toBeVisible();
  
  // Verify: Telemetry display appears
  await expect(page.locator('text=Serial Events /s')).toBeVisible();
  
  // Press again
  await page.keyboard.press(`${modifier}+KeyD`);
  
  // Verify: Toast "Debug Mode Disabled"
  await expect(page.locator('text=Debug Mode Disabled')).toBeVisible();
});
```

---

## 📋 Fahrplan (Umsetzung)

### Phase 7r1: Dropping Fix (Priorität: KRITISCH)
**Geschätzte Dauer:** 2-3 Stunden

1. ✅ Konzept erstellen (dieses Dokument)
2. ⏱️ `sandbox-runner.ts` analysieren:
   - `handleSerialOutput()` Implementierung prüfen
   - Sicherstellen: `serialOutputBatcher.enqueue()` wird verwendet
   - Baudrate-Synchronisation bei SERIAL_BEGIN validieren
3. ⏱️ Root-Cause finden:
   - Falls direkter `outputCallback()`: durch Batcher ersetzen
   - Falls Baudrate nicht sync: Event-Handler reparieren
4. ⏱️ Unit-Tests schreiben (T20, T21)
5. ⏱️ Integration-Test schreiben (T3)
6. ⏱️ Fix implementieren
7. ⏱️ Tests ausführen: `npm test`
8. ⏱️ Manueller Test mit Beispiel-Code

**Erfolgs-Kriterium:**
- Telemetrie zeigt `Dropped /s: > 0` in Rot
- Tests T20, T21, T3 bestehen

---

### Phase 7r2: Farb-Konsistenz (Priorität: MITTEL)
**Geschätzte Dauer:** 30-60 Minuten

1. ⏱️ Output-Panel Tabs analysieren (arduino-simulator.tsx ~1900-2000)
2. ⏱️ Debug-Tab-Label → `text-cyan-500` (aktiv)
3. ⏱️ Debug-Konsole-Content → `text-cyan-400`
4. ⏱️ Registry-Panel → `text-cyan-400` (falls Debug-Kontext)
5. ⏱️ Screenshots vor/nach vergleichen

**Erfolgs-Kriterium:**
- Alle Debug-UI-Elemente haben einheitliche Cyan-Farben
- Screenshot-Dokumentation

---

### Phase 7r3: Tastenkürzel Fix (Priorität: HOCH)
**Geschätzte Dauer:** 30 Minuten

1. ⏱️ Keyboard-Handler ändern:
   - Windows/Linux: `Ctrl+Alt+D`
   - Mac: `Option+D` (altKey)
2. ⏱️ Settings-Dialog aktualisieren (Shortcut-Hint)
3. ⏱️ E2E-Test schreiben (T5)
4. ⏱️ Manueller Test auf beiden Plattformen

**Erfolgs-Kriterium:**
- Shortcut funktioniert ohne Browser-Kollision
- Toast erscheint beim Toggle
- E2E-Test T5 besteht

---

### Phase 7r4: E2E-Absicherung (Priorität: HOCH)
**Geschätzte Dauer:** 1 Stunde

1. ⏱️ E2E-Test T4 schreiben (Dropping UI)
2. ⏱️ E2E-Test T5 bestätigen (Tastenkürzel)
3. ⏱️ Vollständiger `./run-tests.sh` Durchlauf
4. ⏱️ Playwright-Tests ausführen

**Erfolgs-Kriterium:**
- Alle E2E-Tests bestehen
- `./run-tests.sh` erfolgreich
- Keine Regressionen in bestehenden Tests

---

### Phase 7r5: Dokumentation & Abschluss (Priorität: NIEDRIG)
**Geschätzte Dauer:** 15 Minuten

1. ⏱️ README.md aktualisieren (Tastenkürzel dokumentieren)
2. ⏱️ Changelog-Eintrag erstellen
3. ⏱️ Dieses Konzept-Dokument in Archive verschieben

**Erfolgs-Kriterium:**
- Benutzer-Dokumentation aktuell
- Entwickler-Dokumentation vollständig

---

## 🎯 Gesamtzeitplan

**Gesamt-Schätzung:** 4-6 Stunden

| Phase | Dauer | Priorität | Status |
|-------|-------|-----------|--------|
| 7r1 | 2-3h | KRITISCH | ⏱️ Pending |
| 7r2 | 0.5-1h | MITTEL | ⏱️ Pending |
| 7r3 | 0.5h | HOCH | ⏱️ Pending |
| 7r4 | 1h | HOCH | ⏱️ Pending |
| 7r5 | 0.25h | NIEDRIG | ⏱️ Pending |

**Reihenfolge:**
1. **7r1 zuerst** (Dropping ist funktionaler Bug)
2. **7r3 parallel** (schnell zu fixen, hohes User-Impact)
3. **7r2 danach** (kosmetisch, aber wichtig für UX)
4. **7r4 abschließend** (Absicherung)
5. **7r5 final** (Dokumentation)

---

## 📝 Entscheidungen

### Tastenkürzel-Wahl
**Entscheidung:** `Ctrl+Alt+D` (Win/Linux) / `⌥+D` (Mac)

**Begründung:**
- Weniger Kollisionen als Ctrl+Shift+D
- Alt/Option-Kombinationen sind App-typisch
- "D" ist intuitiv für "Debug"
- Einfacher als Chord-Shortcuts

### Farb-Strategie
**Entscheidung:** Nur Debug-spezifische Elemente in Cyan

**Begründung:**
- Compiler-Output sollte neutral bleiben (weiß/grau)
- Parser-Messages sollten ihre eigenen Farben behalten (Fehler = rot, etc.)
- Debug-Telemetrie einheitlich Cyan = sofort erkennbar
- Nicht das gesamte Output-Panel einfärben

### Test-Strategie
**Entscheidung:** Unit → Integration → E2E

**Begründung:**
- Unit-Tests validieren SerialOutputBatcher-Logik
- Integration-Tests validieren SandboxRunner-Integration
- E2E-Tests validieren User-Experience
- Pyramiden-Ansatz: mehr Unit, weniger E2E

---

## ✅ Abnahme-Kriterien

### Funktionalität
- [ ] Dropping funktioniert korrekt (Telemetrie zeigt Drops)
- [ ] Tastenkürzel funktioniert ohne Browser-Kollision
- [ ] Alle Debug-Farben konsistent (Cyan)

### Tests
- [ ] 823 Unit-Tests bestehen
- [ ] Neue Tests T20, T21, T3, T4, T5 bestehen
- [ ] `./run-tests.sh` erfolgreich
- [ ] Playwright E2E-Tests erfolgreich

### Dokumentation
- [ ] README aktualisiert (Tastenkürzel)
- [ ] Konzept archiviert
- [ ] Changelog-Eintrag erstellt

---

**Erstellt:** 10. Februar 2026  
**Autor:** GitHub Copilot  
**Review:** Pending User Approval
