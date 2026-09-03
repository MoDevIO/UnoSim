# Arduino Sandbox Services

**Status:** Phase 5 Complete (30. Januar 2026)  
**Architecture:** Modular Service Layer with Specialized Managers

---

## System-Übersicht

Die Arduino Sandbox Engine ermöglicht die sichere Ausführung von Arduino-Sketches in zwei Modi:

### Docker Sandbox Mode (Preferred)
- **Isolation:** Vollständige Containerisierung mit Docker
- **Security:** Network disabled, memory/CPU limits, no-new-privileges, capabilities dropped
- **Process:** Single container compiles (`g++`) and executes sketch in one step
- **Fallback:** Automatisch zu Local Mode bei fehlender Docker-Installation

### Local Execution Mode (Fallback)
- **Compilation:** Native `g++` compilation mit pthread support
- **Execution:** Direct process spawn mit basic timeout protection
- **Limits:** Platform-dependent (timeout command on Linux, basic on macOS)
- **Use Case:** Development/Testing ohne Docker-Overhead

---

## Komponenten-Matrix

| Komponente | Datei | Verantwortung | LOC | Phase |
|------------|-------|---------------|-----|-------|
| **SandboxRunner** | `sandbox-runner.ts` | Orchestrierung, State Management, Public API | ~450 | All |
| **ArduinoOutputParser** | `arduino-output-parser.ts` | Parsing von stderr markers (Registry, Pins, Serial) | ~217 | 2 |
| **RegistryManager** | `registry-manager.ts` | Pin state tracking, Debouncing, Change detection | ~268 | 3 |
| **SimulationTimeoutManager** | `simulation-timeout-manager.ts` | Deadline-based timeouts, Pause/Resume, Zombie prevention | ~205 | 4 |
| **DockerCommandBuilder** | `docker-command-builder.ts` | Security-constrained Docker command generation | ~60 | 5 |
| **SketchFileBuilder** | `sketch-file-builder.ts` | Arduino mock wrapping, Header/Footer generation | ~115 | 5 |
| **LocalCompiler** | `local-compiler.ts` | g++ compilation with error cleaning | ~80 | 5 |

**Total Extracted LOC:** ~945 lines (from original 1,550 in monolithic sandbox-runner)  
**Reduction in Main File:** 71% (1,550 → 450 lines)

---

## Data Flow: Pin Update Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. C++ Arduino Mock (arduino-mock.cpp)                              │
│    pinMode(13, OUTPUT) → fprintf(stderr, "[[PIN_MODE:13:1]]\n")     │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Process stderr stream → SandboxRunner.setupStreamHandlers()      │
│    Receives raw line: "[[PIN_MODE:13:1]]"                           │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. ArduinoOutputParser.parseStderrLine()                             │
│    Regex match → { type: "pin_mode", pin: 13, mode: 1 }            │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. RegistryManager.updatePinMode(13, 1)                             │
│    • Updates internal pin state registry                            │
│    • Checks hash for changes (debounce duplicate updates)           │
│    • Triggers onUpdate callback after 200ms debounce                │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. SandboxRunner callback execution                                 │
│    • If registry waiting: Queue in messageQueue                     │
│    • Else: Immediate onPinState(13, "mode", 1) callback            │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. WebSocket → Frontend (routes.ts)                                 │
│    ws.send({ type: "pin_state", pin: 13, stateType: "mode", ... }) │
└─────────────────────────────────────────────────────────────────────┘
```

### Special Case: Registry Wait Mode

When sketch starts, RegistryManager enters "wait mode" (1500ms):
- All output/error/pinState callbacks are **queued** in `messageQueue`
- After `IO_REGISTRY_END` marker is received → `flushMessageQueue()`
- This ensures UI receives complete pin registry before any output

**Rationale:** Prevents UI flickering from receiving pin updates before registry is established.

---

## State Machine: SimulationState

### States

```typescript
enum SimulationState {
  STOPPED   // No active process
  STARTING  // Preparing sketch files
  RUNNING   // Process executing
  PAUSED    // Process frozen (SIGSTOP)
  ERROR     // Unrecoverable error
}
```

### Valid Transitions

| From | To | Trigger | TimeoutManager Action |
|------|-----|---------|----------------------|
| `STOPPED` | `STARTING` | `runSketch()` called | - |
| `STARTING` | `RUNNING` | Process spawned | `schedule()` with deadline |
| `STARTING` | `STOPPED` | Compilation error | - |
| `RUNNING` | `PAUSED` | `pause()` called | `pause()` - store remaining time |
| `PAUSED` | `RUNNING` | `resume()` called | `resume()` - restart with remaining |
| `RUNNING` | `STOPPED` | `stop()` or exit | `clear()` - prevent zombie timers |
| `PAUSED` | `STOPPED` | `stop()` called | `clear()` |
| `*` | `ERROR` | Unhandled exception | `clear()` |

### transitionTo() Method

**Responsibilities:**
1. **Validation:** Check if transition is allowed via `VALID_TRANSITIONS` map
2. **Exit Hook:** Call `handleStateExit(oldState, newState)` before transition
3. **State Change:** Update `this.state = newState`
4. **Entry Hook:** Call `handleStateEnter(newState, oldState)` after transition
5. **Logging:** Record all state changes for debugging

**Example:**
```typescript
// Invalid transition rejected
if (!this.transitionTo(SimulationState.PAUSED)) {
  return false; // Can't pause when STOPPED
}

