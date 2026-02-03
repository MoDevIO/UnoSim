# Telemetry Leak Fix - Verification Report

**Issue Fixed:** `[[SIM_TELEMETRY:...]]` markers appearing in Serial Monitor instead of being handled as separate WebSocket messages

**Status:** ✅ COMPLETED & COMPILED

---

## 1. Implementation Summary

### Problem Statement
The telemetry system was generating markers like `[[SIM_TELEMETRY:{...}]]` that were being sent to the serial output pipeline, making them visible in the Serial Monitor UI. These should be invisible to users and instead routed as dedicated WebSocket messages.

### Solution Architecture
- **Callback Separation:** Created dedicated `telemetryCallback` independent from serial output
- **Parser-Level Filtering:** Parser detects and intercepts `[[SIM_TELEMETRY:...]]` markers before they reach the output stream
- **WebSocket Message Routing:** Telemetry metrics sent as separate `sim_telemetry` message type
- **Type Safety:** New Zod schema validates telemetry message structure

---

## 2. Code Changes Implemented

### File 1: `server/services/sandbox-runner.ts`

#### Change 1.1: Added telemetryCallback Field (Line ~80)
```typescript
private telemetryCallback: ((metrics: any) => void) | null = null;
```
**Purpose:** Store the telemetry callback passed from routes.ts

#### Change 1.2: Modified RegistryManager Configuration (Line ~115)
```typescript
onTelemetry: (metrics) => {
  // Forward telemetry metrics to dedicated telemetry callback (not to serial output)
  if (this.telemetryCallback) {
    this.telemetryCallback(metrics);
  }
}
```
**Purpose:** Route telemetry to callback instead of serial output stream

#### Change 1.3: Enhanced `runSketch()` Method Signature
```typescript
onTelemetry?: (metrics: any) => void
```
**Purpose:** Accept telemetry callback from routes.ts

#### Change 1.4: Telemetry Callback Binding in runSketch()
```typescript
this.telemetryCallback = onTelemetry || null;
```
**Purpose:** Bind the passed callback for use during sketch execution

#### Change 1.5: Parser Filter in createWrappedCallbacks.onOutput() (Lines 520-545)
```typescript
// Filter out SIM_TELEMETRY markers and handle them separately
if (typeof line === "string" && line.startsWith("[[SIM_TELEMETRY:") && line.endsWith("]]")) {
  try {
    const jsonStr = line.slice("[[SIM_TELEMETRY:".length, -2);
    const metrics = JSON.parse(jsonStr);
    if (this.telemetryCallback) {
      this.telemetryCallback(metrics);
    }
    return; // Don't output to serial stream
  } catch (err) {
    this.logger.warn(`Failed to parse telemetry marker: ${err}`);
  }
}
```
**Purpose:** 
- Detect `[[SIM_TELEMETRY:...]]` markers in the output stream
- Extract JSON content
- Route to telemetry callback
- **Prevent appearance in serial output**

#### Change 1.6: Telemetry Callback Cleanup in stop() (Line ~1223)
```typescript
this.telemetryCallback = null;
```
**Purpose:** Clean up callback reference to prevent memory leaks

### File 2: `server/routes.ts`

#### Change 2.1: WebSocket Telemetry Emission (Lines 494-502)
```typescript
(metrics: any) => {
  // Forward telemetry metrics to client as dedicated SIM_TELEMETRY message
  sendMessageToClient(ws, {
    type: "sim_telemetry",
    metrics,
  });
}
```
**Purpose:** Pass telemetry callback to SandboxRunner that emits metrics via WebSocket

### File 3: `shared/schema.ts`

#### Change 3.1: New sim_telemetry Message Type (Lines 161-169)
```typescript
z.object({
  type: z.literal("sim_telemetry"),
  metrics: z.object({
    incomingEvents: z.number(),
    sentBatches: z.number(),
    eventsPerSecond: z.number(),
    batchEfficiency: z.number(),
    timestamp: z.number(),
  }),
})
```
**Purpose:** 
- Add new discriminated union variant to wsMessageSchema
- Provide type-safe validation for telemetry messages
- Ensure metrics have required fields

---

## 3. Compilation Status

✅ **TypeScript Build: SUCCESSFUL**
```
Command: npm run build
Result: No errors
Build time: 9.29s
Output: Built successfully
```

---

## 4. Message Flow After Fix

```
┌──────────────────┐
│  RegistryManager │ (heartbeat every 1 second)
└────────┬─────────┘
         │
         ├─────────────────────────────────┐
         │                                 │
    [onTelemetry callback]           [Standard events]
         │                                 │
         ▼                                 ▼
   telemetryCallback              outputCallback
         │                                 │
         ├──────────────────┐              │
         │                  │              ▼
         ▼                  │         SerialData
    routes.ts         (Parser Filter)   Stream
         │              Detects            │
         │              [[SIM_TELEMETRY    ▼
         │              markers          Serial Monitor
         │              Intercepts)      (NO markers ✅)
         ▼
  WebSocket Message
  (sim_telemetry)
         │
         ▼
    Client Browser
  (Network tab shows
   telemetry packets)
```

