````markdown
# Funktionsbeschreibung: Pause/Resume der Simulation

## 1. Ziel der Funktion

Die **Pause/Resume-Funktionalität** ermöglicht es dem Benutzer, die laufende Arduino-Simulation zu pausieren und später fortzusetzen, ohne den aktuellen Zustand zu verlieren. Der Sketch bleibt angehalten (gefrozen), alle bisherigen Ausgaben und Pin-Zustände bleiben erhalten, und der Benutzer kann Eingaben vornehmen, um die Simulation zu testen.

---

## 2. Geltungsbereich

- **Backend-Komponenten**: `server/routes.ts`, `server/services/sandbox-runner.ts`
- **Frontend-Komponente**: `client/src/pages/arduino-simulator.tsx`
- **Shared-Schema**: `shared/schema.ts` (WebSocket-Messages)
- **UI-Element**: Simulate-Toggle Button (wird zum Pause/Resume-Button)
- **Trigger**: Benutzerklick auf Pause/Resume Button
- **Nicht-Ziel**: UI-Redesign oder Breaking Changes an bestehenden Features

---

## 3. Simulation-Zustandsübergänge

### 3.1 Zustandsdiagramm

```
┌─────────┐
│ STOPPED │
└────┬────┘
     │ [Compile & Start]
     ▼
┌─────────┐
│ RUNNING │ ◄──────────────┐
└────┬────┘               │
     │ [Pause]       [Resume]
     ▼                     │
┌─────────┐               │
│ PAUSED  │───────────────┘
└────┬────┘
     │ [Stop]
     ▼
┌─────────┐
│ STOPPED │
└─────────┘
```

**Gültige Übergänge:**
- `RUNNING` → `PAUSED` (nur via Pause-Button möglich)
- `PAUSED` → `RUNNING` (nur via Resume-Button möglich)
- `PAUSED` → `STOPPED` (nur via Stop-Button möglich)
- `RUNNING` → `STOPPED` (Code-Änderung oder Stop-Button)

---

## 4. Verhalten beim Pausieren

### 4.1 Was passiert beim Pausieren

**Bedingung:**  
 `simulationStatus === "running"`

**Verhalten:**

1. **Prozess einfrieren:** Der C++-Prozess erhält das Signal `SIGSTOP` (nicht `SIGKILL`)
2. **Serial Output:** Keine neuen Ausgaben mehr (Buffer wird nicht geleert)
3. **Pin-Zustände:** Bleiben unverändert sichtbar auf dem Arduino Board
4. **Timeout-Timer:** Wird pausiert (kein Fortschritt)
5. **Button-Label:** Wechselt von "⏸ Pause" zu "▶ Resume"
6. **UI-Feedback:** Status-Text zeigt "Paused for X seconds"
7. **Frontend-Status:** `simulationStatus = "paused"`

**Beispiel-Nachricht an Client:**
```json
{
  "type": "simulation_status",
  "status": "paused"
}
```

---

### 4.2 Was NICHT passiert beim Pausieren

❌ **Serielle Eingabe wird blockiert** (Nutzer kann nichts senden)  
❌ **Serial Output wird geleert** (bisheriger Inhalt bleibt sichtbar)  
❌ **Pin-Zustände werden zurückgesetzt** (visueller Zustand bleibt erhalten)  
❌ **Kompilations-Status wird geändert** (bleibt "success")  
❌ **Prozess wird terminiert** (nur suspendiert)

### 4.3 Bekannte Einschränkung: `millis()` läuft weiter

⚠️ **WICHTIG:** Die Arduino-Funktion `millis()` gibt die Zeit seit Programmstart zurück, basierend auf der realen Systemzeit. Während der Pause:

- **Prozess wird eingefroren** (SIGSTOP) → Code-Ausführung stoppt ✓
- **Systemzeit läuft weiter** → `millis()` erhöht sich weiterhin ✗

**Praktische Auswirkung:**
```cpp
// Beispiel: Counter mit millis()
unsigned long lastTime = millis();
if (millis() - lastTime >= 1000) {
  counter++;
  lastTime = millis();
}
```

Wenn zwischen Pause und Resume 5 Sekunden vergehen, wird `millis()` um 5000ms größer sein. Timer-basierte Logik kann dadurch Intervalle überspringen oder falsche Zeitberechnungen durchführen.

**Empfehlung:**  
Die Pause-Funktion ist ideal für:
- ✅ Code-Ablauf beobachten und debuggen
- ✅ Pin-Werte während der Ausführung ändern
- ✅ Serial Output analysieren

Für zeitkritische Debugging-Szenarien mit `millis()`, `micros()` oder `delay()` sollte die Simulation gestoppt und neu gestartet werden.

---

## 5. Verhalten beim Fortsetzen (Resume)

### 5.1 Was passiert beim Fortsetzen

**Bedingung:**  
 `simulationStatus === "paused"`

**Verhalten:**

