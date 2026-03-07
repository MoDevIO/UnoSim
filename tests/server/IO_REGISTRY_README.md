# I/O Registry Comprehensive Test Suite

## Übersicht

Diese Test-Suite prüft systematisch die Erfassung von I/O-Operationen (`digitalWrite`, `digitalRead`, `analogWrite`, `analogRead`) im I/O Registry des Arduino-Simulators.

## Test-Datei

**Datei:** `io-registry-comprehensive.test.ts`  
**Tests:** 23 (20 aktiv, 3 TODO)  
**Status:** ✅ Alle aktiven Tests bestehen

## Getestete Szenarien

### ✅ Implementiert und funktionsfähig

#### 1. Literale Pin-Nummern
```cpp
digitalWrite(13, HIGH);
digitalRead(7);
analogWrite(9, 128);
analogRead(A0);
```
**Status:** ✅ Vollständig unterstützt

#### 2. Konstante Pin-Variablen
```cpp
const int LED_PIN = 12;
digitalWrite(LED_PIN, HIGH);
```
**Status:** ✅ Runtime + statische Analyse

#### 3. Loop-basierte dynamische Pins
```cpp
for (int i = 0; i < 5; i++) {
    pinMode(i, OUTPUT);
    digitalWrite(i, HIGH);
}
```
**Status:** ✅ Runtime-Tracking + Loop-Detection in statischer Analyse

#### 4. Globale Pin-Variablen
```cpp
int MY_PIN = 7;
digitalWrite(MY_PIN, HIGH);
```
**Status:** ✅ Vollständig unterstützt

#### 5. Statische Code-Analyse
- Warnung bei fehlender `pinMode`
- PWM-Pin-Validierung
- Mehrfach-pinMode-Detection
**Status:** ✅ Alle Checks funktionieren

### ⏸️ TODO - Geplant aber nicht priorisiert

#### Array-basierter Pin-Zugriff
```cpp
int pins[] = {2, 4, 6};
digitalWrite(pins[1], HIGH);
```
**Grund:** Benötigt Symbol-Tabelle, seltener Use-Case

#### Struct-basierter Zugriff
```cpp
struct Config { int p; };
Config c = {7};
digitalRead(c.p);
```
**Grund:** Sehr aufwendig, sehr seltener Use-Case

#### Arithmetische Ausdrücke
```cpp
digitalWrite(10 + 2, HIGH);
```
**Grund:** Benötigt Const-Folding, unüblicher Code-Stil

## Test ausführen

```bash
# Alle Tests
npm test -- tests/server/io-registry-comprehensive.test.ts

# Einzelner Test
npm test -- tests/server/io-registry-comprehensive.test.ts -t "should track digitalWrite"

# Mit Debug-Output
npm test -- tests/server/io-registry-comprehensive.test.ts --reporter=verbose
```

## Test-Pattern

### Runtime-Tests
```typescript
it("should track <operation> at runtime", async () => {
  const code = `
    void setup() {
      pinMode(13, OUTPUT);
      digitalWrite(13, HIGH);
    }
    void loop() {
      static int count = 0;
      count++;
      delay(10);
      if (count > 2) {
        exit(0);  // Beende nach mehreren Iterationen
      }
    }
  `;

  registryData = await runAndCollectRegistry(code);
  const pin13 = registryData.find((p) => p.pin === "13");
  
  expect(pin13?.usedAt?.some((u) => u.operation === "digitalWrite")).toBe(true);
});
```

**Wichtig:** Tests müssen mindestens 2-3 Loop-Iterationen durchlaufen, damit die Registry ausgegeben und empfangen werden kann.

### Statische Analyse Tests
```typescript
it("should warn when pinMode is missing", () => {
  const code = `
    void setup() {
      digitalWrite(10, HIGH); // Fehlt: pinMode(10, OUTPUT)
    }
    void loop() {}
  `;

  const messages = parser.parseHardwareCompatibility(code);
  const warning = messages.find((m) => 
    m.message.includes("Pin 10") && m.message.includes("pinMode")
  );
  
  expect(warning).toBeDefined();
});
```

## Technische Details

### Registry-Tracking-Ablauf

1. **Initialisierung:** `initIORegistry()` erstellt alle 20 Pins (0-13, A0-A5)
2. **Setup-Phase:** `pinMode`-Aufrufe setzen `defined=true` und `pinMode` Modus
3. **Runtime-Tracking:** `trackIOOperation(pin, operation)` fügt Operationen hinzu
4. **Registry-Ausgabe:** 
   - Nach `setup()` (initiale Version)
   - Nach jeder `loop()`-Iteration (Updates)
5. **Parser:** `ArduinoOutputParser` liest `[[IO_PIN:...]]`-Tags aus stderr
6. **Client:** Erhält IOPinRecord[] via WebSocket

### Deduplizierung

`trackIOOperation()` dedupliziert automatisch:
```cpp
digitalWrite(13, HIGH);
digitalWrite(13, LOW);
digitalWrite(13, HIGH);
// → Registriert "digitalWrite" nur einmal
```

### Pin-Nummern-Mapping

- **Digital:** 0-13 → String "0"-"13"
- **Analog:** A0-A5 → Intern 14-19 → String "A0"-"A5"
- `analogRead(0)` wird zu `analogRead(A0)` umgewandelt

## Fehlerbehebung

### Test-Timeouts
**Problem:** Test wartet endlos auf Registry  
**Lösung:** Prüfe dass Code `exit(0)` aufruft (sonst läuft Simulation ewig)

### Registry ist leer
**Problem:** `usedAt` Array ist leer  
**Ursache:** `exit(0)` wird zu früh aufgerufen (vor Registry-Ausgabe)  
**Lösung:** Loop-Counter einbauen, erst nach 2+ Iterationen beenden

### Pin nicht gefunden
**Problem:** `registryData.find(p => p.pin === "13")` ist undefined  
**Ursache:** Sketch hat `neither setup() nor loop()`-Fehler  
**Lösung:** Code-Validierung prüfen

## Verwandte Dateien

- **Mock:** `server/mocks/arduino-mock.ts` (tracking-Logik)
- **Builder:** `server/services/sketch-file-builder.ts` (Registry-Output-Timing)
- **Parser:** `server/services/arduino-output-parser.ts` (Registry-Parsing)
- **Static:** `shared/code-parser.ts` (statische Analyse)
- **Schema:** `shared/schema.ts` (`IOPinRecord` Interface)

## Changelog

### 2026-03-06 - Initial Implementation
- ✅ 20/23 Tests implementiert und bestanden
- ✅ Registry-Timing-Fix (ausgabe nach jeder Loop-Iteration)
- ✅ Test-Pattern mit Counter-based exit
- ⏸️ 3 Edge-Cases als TODO markiert