// Valid transition executed
handleStateExit(RUNNING, PAUSED)  // → timeoutManager.pause()
this.state = PAUSED               // → State updated
handleStateEnter(PAUSED, RUNNING) // → pauseStartTime = now
```

**Prevents:** Race conditions from direct state manipulation

---

## Wartungshilfen

### Adding a New Pin Type (e.g., Analog Read)

**Step 1: Update Arduino Mock** (`server/services/arduino-mock.ts`)
```ts
// Add new marker format
int analogRead(int pin) {
    fprintf(stderr, "[[ANALOG_READ:%d:%d]]\n", pin, value);
    return value;
}
```

**Step 2: Update ArduinoOutputParser** (`arduino-output-parser.ts`)
```typescript
// Add new regex pattern
private readonly ANALOG_READ_REGEX = /\[\[ANALOG_READ:(\d+):(\d+)\]\]/;

// Add new discriminated union type
export type ParsedOutput = 
  | { type: "analog_read"; pin: number; value: number }
  | ... // existing types

// Add case in parseStderrLine()
if (this.ANALOG_READ_REGEX.test(line)) {
  const match = line.match(this.ANALOG_READ_REGEX);
  return {
    type: "analog_read",
    pin: parseInt(match[1]),
    value: parseInt(match[2]),
  };
}
```

**Step 3: Update RegistryManager** (`registry-manager.ts`)
```typescript
// Add analog value tracking
export interface IOPinRecord {
  pin: number;
  mode: number;
  value: number;
  pwmValue: number;
  analogValue?: number; // NEW
}

// Add update method
updateAnalogValue(pin: number, value: number): void {
  const pinRecord = this.findOrCreatePin(pin);
  pinRecord.analogValue = value;
  this.debouncedSend();
}
```

**Step 4: Handle in SandboxRunner** (`sandbox-runner.ts`)
```typescript
// In setupStreamHandlers() switch statement
case "analog_read":
  this.registryManager.updateAnalogValue(parsed.pin, parsed.value);
  if (callbacks.onPinState) {
    callbacks.onPinState(parsed.pin, "analog", parsed.value);
  }
  break;
```

**Step 5: Update Frontend** (if needed)
- Add analog value display in Arduino Board component
- Handle `type: "analog"` in pin state callback

---

## Testing Strategy

### Unit Tests (Per Component)

```bash
# Test individual managers
npx vitest run tests/server/services/arduino-output-parser.test.ts --project=unit-node
npx vitest run tests/server/services/registry-manager.test.ts --project=unit-node
npx vitest run tests/server/services/simulation-timeout-manager.test.ts --project=unit-node

# Test integration
npx vitest run tests/server/services/sandbox-runner.test.ts --project=unit-node
```

### Integration Tests

```bash
# E2E scenarios
npx vitest run tests/server/pause-resume-timing.test.ts --project=unit-node
npx vitest run tests/server/io-registry-pinmode-tracking.test.ts --project=unit-node
```

### Coverage Targets

| Component | Line Coverage | Branch Coverage |
|-----------|---------------|-----------------|
| ArduinoOutputParser | > 95% | > 90% |
| RegistryManager | > 95% | > 90% |
| TimeoutManager | 100% | 100% |
| SandboxRunner | > 85% | > 80% |

---

## Troubleshooting

### Issue: "Zombie timers" after stop()

**Cause:** Timeout not cleared properly  
**Fix:** Ensured `timeoutManager.clear()` called in:
- `handleStateExit(*, STOPPED)`
- `handleStateEnter(STOPPED, *)`

### Issue: Registry sent before pin states ready

**Cause:** Race condition in registry collection  
**Fix:** `RegistryManager.enableWaitMode(1500ms)` with message queuing

### Issue: Pause/Resume timing drift

**Cause:** Pause duration not accounted in timeout  
**Fix:** `TimeoutManager` uses deadline-based calculation:
```typescript
remaining = deadline - Date.now() // Immune to pause duration
```

### Issue: Output size limit exceeded

**Cause:** Infinite loop in user code  
**Solution:** `SANDBOX_CONFIG.maxOutputBytes = 100MB` enforced in stream handlers

---

## Performance Characteristics

| Operation | Avg Time | Notes |
|-----------|----------|-------|
| Docker compile + run | 1-2s | First run (cold Docker)  |
| Docker compile + run | 0.3-0.5s | Subsequent runs (warm) |
| Local compile + run | 0.2-0.4s | Native g++ |
| State transition | <1ms | Synchronous |
| Registry debounce | 200ms | Configurable |
| Timeout precision | ±10ms | Node.js setTimeout limitation |

---

## Migration Notes (for Maintainers)

### Before Refactoring (Phase 0)
- **sandbox-runner.ts:** 1,550 lines, God Object anti-pattern
- **Responsibilities:** Parsing, Registry, Timeouts, Compilation, Execution, State
- **Testability:** Poor (tightly coupled)

### After Refactoring (Phase 5)
- **sandbox-runner.ts:** 450 lines, Orchestrator pattern
- **Extracted Services:** 6 specialized managers (~945 lines total)
- **Testability:** Excellent (each manager unit testable)

### Backward Compatibility
✅ All existing tests pass without modification  
✅ Public API unchanged (`runSketch`, `pause`, `resume`, `stop`)  
✅ WebSocket protocol unchanged  
✅ Arduino mock unchanged

---

## Future Enhancements

### Potential Improvements
1. **Multi-sketch support:** Allow multiple sandboxes running concurrently
2. **Streaming compilation:** Progress callbacks during g++ execution
3. **Resource monitoring:** CPU/Memory usage tracking per sketch
4. **Sketch caching:** Reuse compiled binaries for identical code
5. **WASM fallback:** Client-side execution when Docker unavailable

### Architecture Ready For
- Plugin system for custom pin types
- Alternative compilers (e.g., PlatformIO, Arduino CLI)
- Remote execution (distributed sandbox workers)

---

**Last Updated:** 30. Januar 2026  
**Authors:** Refactoring Team  
**License:** See root LICENSE file