1. **Prozess aufwecken:** Der C++-Prozess erhält das Signal `SIGCONT`
2. **Serial Output:** Wird sofort wieder aktualisiert (falls Sketch schreibt)
3. **Pin-Zustände:** Aktualisieren sich wieder (falls Sketch ändert)
4. **Timeout-Timer:** Wird fortgesetzt (Restzeit läuft)
5. **Button-Label:** Wechselt von "▶ Resume" zu "⏸ Pause"
6. **UI-Feedback:** Status-Text zeigt wieder "Running"
7. **Frontend-Status:** `simulationStatus = "running"`

**Beispiel-Nachricht an Client:**
```json
{
  "type": "simulation_status",
  "status": "running"
}
```

---

## 6. Pin-Verhalten in Pause (Besonderheit)

### 6.1 Pin-Wertänderungen möglich

**Bedingung:**  
 `simulationStatus === "paused"` UND Benutzer bewegt Slider/Toggle auf Arduino Board

**Verhalten:**

1. **Frontend sendet:** `setPinValue()` Befehl an Backend
2. **Backend empfängt:** `[[SET_PIN:pin:value]]` via stdin
3. **C++-Prozess:** Kann Befehle verarbeiten, auch wenn pausiert
4. **Pin-Zustand:** Wird aktualisiert
5. **Sketch-Logik:** Wird beim nächsten `digitalRead()` / `analogRead()` die neue Eingabe sehen (nach Resume)

**Beispiel-Szenario:**
```
Pause gedrückt → Sketch stoppt
Benutzer: Schiebe Slider von 0 auf 512
Backend: Sendet [[SET_PIN:A0:512]] an C++-Prozess
Sketch: Erhält neuen Wert (wird beim Resume berücksichtigt)
```

---

## 7. Timeout-Timer-Verhalten

### 7.1 Timer pausieren und fortsetzen

**Konstante:**  
 `currentTimeoutMs = 0` wird gespeichert beim Pausieren

**Berechnung:**

```typescript
// Beim Pausieren
pausedAt = Date.now()
remainingTimeoutMs = originalTimeoutMs - elapsedTimeMs

// Beim Fortsetzen
resumedAt = Date.now()
newTimeoutMs = remainingTimeoutMs - (resumedAt - pausedAt)
```

**Verhalten:**
- Timeout **pausiert sich nicht automatisch** (weiterhin aktiv)
- Wenn Pause > Timeout-Rest → Simulation stoppt nach Resume
- Beispiel: 60s Timeout, 50s gelaufen, dann pausiert 15s → Nach Resume nur noch 5s

---

## 8. Backend-Implementierung

### 8.1 SandboxRunner Klasse

**Neue Properties:**
```typescript
private isPaused: boolean = false;
private pausedTimestamp: number | null = null;
private pausedTimeoutRemainingMs: number | null = null;
```

**Neue Methoden:**
```typescript
pause(): boolean {
  // SIGSTOP senden, isPaused = true
  // Timeout-Restzeit speichern
}

resume(): boolean {
  // SIGCONT senden, isPaused = false
  // Neuen Timeout mit Restzeit starten
}

isPausedState(): boolean {
  // Abfrage des aktuellen Pause-Status
}
```

### 8.2 routes.ts WebSocket-Handler

**Neue Message-Types:**
```typescript
case "pause_simulation":
  // clientState.runner.pause()
  // sendMessageToClient(ws, { type: "simulation_status", status: "paused" })
  break;

case "resume_simulation":
  // clientState.runner.resume()
  // sendMessageToClient(ws, { type: "simulation_status", status: "running" })
  break;
```

---

## 9. Frontend-Implementierung

### 9.1 arduino-simulator.tsx State

**Bestehender State:**
```typescript
const [simulationStatus, setSimulationStatus] = useState<
  "running" | "stopped"
>("stopped");
```

**Neuer State:**
```typescript
const [simulationStatus, setSimulationStatus] = useState<
  "running" | "stopped" | "paused"
>("stopped");
```

### 9.2 Button-Logic

**Button-Label und Zustand:**
| Status | Button-Text | Aktion | Nächster Status |
|--------|------------|--------|-----------------|
| `stopped` | "▶ Start" | Start Compile & Sim | `running` |
| `running` | "⏸ Pause" | Pause Sim | `paused` |
| `paused` | "▶ Resume" | Resume Sim | `running` |
| Alle | "⏹ Stop" | Stop Sim | `stopped` |

**Code-Struktur:**
```typescript
const handlePause = () => {
  if (simulationStatus !== "running") return;
  sendMessage({ type: "pause_simulation" });
  setSimulationStatus("paused");
};

const handleResume = () => {
  if (simulationStatus !== "paused") return;
  sendMessage({ type: "resume_simulation" });
  setSimulationStatus("running");
};
```

### 9.3 WebSocket-Message-Handler

**Im `onMessage`-Handler:**
```typescript
case "simulation_status":
  setSimulationStatus(message.status); // "paused" | "running" | "stopped"
  if (message.status === "paused") {
    // Optional: Visuelles Feedback
    toast({ title: "Simulation paused", variant: "default" });
  }
  break;
```

---

## 10. Serielle Eingabe in Pause (Blockierung)

