# sandbox-runner.ts Analysis: Output & Message Management

**File**: [server/services/sandbox-runner.ts](server/services/sandbox-runner.ts)  
**Total LOC**: ~1770  
**Analysis Date**: 13. März 2026

---

## 1. Output Buffer Management

### Fields (Lines 95-99)
```
outputBuffer: string                          // Main character buffer
outputBufferIndex: number                     // Read position (prevents O(n²) slice)
totalOutputBytes: number                      // Total bytes sent (for limits)
isSendingOutput: boolean                      // Rate-limiting state flag
flushTimer: NodeJS.Timeout | null            // Timeout handle for delayed send
```

### Method: `sendOutputWithDelay()` 
**Location**: [Lines 1538-1589](server/services/sandbox-runner.ts#L1538-L1589)  
**LOC**: 52  
**State**: Character-by-character output with baudrate-aware delays

**What it does**:
- Sends one character from `outputBuffer` at a time
- Uses `outputBufferIndex` for O(1) reading (avoids O(n²) slice cost)
- Implements baudrate-based delay: `(10 * 1000) / this.baudrate` ms per char
- Enforces `SANDBOX_CONFIG.maxOutputBytes` limit (100MB)
- Marks newlines as "complete" in callback

**Current Implementation**:
```typescript
// Prevents re-entry during async dispatch:
if (this.isSendingOutput) return; 
if (!this.isRunning) { this.isSendingOutput = false; return; }
if (this.isPaused) { this.isSendingOutput = false; return; }
if (this.outputBufferIndex >= this.outputBuffer.length) { 
  this.isSendingOutput = false; return; 
}
// Read one char and advance index
this.isSendingOutput = true;
const char = this.outputBuffer[this.outputBufferIndex++];
this.totalOutputBytes += 1;
// Schedule next char
setTimeout(() => this.sendOutputWithDelay(onOutput), charDelayMs);
```

**Dependencies**:
- `onOutput` callback (provided at runtime)
- `isRunning`, `isPaused` state flags
- `baudrate` field (parsed from sketch code)

**Side Effects**:
- Modifies `isSendingOutput` flag (rate-limiting state)
- Modifies `outputBufferIndex` and `totalOutputBytes`
- Creates recursive setTimeout chains (can cause stack depth on high baud rates)
- Calls `stop()` if output limit exceeded

**Issues for Extraction**:
- ⚠️ Tightly coupled to instance state (many field dependencies)
- ⚠️ Recursive setTimeout can accumulate timers in memory
- ⚠️ No way to cancel in-flight characters (only index-based)
- ⚠️ Current cleanup only resets index in `stop()`, not pending timers

---

### Method: `initializeRunState()`
**Location**: [Lines 783-807](server/services/sandbox-runner.ts#L783-L807)  
**LOC**: 25  

**What it does**:
- Resets all output buffer state for new sketch execution
- Parses baudrate from sketch code via regex
- Initializes registry manager and timeout settings
- Resets message queue

**Buffer Resets** (Lines 801-805):
```typescript
this.outputBuffer = "";
this.outputBufferIndex = 0;
this.isSendingOutput = false;
this.totalOutputBytes = 0;
```

**Dependencies**:
- `stderrParser` (for baudrate regex parsing)
- `registryManager`, `timeoutManager`
- All callback parameters

---

### Method: `stop()`
**Location**: [Lines 1591-1660](server/services/sandbox-runner.ts#L1591-L1660)  
**LOC**: 70 (including cleanup)  

**Output Buffer Cleanup** (Lines 1648-1652):
```typescript
this.outputBuffer = "";
this.outputBufferIndex = 0;
this.isSendingOutput = false;
if (this.flushTimer) {
  clearTimeout(this.flushTimer);
  this.flushTimer = null;
}
```

**Issue**: Does NOT cancel pending setTimeout chains from `sendOutputWithDelay()` — only clears one known timer.

---

## 2. Message Queue Handling

### Field (Line 110)
```
messageQueue: Array<{ type: string; data: any }> = []
```

### Method: `flushMessageQueue()` 
**Location**: [Lines 238-264](server/services/sandbox-runner.ts#L238-L1264)  
**LOC**: 27  
**Purpose**: Drain and replay queued messages after registry sync

**What it does**:
1. Checks if queue is empty (early exit optimization)
2. Logs queue size
3. Extracts queue into local variable, clears instance field
4. Re-emits each message to appropriate callback:
   - `"pinState"` → `this.pinStateCallback(pin, stateType, value)`
   - `"output"` → `this.outputCallback(line, isComplete)`
   - `"error"` → `this.errorCallback(line)`

**Implementation**:
```typescript
for (const msg of queue) {
  if (msg.type === "pinState" && this.pinStateCallback) {
    this.pinStateCallback(msg.data.pin, msg.data.stateType, msg.data.value);
  } else if (msg.type === "output" && this.outputCallback) {
    this.outputCallback(msg.data.line, msg.data.isComplete);
  } else if (msg.type === "error" && this.errorCallback) {
    this.errorCallback(msg.data.line);
  }
}
```

**Trigger Points**:
- Called in constructor's RegistryManager `onUpdate` callback (when registry sync completes)
- Also called in `setupLocalHandlers()` `onClose` handler (before exit)

**Dependencies**:
- Instance callbacks: `pinStateCallback`, `outputCallback`, `errorCallback`
- `registryManager.isWaiting()` to detect sync state

**Side Effects**:
- ✅ Clears messageQueue
- ✅ Can trigger output cascades (if callbacks themselves enqueue more)
- ⚠️ Relies on callback null-checks (silent drops if callback is null)

---

### Message Enqueue Pattern (3 locations)

#### 1. In `createWrappedCallbacks()` - onOutput handler
**Location**: [Lines 1046-1075](server/services/sandbox-runner.ts#L1046-L1075)  
**Enqueue Logic**:
```typescript
if (this.serialOutputBatcher) {
  this.serialOutputBatcher.enqueue(line);
} else if (onOutput && !this.processKilled) {
  onOutput(line, isComplete);
}
```
✅ **Queuing**: No explicit queue here; delegates to `SerialOutputBatcher`

#### 2. In `createWrappedCallbacks()` - onPinState handler  
**Location**: [Lines 1077-1087](server/services/sandbox-runner.ts#L1077-L1087)  
**Enqueue Logic**:
```typescript
if (this.registryManager.isWaiting()) {
  this.messageQueue.push({
    type: "pinState",
    data: { pin, stateType, value },
  });
} else if (onPinState) {
  onPinState(pin, stateType, value);
}
```
✅ **Direct messageQueue push**: Pin states queued during registry wait

#### 3. In `handleParsedLine()` - pin_mode, pin_value, pin_pwm cases
**Location**: [Lines 1490-1517](server/services/sandbox-runner.ts#L1490-L1517)  
**Pattern**: After registry update, enqueue to `pinStateBatcher`:
```typescript
if (this.pinStateBatcher) {
  this.pinStateBatcher.enqueue(parsed.pin, "mode", parsed.mode);
} else if (onPinState) {
  onPinState(parsed.pin, "mode", parsed.mode);
}
```

---

## 3. Batcher Flushing

### Method: `flushBatchers()`
**Location**: [Lines 1760-1767](server/services/sandbox-runner.ts#L1760-L1767)  
**LOC**: 8  
**Purpose**: Synchronously flush pending data WITHOUT destroying batchers

**What it does**:
```typescript
if (this.serialOutputBatcher) {
  this.serialOutputBatcher.stop(); // Flushes remaining bytes
}
if (this.pinStateBatcher) {
  this.pinStateBatcher.stop(); // Flushes remaining pin states
}
```

**Key Insight**: Uses `batcher.stop()` not `batcher.flush()` — `stop()` flushes AND halts ticking.

**Callers**:
1. **setupLocalHandlers onClose** [Line 1451](server/services/sandbox-runner.ts#L1451)
   ```typescript
   if (wasRunning) {
     this.flushBatchers();
     // then destroy
   }
   ```

2. **handleDockerExit** [Line 1357](server/services/sandbox-runner.ts#L1357)
   ```typescript
   if (!isCompilePhase.value || code === 0) {
     this.flushBatchers();
   }
   ```

---

### Batcher Initialization & Lifecycle

#### PinStateBatcher (Lines 951-965)
```typescript
this.pinStateBatcher = new PinStateBatcher({
  tickIntervalMs: 50,     // 20 batches/sec
  onBatch: (batch: PinStateBatch) => {
    if (this.registryManager.isWaiting()) {
      // Queue individual states
      for (const state of batch.states) {
        this.messageQueue.push({
          type: "pinState",
          data: { pin: state.pin, stateType: state.stateType, value: state.value },
        });
      }
    } else if (onPinStateBatch) {
      // Send as batch
      onPinStateBatch(batch);
    } else if (onPinState) {
      // Fallback: individual states
      for (const state of batch.states) {
        onPinState(state.pin, state.stateType, state.value);
      }
    }
  },
});
this.pinStateBatcher.start();
```

**Cleanup** (in `stop()`, lines 1608-1612):
```typescript
if (this.pinStateBatcher) {
  this.pinStateBatcher.stop();      // Flush
  this.pinStateBatcher.destroy();   // Kill timers
  this.pinStateBatcher = null;      // Clear ref
}
```

#### SerialOutputBatcher (Lines 967-1001)
```typescript
this.serialOutputBatcher = new SerialOutputBatcher({
  baudrate: this.baudrate,
  tickIntervalMs: 50,     // 20 batches/sec
  onChunk: (data: string, firstLineIncomplete?: boolean) => {
    const out = this.outputCallback;
    if (typeof out !== 'function') return;
    
    // Backpressure relief on next tick
    if (this.backpressurePaused) {
      setTimeout(() => {
        if (this.backpressurePaused && this.serialOutputBatcher?.isOverloaded()
          && !this.isPaused && this.processController.hasProcess()) {
          this.processController.kill("SIGCONT");
          this.backpressurePaused = false;
        }
      }, 0);
    }
    // ... split/emit chunks
  },
});
this.serialOutputBatcher.start();
```

**Cleanup** (in `stop()`, lines 1614-1618):
```typescript
if (this.serialOutputBatcher) {
  this.serialOutputBatcher.stop();      // Flush
  this.serialOutputBatcher.destroy();   // Kill timers
  this.serialOutputBatcher = null;      // Clear ref
}
```

---

## 4. Serial Output Handling

### Backpressure Mechanism

**Field** (Line 103):
```
backpressurePaused: boolean = false    // Child paused due to buffer overload
```

**Trigger** in `handleParsedLine()` - serial_event case:
**Location**: [Lines 1472-1485](server/services/sandbox-runner.ts#L1472-L1485)  
**LOC**: 14

```typescript
case "serial_event":
  if (
    this.serialOutputBatcher &&
    !this.backpressurePaused &&
    !this.isPaused &&
    this.baudrate > 300 && // Don't throttle at very low baud rates
    this.serialOutputBatcher.isOverloaded()
  ) {
    this.logger.info("Backpressure: buffer overloaded, sending SIGSTOP");
    this.processController.kill("SIGSTOP");
    this.backpressurePaused = true;
  }
  if (this.serialOutputBatcher) {
    this.serialOutputBatcher.enqueue(parsed.data);
  } else if (onOutput) {
    onOutput(parsed.data, true);
  }
  break;
```

**Dependencies**:
- `serialOutputBatcher.isOverloaded()` — query method to check buffer depth
- `processController.kill("SIGSTOP")` — OS-level pause
- `baudrate` field — threshold: only throttle if > 300 baud

**Recovery** in SerialOutputBatcher `onChunk` callback:
**Location**: [Lines 971-988](server/services/sandbox-runner.ts#L971-L988)  
**LOC**: 18

```typescript
if (this.backpressurePaused) {
  setTimeout(() => {
    if (
      this.backpressurePaused &&
      this.serialOutputBatcher &&
      !this.serialOutputBatcher.isOverloaded() &&
      !this.isPaused &&
      this.processController.hasProcess()
    ) {
      this.logger.info("Backpressure relieved, sending SIGCONT");
      this.processController.kill("SIGCONT");
      this.backpressurePaused = false;
    }
  }, 0);
}
```

**Issue**: Uses `setTimeout(..., 0)` to defer check because batcher clears `pendingData` AFTER calling callback.

---

### Serial Output Split Logic

**Location**: [Lines 990-1000](server/services/sandbox-runner.ts#L990-L1000)  
**LOC**: 11

```typescript
const endsWithNewline = data.endsWith('\n');
const parts = data.split('\n');
for (let i = 0; i < parts.length; i++) {
  const isLastPart = i === parts.length - 1;
  if (isLastPart && endsWithNewline) {
    // Trailing empty string from split("...\n") — skip
    break;
  }
  const isComplete = !isLastPart && !(i === 0 && firstLineIncomplete);
  out(parts[i], isComplete);
}
```

**Purpose**: Preserve Serial.print() vs println() semantics:
- `Serial.println("foo")` → `data = "foo\n"` → emit `"foo"` with `isComplete=true`
- `Serial.print("foo")` → `data = "foo"` → emit `"foo"` with `isComplete=false`
- Multiple lines: `"a\nb\n"` → emit `"a"` (complete), `"b"` (complete)

**Dependencies**:
- `firstLineIncomplete` parameter — set when data dropped in previous flush
- `outputCallback` — must be non-null (checked before split)

---

## 5. Output Callbacks

### Fields (Lines 107-116)

| Field | Type | Purpose |
|-------|------|---------|
| `ioRegistryCallback` | `(registry, baudrate?, reason?) => void` \| undefined | IO registry updates to WebSocket |
| `onOutputCallback` | `(line, isComplete?) => void` \| null | Current serial output sink |
| `outputCallback` | `(line, isComplete?) => void` \| null | **Stable ref** for async playback |
| `errorCallback` | `(line) => void` \| null | **Stable ref** for error lines |
| `pinStateCallback` | `(pin, type, value) => void` \| null | **Stable ref** for pin changes |
| `telemetryCallback` | `(metrics) => void` \| null | **Stable ref** for telemetry metrics |

**Key distinction**: `onOutputCallback` vs `outputCallback`
- `onOutputCallback` bound in `initializeRunState()` (Lines 790-792)
- `outputCallback` bound in `runSketch()` (Lines 951-956)
- Stable refs enable deferred message queue playback

---

### Initialization Chain

#### 1. Constructor (Lines 154-181)
```typescript
this.registryManager = new RegistryManager({
  onUpdate: (registry, baudrate, reason) => {
    if (this.ioRegistryCallback) {
      this.ioRegistryCallback(registry, baudrate, reason);
    }
    this.flushMessageQueue();  // ← Queue flush on registry sync
  },
  onTelemetry: (metrics) => {
    if (this.telemetryCallback) {
      this.telemetryCallback(metrics);
    }
  },
});
```

#### 2. `initializeRunState()` (Lines 790-792)
```typescript
this.onOutputCallback = onOutput;
this.ioRegistryCallback = onIORegistry;
```

#### 3. `runSketch()` - Binding stable refs (Lines 951-956)
```typescript
this.outputCallback = onOutput;
this.errorCallback = onError;
this.pinStateCallback = onPinState || null;
this.telemetryCallback = onTelemetry || null;
```

---

### Router: `createWrappedCallbacks()`
**Location**: [Lines 1046-1090](server/services/sandbox-runner.ts#L1046-L1090)  
**LOC**: 45  
**Purpose**: Create wrapper functions that add queuing logic for registry sync

**Pattern for each callback type**:

**onOutput wrapper** (Lines 1048-1075):
- Filters telemetry markers: `[[SIM_TELEMETRY:...]]`
- Extracts and re-routes telemetry JSON to `telemetryCallback`
- Routes regular serial data to `serialOutputBatcher.enqueue()`
- Fallback if batcher unavailable

**onPinState wrapper** (Lines 1077-1087):
- If `registryManager.isWaiting()`: queue to `messageQueue`
- Else: call `onPinState` directly

**onError wrapper** (Lines 1089-1090):
- No queuing; calls `onError` immediately

---

### Callback Invocation Points

| Location | Callback | Invoked By |
|----------|----------|------------|
| [setupStdoutHandler](server/services/sandbox-runner.ts#L1281-L1307) | `onPinState`, `onOutput`, `onError` | `handleParsedLine()` parser dispatch |
| [setupStderrHandlers](server/services/sandbox-runner.ts#L1309-L1336) | Same | Line events, fallback buffer |
| [handleParsedLine](server/services/sandbox-runner.ts#L1453-L1517) | All types | Router based on `parsed.type` |
| [setupLocalHandlers](server/services/sandbox-runner.ts#L1421-1462) | Exit callback + above | Process close event |
| Resume/Pause | `sendOutputWithDelay()` | Manual state transitions |

**Dependencies**:
- Callbacks can be null → all invocations must guard with `if (callback)`
- Guarding uses both truthy check AND type check: `if (typeof out !== 'function')`

---

## Summary of Extractable Helpers for Better Testability

### 🎯 High Priority Candidates

#### 1. **OutputBufferManager** (Extract Lines 1538-1589)
- Isolate baudrate-aware character scheduler
- Remove dependency on instance state flags
- **Issues to address**:
  - Replace `this.isSendingOutput` with explicit state machine
  - Cancel pending setTimeout chains on cleanup
  - Test timeout accumulation at high baud rates

```typescript
class OutputBufferManager {
  private queue: string;
  private index: number = 0;
  private timer: NodeJS.Timeout | null = null;
  
  enqueue(char: string): void { }
  flush(onOutput: Callback): Promise<void> { }
  cancel(): void { clearTimeout(this.timer); }
  clear(): void { this.queue = ""; this.index = 0; }
}
```

#### 2. **MessageQueueRouter** (Extract Lines 238-264 + 1046-1090)
- Consolidate message queuing and playback logic
- Currently split between `flushMessageQueue()` and `createWrappedCallbacks()`
- **Issues to address**:
  - Merge queuing conditions (registry wait state, callback availability)
  - Test queue overflow scenarios
  - Test message ordering guarantees

```typescript
class MessageQueueRouter {
  enqueueIfWaiting(msg: Msg): void { }
  enqueueOutput(line: string, isComplete: boolean): void { }
  enqueuePinState(pin, type, value): void { }
  flush(callbacks: Callbacks): void { }
}
```

#### 3. **SerialOutputHandler** (Extract Lines 967-1001 + 1472-1485)
- Combine backpressure logic + batcher + split logic
- Currently scattered across multiple methods
- **Issues to address**:
  - Test SIGSTOP/SIGCONT transitions
  - Test line splitting for println vs print
  - Test backpressure recovery deferred checking

```typescript
class SerialOutputHandler {
  enqueue(data: string): void { }
  checkBackpressure(batcher, process): void { }
  private splitAndEmit(data: string): void { }
}
```

#### 4. **OutputCallbackDispatcher** (Extract callbacks section)
- Consolidate all callback invocation logic
- Currently fragmented: direct calls + registry dispatch + queue playback
- **Issues to address**:
  - Null-safety testing (missing callbacks)
  - Callback ordering and race conditions
  - Stable reference vs instance reference swap

```typescript
class OutputCallbackDispatcher {
  setCallbacks(stable: StableCallbacks): void { }
  dispatchOutput(line, isComplete): void { }
  dispatchError(line): void { }
  dispatchPinState(pin, type, value): void { }
  dispatchTelemetry(metrics): void { }
}
```

### 📋 Medium Priority (Validation)

#### 5. **BackpressureController**
- Separate backpressure detection from serial output
- Currently inline in `handleParsedLine()` serial_event case
- Test SIGSTOP threshold (baudrate > 300, isOverloaded check)

#### 6. **StderrFallbackLineBuffer**  
- Consolidate fallback buffer logic (Lines 1317-1336)
- Currently duplicated in Docker + local handlers
- Test line reassembly on partial reads

---

## Memory Leak Risks & Cleanup Issues

| Issue | Location | Risk | Fix |
|-------|----------|------|-----|
| Callback refs not cleared on stop | [1626-1629](server/services/sandbox-runner.ts#L1626-L1629) | ✅ Mitigated | All callbacks set to null |
| setTimeout chains from sendOutputWithDelay | [1589](server/services/sandbox-runner.ts#L1589) | ⚠️ High | No cancel mechanism for pending iterations |
| messageQueue references old state | [264](server/services/sandbox-runner.ts#L264) | ✅ Safe | Queue cleared after flush |
| Batcher timers | [1764-1767](server/services/sandbox-runner.ts#L1764-L1767) | ✅ Mitigated | destroy() called in stop() |
| stderrFallbackBuffer accumulation | [1436-1439](server/services/sandbox-runner.ts#L1436-L1439) | ⚠️ Medium | Buffer swapped on process close |
| registryManager debounce timers | [1636](server/services/sandbox-runner.ts#L1636) | ✅ Mitigated | reset() clears timers in stop() |

---

## Testing Recommendations

### Unit Test Scenarios

1. **Output Buffer**
   - [ ] Enqueue/dequeue at various baud rates
   - [ ] Output limit enforcement (100MB cap)
   - [ ] Index tracking prevents O(n²) re-reading
   - [ ] Cancel pending setTimeout (needs new API)

2. **Message Queue**
   - [ ] Queue while registry waiting
   - [ ] Flush on registry ready
   - [ ] Message ordering (FIFO)
   - [ ] Callback null-safety
   - [ ] Mixed message types

3. **Backpressure**
   - [ ] SIGSTOP triggered only on overload + baudrate > 300
   - [ ] SIGCONT recovery deferred (setTimeout 0)
   - [ ] No backpressure if globally paused

4. **Serial Output Splitting**
   - [ ] println with \n → complete
   - [ ] print without \n → incomplete
   - [ ] Multiple lines handled correctly
   - [ ] firstLineIncomplete flag honored

5. **Callbacks**
   - [ ] Stable refs used for async playback
   - [ ] null-safe dispatch in flushMessageQueue()
   - [ ] Telemetry markers filtered from serial output
   - [ ] Callback cleanup in stop()

### Integration Test Scenarios
- [ ] Stop during output sending
- [ ] Pause/resume with batchers active
- [ ] High baudrate (> 300) backpressure cycling
- [ ] Output limit hit mid-stream
- [ ] Registry sync + message queue flush ordering