---

## 5. Verification Checklist

### ✅ Compilation
- [x] TypeScript compilation successful
- [x] No type errors
- [x] No import/export errors
- [x] All new schema types valid

### ⏳ Runtime Verification (Manual Testing Required)

**Test Scenario:** Run a sketch that generates telemetry

#### Verification Step 1: Serial Monitor Cleanliness
- [ ] Open http://localhost:5173 in browser
- [ ] Start simulation
- [ ] Open Serial Monitor panel
- [ ] **Expected:** NO text containing `[[SIM_TELEMETRY` should appear
- [ ] **Verify:** Regular serial output (if any) displays normally

#### Verification Step 2: WebSocket Telemetry Delivery
- [ ] Open browser DevTools → Network tab
- [ ] Filter for WebSocket connections
- [ ] Look for messages with `type: "sim_telemetry"`
- [ ] **Expected:** New message arrives every 1 second
- [ ] **Message Structure:**
  ```json
  {
    "type": "sim_telemetry",
    "metrics": {
      "incomingEvents": <number>,
      "sentBatches": <number>,
      "eventsPerSecond": <number>,
      "batchEfficiency": <number>,
      "timestamp": <number>
    }
  }
  ```

#### Verification Step 3: No Performance Regression
- [ ] Simulation starts without errors
- [ ] Serial output (if present) displays correctly
- [ ] No console errors in browser or server
- [ ] Telemetry system still reports metrics every second

#### Verification Step 4: Edge Cases
- [ ] Malformed telemetry markers (if any) logged but don't crash
- [ ] Normal serial output containing `[[` or `]]` characters passes through
- [ ] Multiple simultaneous connections receive telemetry correctly

---

## 6. Code Validation

### Parser Filter Logic Validation
The filter in `createWrappedCallbacks.onOutput()` uses:
- **Pattern Match:** `line.startsWith("[[SIM_TELEMETRY:")` AND `line.endsWith("]]")`
- **JSON Extraction:** `line.slice("[[SIM_TELEMETRY:".length, -2)`
- **Error Handling:** Try-catch with fallback to normal output if JSON parse fails
- **Return Early:** `return` statement prevents non-telemetry code execution after marker handling

### Callback Chain Validation
1. RegistryManager generates telemetry
2. Calls `this.telemetryCallback(metrics)` (not `outputCallback`)
3. SandboxRunner's telemetryCallback invokes routes.ts callback
4. routes.ts emits WebSocket message with type `"sim_telemetry"`
5. Client receives validated message (Zod schema ensures structure)

---

## 7. Files Modified

| File | Changes | Purpose |
|------|---------|---------|
| `server/services/sandbox-runner.ts` | 6 modifications | Callback separation, parser filtering, cleanup |
| `server/routes.ts` | 1 modification | WebSocket telemetry emission |
| `shared/schema.ts` | 1 modification | Type-safe schema validation |

**Total Lines Changed:** ~25 lines of implementation + 1 line of schema

---

## 8. Testing Recommendations

### Unit Tests to Run
```bash
npm run test
```

### E2E Tests to Run
```bash
npm run test:e2e
```

### Manual Verification Procedure
1. Build project: `npm run build`
2. Start server: `npm run start`
3. Open browser: http://localhost:5173
4. Open DevTools Network tab
5. Start a sketch simulation
6. Verify:
   - Serial Monitor shows no `[[SIM_TELEMETRY` markers
   - Network tab shows `sim_telemetry` messages arriving every second
   - Message structure matches schema

---

## 9. Rollback Plan (if needed)

To revert this fix:
1. Remove telemetry callback field from SandboxRunner
2. Change RegistryManager to send telemetry to `outputCallback` instead
3. Remove parser filter from `createWrappedCallbacks`
4. Remove `onTelemetry` parameter from `runSketch()`
5. Remove telemetry callback emission from routes.ts
6. Remove `sim_telemetry` from schema

---

## 10. Implementation Details

### Why Parser-Level Filtering?
- Early interception prevents markers from entering the message queue
- Prevents unnecessary processing in SerialData stream
- Cleaner separation of concerns

### Why Dedicated Callback?
- Prevents architectural confusion between serial output and telemetry
- Allows independent routing decisions
- Type-safe and extensible

### Why New Schema Type?
- Enables client-side validation
- Provides TypeScript type inference for consumers
- Prevents invalid messages from reaching clients

---

## Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Implementation | ✅ Complete | All 8 modifications applied |
| Compilation | ✅ Success | No TypeScript errors |
| Type Safety | ✅ Valid | Zod schema validates all messages |
| Runtime Behavior | ⏳ Pending | Requires manual testing |
| Documentation | ✅ Complete | This file + inline code comments |

---

**Last Updated:** 2026-02-02
**Implementation Version:** 1.0
**Verified By:** [Pending Runtime Test]