### 10.1 Regel: Keine Eingabe möglich

**Bedingung:**  
 `simulationStatus === "paused"` UND Benutzer versucht, Text einzugeben

**Verhalten:**

1. **Frontend:** Send-Button im Serial Monitor wird **disabled**
2. **Backend:** Würde auch ignorieren (Prüfung in `sendSerialInput()`)
3. **Feedback:** Optional Toast: "Cannot send input while paused"
4. **Nach Resume:** Send-Button wird wieder aktiviert

**Code-Beispiel:**
```typescript
const sendButtonDisabled = simulationStatus !== "running";

<Button 
  disabled={sendButtonDisabled}
  onClick={handleSendSerialInput}
>
  Send
</Button>
```

---

## 11. Code-Änderungen während Pause

### 11.1 Was passiert, wenn der Benutzer Code ändert?

**Bedingung:**  
 `simulationStatus === "paused"` UND Code wird im Editor geändert

**Verhalten:**
1. **Simulation wird gestoppt** (wie bisher)
2. `simulationStatus` → `"stopped"`
3. Buffer wird geleert, Pin-Zustände werden zurückgesetzt
4. Benutzer muss erneut Compile & Start drücken

---

## 12. Platform-Kompatibilität

### 12.1 SIGSTOP/SIGCONT Unterstützung

| Platform | SIGSTOP | SIGCONT | Status |
|----------|---------|---------|--------|
| **macOS** | ✅ | ✅ | Funktioniert |
| **Linux** | ✅ | ✅ | Funktioniert |
| **Docker** | ✅ | ✅ | Funktioniert (Linux Kernel) |
| **Windows** | ❌ | ❌ | Nicht unterstützt (Node.js limitiert) |

**Konsequenz für Windows:**  
Pause/Resume kann auf Windows nicht implementiert werden. Falls später notwendig, müsste ein Fallback (komplettes Neustarten) implementiert werden.

---

## 13. State- und Effect-Regeln

### 13.1 WebSocket-Message Handler

**Abhängige States:**
```typescript
useEffect(() => {
  if (!ws) return;
  
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === "simulation_status") {
      setSimulationStatus(message.status); // "paused" | "running" | "stopped"
    }
  };
}, [ws]);
```

### 13.2 Serial Input Disable

**Abhängige States:**
```typescript
const serialInputDisabled = simulationStatus !== "running";

useEffect(() => {
  // Disable/Enable Serial Input UI
}, [simulationStatus]);
```

---

## 14. Nicht-funktionale Anforderungen

- ✅ Keine Breaking Changes an bestehenden Features
- ✅ Pause/Resume MUSS auf macOS und Linux funktionieren
- ✅ Timeout-Timer wird korrekt pausiert und fortgesetzt
- ✅ Serial Monitor zeigt Button-Status an (Send disabled/enabled)
- ✅ Pin-Änderungen sind möglich, Serial-Input ist nicht möglich
- ✅ Code-Änderungen stoppen die Simulation (auch aus Pause)
- ✅ Alle WebSocket-Messages sind konsistent und dokumentiert
- ✅ Error-Handling: Wenn Pause/Resume fehlschlägt, User bekommt Toast

---

## 15. Testanforderungen

**Unit-Tests:**
- Zustandsübergänge (RUNNING → PAUSED → RUNNING)
- Timeout-Berechnung bei Pause/Resume
- Pin-Wertänderungen während Pause
- Serial Input wird blockiert während Pause

**Integration-Tests (E2E):**
- Sketch läuft, Pause drücken, Output stoppt
- Pause aktiv, Pin-Schieber bewegen, neuer Wert wird verarbeitet
- Resume drücken, Sketch läuft weiter
- Stop während Pause, Simulation stoppt sauber
- Code ändern während Pause, Simulation stoppt

**Stress-Tests:**
- Schnelle Pause/Resume-Zyklen
- Pause länger als Original-Timeout
- Serielle Eingaben versuchen während Pause (werden abgelehnt)

---

## 16. Akzeptanzkriterium

Die Funktion gilt als abgeschlossen, wenn:

1. ✅ Pause-Button ist sichtbar und funktional (nur im Running-Status)
2. ✅ Pause stoppt den Sketch (SIGSTOP), Output stoppt
3. ✅ Resume-Button ist sichtbar und funktional (nur im Paused-Status)
4. ✅ Resume lädt Sketch weiter (SIGCONT), Output wird aktualisiert
5. ✅ Pin-Slider können während Pause bewegt werden
6. ✅ Serial Input ist während Pause blockiert
7. ✅ Timeout läuft weiter (auch während Pause), wird aber beim Pause-Zeitpunkt berücksichtigt
8. ✅ Code-Änderung während Pause stoppt Simulation komplett
9. ✅ Alle WebSocket-Messages sind konsistent
10. ✅ Keine Breaking Changes an bestehenden Features
11. ✅ Alle Tests bestehen (Unit + E2E)
12. ✅ Fehlerbehandlung ist robust (z.B. Pause-Fehler zeigt Toast)

````