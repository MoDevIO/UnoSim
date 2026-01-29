# 🔧 Session Recovery Plan - Analog Pin Frames & IO-Registry

**Status**: Previous session partially broken. This plan provides step-by-step recovery with testing.

---

## 📋 Overview of Completed Work

These features were successfully implemented and should be preserved:
- ✅ Pause/Resume atomic timing
- ✅ Safari pin marker fix (15/15 pins)
- ✅ Debug Console (dark theme, filtering, export, copy)
- ✅ io_registry deduplication
- ✅ Pin marker visibility during pause

**Current Issue**: Analog pin frame display and IO-Registry operations table broken.

---

## 🎯 Step-by-Step Recovery Plan

### **STEP 1: Verify Existing Infrastructure** (10 min)
**Goal**: Confirm pause/resume, debug console, pin markers work

**Testing**:
```bash
npm run build
npm test 2>&1 | grep "Test Suites"  # Should see ~280 tests passing
```

**Verify in Browser** (http://localhost:3001/simulator):
- [ ] Load simple sketch with `pinMode(2, INPUT)`
- [ ] Click "Simulate"
- [ ] Pin 2 shows yellow frame
- [ ] Pause/Resume buttons work
- [ ] Press `Ctrl+Shift+D` opens Debug Console
- [ ] Debug Console shows "I/O Registry" messages

**If Tests Fail**:
- Don't continue, something fundamental is broken
- Check git log for where changes started
- Consider full rollback

---

### **STEP 2: Fix IO-Registry Data Flow** (30 min)
**Goal**: Ensure `usedAt` operations array reaches client correctly

**Locations to Check**:

#### 2.1 Server-Side Parse (sandbox-runner.ts:490-530)
**File**: `/server/services/sandbox-runner.ts`

Check that parsing extracts operations:
```typescript
const operationsStr = pinMatch[5];  // Should contain "digitalWrite@5:analogRead@10"
if (operationsStr) {
  const opMatches = operationsStr.match(/([^:@]+(?::\d+)?@\d+)/g);
  if (opMatches) {
    opMatches.forEach((opMatch) => {
      const operation = opMatch.substring(0, atIndex);  // "digitalWrite", "analogRead", etc
      usedAt.push({ line: lineNumber, operation });
    });
  }
}
```

**Debug**: Add console.log before sending:
```typescript
this.logger.debug(`[io_registry] Parsed operations for pin ${pin}:`, usedAt);
```

#### 2.2 Client Receive (arduino-simulator.tsx:1657-1690)
**File**: `/client/src/pages/arduino-simulator.tsx`

**Code to verify**:
```typescript
case "io_registry": {
  const { registry } = message;
  setIoRegistry(registry);
  
  // DEBUG: Check structure
  if (debugMode) {
    console.log("io_registry received:", registry);
    registry.forEach(pin => {
      console.log(`Pin ${pin.pin}: usedAt =`, pin.usedAt);
    });
  }
  
  // Rest of code...
}
```

**Test**:
```bash
# In browser console:
console.log(window.__debugRegistry)  # If available
```

**Expected Output**:
```json
[
  {
    "pin": "0",
    "defined": false,
    "usedAt": [
      { "line": 0, "operation": "digitalRead" },
      { "line": 0, "operation": "digitalWrite" }
    ]
  }
]
```

**If usedAt is empty/undefined**:
- Problem is in server parsing
- Add debug logs to sandbox-runner.ts parseRegistry function
- Check C++ output format with: `npm run build` and check compiled binary output

---

### **STEP 3: Verify C++ Operations Tracking** (15 min)
**Goal**: Ensure Arduino mock sends operations

**File**: `/server/mocks/arduino-mock.ts`

**Key Functions**:
```typescript
void trackIOOperation(int pin, const std::string& operation) {
  // Should add to ioRegistry[pin].operations
  // Format: "digitalRead", "digitalWrite", "analogRead", "analogWrite"
}

void outputIORegistry() {
  // Should output: [[IO_PIN:0:0:0:0:digitalWrite@5:digitalRead@10]]
  // Format: [[IO_PIN:pin:defined:definedLine:pinMode:operation1@line1:operation2@line2]]
}
```

**Verify Output** (Lines 201-216):
```cpp
for (const auto& op : rec.operations) {
    if (opCount >= 5) break;  // Limit to 5 ops per pin
    std::cerr << ":" << op.operation << "@" << op.line;
    opCount++;
}
```

**Test with io-test.ino**:
```bash
# Should see in server logs:
# [[IO_PIN:0:1:0:0:pinMode:0@0:digitalRead@...]]
# [[IO_PIN:16:0:0:0:analogRead@...]]
```

---

### **STEP 4: Fix ParserOutput Tabelle** (20 min)
**Goal**: Operations appear in "Programmed pins" table

**File**: `/client/src/components/features/parser-output.tsx`

**The Logic (Lines 414-430)** should filter operations:
```typescript
const digitalReads = ops.filter((u) =>
  u.operation.includes("digitalRead"),
);
const analogReads = ops.filter((u) =>
  u.operation.includes("analogRead"),
);
```

**Check Table Rendering** (Lines 580-640):
```tsx
{analogReads.length > 0 ? (
  <span className="text-green-400">✓</span>
) : (
  <span className="text-gray-500">—</span>
)}
```

**Test with io-test.ino**:
1. Load io-test.ino in simulator
2. Click "Registry" tab in output panel
3. **Expected**: 
   - Pin 0-6: "digitalRead" column filled
   - Pin 7-13: show operations used
   - Pin A2-A5: "analogRead" column filled

**If Still Empty**:
- Add React.useMemo debug:
```typescript
const filteredRegistry = React.useMemo(() => {
  console.log("Filtering registry:", ioRegistry);
  return ioRegistry.filter(/* ... */);
}, [ioRegistry, showAllPins]);
```

---

### **STEP 5: Implement Analog Pin Frame Display** (25 min)
**Goal**: A0-A5 frames show correctly (solid for INPUT, dashed for analogRead)

**File**: `/client/src/components/features/arduino-board.tsx` (Lines 290-345)

**Current Logic Should Be**:
```typescript
const isInput = isPinInput(pinNumber);           // INPUT/INPUT_PULLUP mode
const usedAsAnalog = analogPins.includes(pinNumber);  // analogRead() detected

if (frame) {
  // Show if INPUT or analogRead
  const show = isInput || usedAsAnalog;
  frame.style.display = show ? "block" : "none";
  frame.style.filter = show ? "drop-shadow(0 0 2px #ffff00)" : "none";
  
  // Dashed ONLY if analogRead
  if (show && usedAsAnalog) {
    frame.style.strokeDasharray = "3,2";
  } else {
    frame.style.strokeDasharray = "";
  }
}

// Click area
if (click) {
  const clickable = isInput || usedAsAnalog;
  click.style.pointerEvents = clickable ? "auto" : "none";
  click.style.cursor = clickable ? "pointer" : "default";
}
```

**Test Scenarios**:

**Scenario A**: `pinMode(A0, INPUT)` only
```cpp
void setup() { pinMode(A0, INPUT); }
void loop() { }
```
- Expected: A0 has solid yellow frame
- Clickable: Yes (opens analog dialog)
- Dashed: No

**Scenario B**: `analogRead(A0)` only
```cpp
void setup() { }
void loop() { int val = analogRead(A0); }
```
- Expected: A0 has dashed yellow frame
- Clickable: Yes
- Dashed: Yes

**Scenario C**: Both
```cpp
void setup() { pinMode(A0, INPUT); }
void loop() { int val = analogRead(A0); }
```
- Expected: A0 has dashed yellow frame (dashed wins)
- Clickable: Yes
- Dashed: Yes

---

### **STEP 6: Test Analog Value Input Dialog** (15 min)
**Goal**: Clicking analog pin opens value slider dialog

**File**: `/client/src/components/features/arduino-board.tsx` (Lines 680-730)

**Current Logic**:
```typescript
const isAnalogPin = pin >= 14 && pin <= 19;
const isInputPin = state && (state.mode === "INPUT" || state.mode === "INPUT_PULLUP");
const usedAsAnalog = analogPins.includes(pin);

if (isAnalogPin && (isInputPin || usedAsAnalog) && onAnalogChange) {
  // Open dialog with value slider
  setAnalogDialog({ open: true, pin, value: val, /* ... */ });
}
```

**Test**:
1. Load sketch with `analogRead(A0)` or `pinMode(A0, INPUT)`
2. Run simulation
3. Click on A0 pin frame
4. **Expected**: Dialog opens with slider (0-1023)

---

### **STEP 7: Add Parser Validation for Invalid Analog Pins** (20 min)
**Goal**: Warn if `analogRead()` called with invalid pins

**File**: `/client/src/pages/arduino-simulator.tsx` (Lines 1850-1950)

**⚠️ CRITICAL**: setParserMessages() MUST be called AFTER loops complete, NOT inside loops!

**Pattern** (Lines 1865-1920):
```typescript
// WRONG ❌
while (m = regex.exec(code)) {
  if (invalid) {
    setParserMessages(prev => [...prev, warning]);  // BREAKS REACT!
  }
}

// CORRECT ✅
const warnings = [];
while (m = regex.exec(code)) {
  if (invalid) {
    warnings.push(warning);
  }
}
if (warnings.length > 0) {
  setParserMessages(prev => [...prev, ...warnings]);
}
```

**Validations to Add**:

1. **analogRead() with invalid pin**:
```cpp
analogRead(A6)     // ❌ A6 doesn't exist
analogRead(20)     // ❌ Pin 20 invalid
analogRead(myVar)  // ⚠️ If myVar points to invalid pin
```

2. **For-loop with invalid range**:
```cpp
for (int i=20; i<24; i++) { analogRead(i); }  // ❌ All invalid
```

**Implementation**:
```typescript
const analogValidationWarnings: ParserMessage[] = [];

// ... detect analogRead ...
if (invalidPin) {
  analogValidationWarnings.push({
    type: "warning",
    message: `analogRead(A${idx}): Invalid analog input. Arduino UNO supports only A0-A5.`,
    line: 0,
    severity: 2,
  });
}

// AFTER loop:
if (analogValidationWarnings.length > 0) {
  setParserMessages(prev => [...prev, ...analogValidationWarnings]);
}
```

---

### **STEP 8: Write & Run Comprehensive Tests** (30 min)
**Goal**: Verify all functionality works end-to-end

**Test Files to Update/Create**:
- `/e2e/arduino-board-pin-frames.spec.ts` - Already has good structure
- `/tests/client/io-registry.test.ts` - NEW (if needed)

**io-test.ino Benchmark**:
```cpp
void setup() {
  Serial.begin(115200);
  pinMode(A0, INPUT);
  
  for (byte i=0; i<7; i++) {
    pinMode(i, INPUT);
  }
  for (byte i=7; i<15; i++) {
    pinMode(i, INPUT_PULLUP);
  }
}

void loop() {
  Serial.print("Digital inputs: ");
  for (byte i = 0; i < 7; i++) {
    Serial.print(digitalRead(i));
    Serial.print(" ");
  }
  Serial.print(" | Analog inputs: ");
  for (byte i = 16; i < 20; i++) {
    Serial.print(analogRead(i));
    Serial.print(" ");
  }
  Serial.println();
  
  analogWrite(5, 128);
  digitalWrite(6, !digitalRead(6));
  
  delay(100);
}
```

**Expected Results**:
- [ ] Pins 0-13 show yellow frames (INPUT configured)
- [ ] Pins A2-A5 show dashed yellow frames (analogRead used)
- [ ] Pin A0 shows solid yellow frame (pinMode only)
- [ ] All operations visible in Registry tab table
- [ ] Can click any INPUT pin to toggle/change value
- [ ] Can click any A0-A5 to open analog slider

---

## ⚠️ Important Rules & Gotchas

### **1. State Management in React**
```typescript
// ❌ NEVER do this in loops:
while (condition) {
  setState(value);  // Causes render loops!
}

// ✅ ALWAYS do this:
const values = [];
while (condition) {
  values.push(value);
}
setState(prev => [...prev, ...values]);
```

### **2. IO-Registry Structure**
The `usedAt` array must have proper format:
```typescript
usedAt: [
  { line: 0, operation: "digitalWrite" },
  { line: 0, operation: "analogRead" },
]
```
NOT:
```typescript
usedAt: ["digitalWrite", "analogRead"]  // ❌ Wrong!
```

### **3. Analog Pin Numbers**
- Internal Pins: 14-19 (correspond to A0-A5)
- In Code: A0, A1, A2, A3, A4, A5 OR 0-5 (as channels) OR 14-19
- Arduino automatically maps: A0 = 14, A1 = 15, etc.

### **4. Frame Display Priority**
```typescript
// Priority order:
1. analogRead() detected → dashed frame (highest priority)
2. pinMode(pin, INPUT) → solid frame
3. Not used → no frame (hidden)
```

### **5. Parser Message Validation**
Always include `severity` field:
```typescript
{
  type: "warning",
  message: "...",
  line: 0,
  severity: 2,  // 1=info, 2=warning, 3=error
}
```

---

## 🧪 Testing Checklist

After each step, run:
```bash
npm run build        # Compilation check
npm test             # Unit tests
```

Before shipping, test manually:
- [ ] Load io-test.ino
- [ ] Verify all pin frames display correctly
- [ ] Click each pin, verify clickable state
- [ ] Check Registry tab shows all operations
- [ ] Debug Console shows io_registry message with operations
- [ ] Pause/Resume still works
- [ ] Safari: same results as Firefox

---

## 📍 File Locations Summary

| Component | File | Key Lines |
|-----------|------|-----------|
| **C++ Operations** | `server/mocks/arduino-mock.ts` | 245-305 |
| **Server Registry Parse** | `server/services/sandbox-runner.ts` | 490-530, 882-915 |
| **Client Registry Display** | `client/src/pages/arduino-simulator.tsx` | 1657-1690, 1850-1950 |
| **ParserOutput Table** | `client/src/components/features/parser-output.tsx` | 400-430, 580-640 |
| **Analog Pin Rendering** | `client/src/components/features/arduino-board.tsx` | 290-345, 680-730 |
| **Debug Console** | `client/src/components/debug-console.tsx` | Full file |

---

## 🎯 Success Criteria

When complete, this should work:

1. ✅ io-test.ino displays all pin operations in table
2. ✅ Analog pins A0-A5 show correct frame styles (solid vs dashed)
3. ✅ All pins clickable with proper behavior
4. ✅ Debug Console shows IO-Registry with operations
5. ✅ No React warnings in browser console
6. ✅ All unit tests passing
7. ✅ Same behavior Firefox/Chrome/Safari

---

**Last Updated**: 28. Januar 2026  
**Session**: Bug Recovery & Analog Pin Frames Implementation
