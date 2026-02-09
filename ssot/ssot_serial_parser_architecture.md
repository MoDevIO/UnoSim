# Serial Parser Architektur - SSOT

## Übersicht

Das Serial-Output-System nutzt **zwei verschiedene Parser** mit unterschiedlichen Aufgaben:

| Parser | Quelle | Aufgabe | Ort |
|--------|--------|---------|-----|
| **TypeScript SerialParser** | C++ Process `stdout` | Timing+Buffering (20ms) | `src/utils/arduino-output-parser.ts` → `server/services/sandbox-runner.ts` |
| **Server ArduinoOutputParser** | C++ Process `stderr` | Protocol-Dekodierung (`SERIAL_EVENT`) | `server/services/arduino-output-parser.ts` |

## Detail: TypeScript SerialParser (stdout-Pfad)

**Location:** `src/utils/arduino-output-parser.ts`

**Zweck:** Die Arduino `Print`-Bibliothek arbeitet mit reinem `std::cout`. Der TS-Parser emuliert die Arduino-Timing-Semantik:
- Buffert Daten bis zur Newline (Immediate Flush)
- Bei fehlender Newline: Flush nach 20ms (simuliert "Drei Punkte" `...`)

**Eingabe:** Raw-Text von `std::cout` (z.B. "Hello", ".", "World\n")  
**Ausgabe:** Formatierte Chunks an `emit('data', chunk)`  
**Nutzer:** `SandboxRunner` registriert Listener auf `'data'` Event

**Code:**
```typescript
print(value: number | string | boolean, modifier?: PrintModifier)
println(value, modifier?)
// Interne Buffer+Flush mit 20ms-Timing
```

## Detail: Server ArduinoOutputParser (stderr-Pfad)

**Location:** `server/services/arduino-output-parser.ts`

**Zweck:** Der C++ Mock sendet strukturierte Daten über stderr mit Protokoll-Markern:
```
[[SERIAL_EVENT:<millis>:<base64_data>]]
[[PIN_MODE:13:1]]
[[IO_REGISTRY_START]]
```

Der Server-Parser dekodiert diese Marker und klassifiziert sie (serial_event, pin_mode, registry_start, etc.).

**Eingabe:** Protokoll-Zeilen von stderr  
**Ausgabe:** Typisierte Union: `{ type: 'serial_event'; data: string; ... }`  
**Nutzer:** `SandboxRunner` ruft `parseStderrLine()` auf bei jedem stderr-Output

**Code:**
```typescript
parseStderrLine(line: string, processStartTime: number): ParsedOutput
// Returns: serial_event | pin_mode | pin_value | pin_pwm | registry_start | registry_end | ...
```

## Warum zwei Parser?

### stdout-Pfad (TS-Parser)
- **Warum getrennt?** Timing-Semantik (20ms Buffering, "Drei Punkte") ist unabhängig von Pin-States
- **Probleme wenn zusammengefasst:** Der Server-Parser krümmt sich um byte-genaue Dekodierung; Timing-Logik würde ihn komplizieren
- **Performance:** Der TS-Parser läuft auf stdout direkt, der Server-Parser wartet auf stderr-Zeilen (langsamer, strukturierter)

### stderr-Pfad (Server-Parser)
- **Warum?** Pins sind synchron, Serial-Daten sind async. Der Protocol-Parser trennt diese Concerns
- **Strukturieren:** Base64-kodierte, timestampte Nachrichten mit klarer Semantik
- **Fehlerhandling:** Pin-States werden prioritiert (registriert zuerst), Serial-Events folgen

## Datenfluss-Diagramm

```
┌─ Tos ─────────────────────────────────────────────────────────────┐
│  C++ Process                                                       │
├─ Tos ─────────────────────────────────────────────────────────────┤
│                                                                    │
│  stdout: "Hello"  →  stdout: "World\n"  →  stderr: SERIAL_EVENT  │
│  stdout: "."      →  (20ms timer)                                 │
└────────────────────────────────────────────────────────────────────┘
    ↓                                              ↓
  TS-Parser                                  Server-Parser
  (src/utils/)                            (server/services/)
    ↓                                              ↓
  'data'                              parseStderrLine()
  emit('data', 'Hello')               → serial_event
  emit('data', '.')                   → pin_mode
  emit('data', 'World\n')             → registry_start
                                        ↓
                                   handleParsedLine()
    ↓                                    ↓
  outputCallback(chunk) ───→   Message-Queue/Batching/etc.
                                      ↓
                             WebSocket → Frontend
```

## Wartbarkeit

Beide Parser sind **nicht redundant**, sondern komplementär:
1. **TS-Parser** kümmert sich um Timing (stdout ist schnell, asynchron)
2. **Server-Parser** um Protokoll-Struktur (stderr ist langsamer, strukturiert)

**Zukünftige Änderungen:**
- Sollte `print(255, 3)` geändert werden? → Änderung in C++ Mock + Server-Parser + TS-Parser-Tests
- Sollte 20ms-Buffering erhöht werden? → Nur TS-Parser (src/utils/arduino-output-parser.ts)
- Sollte neue Pin-State-Struktur hinzugefügt werden? → Server-Parser (server/services/arduino-output-parser.ts)

Diese Trennung ist intentional und sollte beibehalten werden.
