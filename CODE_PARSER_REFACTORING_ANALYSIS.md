# Code-Parser.ts Refactoring Analysis

**File:** `shared/code-parser.ts` (830 lines)  
**Date:** 2026-03-18  
**Focus:** Cognitive Complexity (CC) > 15, Negated Conditions, Extraction Opportunities

---

## 1. NEGATED CONDITIONS (Code Smells)

### Issue 1.1: Double Negation Anti-pattern (Lines 75, 87)

**Location:** `PinCompatibilityChecker.getPinModeInfo()` method  
**Lines:** 75, 87  
**Pattern:** `if (!result.has(key))` with empty if-branch followed by else

```typescript
// Line 75
if (!result.has(pin)) {
  result.set(pin, { modes: [mode], lines: [line] });
} else {
  const entry = result.get(pin)!;
  entry.modes.push(mode);
  entry.lines.push(line);
}

// Line 87 (identical structure)
if (!result.has(key)) {
  result.set(key, { modes: [mode], lines: [line] });
} else {
  const entry = result.get(key)!;
  entry.modes.push(mode);
  entry.lines.push(line);
}
```

**Issue:** Negated condition makes branch intention unclear  
**Refactoring Strategy:** Invert to positive condition  
```typescript
// BETTER:
if (result.has(pin)) {
  const entry = result.get(pin)!;
  entry.modes.push(mode);
  entry.lines.push(line);
} else {
  result.set(pin, { modes: [mode], lines: [line] });
}
```
**Benefit:** Follows "happy path first" pattern; more intuitive

---

## 2. HIGH COGNITIVE COMPLEXITY METHODS

### Method 2.1: `getLoopPinModeCalls()` 

**Location:** Lines 494–560  
**Current CC:** ~33 → **Target:** 15  
**Reduction Needed:** 55% (~18 points)

#### Complex Structure Analysis:

```
Breakdown:
─ Outer while loop (FOR_LOOP_HEADER.exec)           +1
├─ Assignment destructuring (4 variables)           +1
├─ Ternary operator (op === ...)                    +1
├─ Inner if-else (code[pos] === "{")                +2 (if/else)
│  ├─ Nested for loop (brace counting)              +1
│  └─ Nested if conditions in loop (3)              +3
├─ else (braceless body)                            +1
├─ Inner while (pinModeRe.exec)                     +1
└─ Inner for loop (startVal to lastVal)             +1
```
**Total CC Estimate:** ~33

#### Extraction Opportunities:

**A. Extract `extractLoopBody()` method**
```typescript
private extractLoopBody(
  code: string, 
  forMatchEnd: number, 
  startPos: number
): string {
  // Lines 512-540 extracted
  // Returns body or ""
  // Handles both braced { ... } and braceless cases
}
```
**Reduces:** 8–10 CC points (removes nested if-else and inner for-loop logic)

**B. Extract `extractPinModesFromBody()` method**
```typescript
private extractPinModesFromBody(
  body: string,
  varName: string,
  startVal: number,
  endVal: string // '<' or '<='
): { pin: number; mode: PinMode }[] {
  // Lines 542-554 extracted
  // Handles regex matching and pin range generation
}
```
**Reduces:** 4–6 CC points (removes inner while + inner for loop)

**C. Extract loop header parsing**
```typescript
private parseForLoopHeader(forMatch: RegExpExecArray): {
  varName: string;
  startVal: number;
  op: '<' | '<=';
  endVal: number;
  lastVal: number;
  forLine: number;
} {
  // Lines 500-508 extracted
}
```
**Reduces:** 2 CC points (simplifies main loop)

#### After Refactoring Structure:
```typescript
private getLoopPinModeCalls(code: string): PinModeCall[] {
  const results: PinModeCall[] = [];
  const forHeaderRe = PARSER_PATTERNS.FOR_LOOP_HEADER;
  
  let forMatch: RegExpExecArray | null;
  while ((forMatch = forHeaderRe.exec(code)) !== null) {
    const { varName, startVal, op, endVal, lastVal, forLine } = 
      this.parseForLoopHeader(forMatch);
    
    const pos = forMatch.index + forMatch[0].length;
    const body = this.extractLoopBody(code, forMatch, pos);
    
    const pinModes = this.extractPinModesFromBody(
      body, 
      varName, 
      startVal, 
      op === "<=" ? endVal : endVal - 1
    );
    
    results.push(...pinModes.map(({ pin, mode }) => ({
      pin,
      mode,
      line: forLine,
    })));
  }
  
  return results;
}
```
**New CC:** ~12–15 (Target achieved!)

---

### Method 2.2: `parseHardwareCompatibility()`

**Location:** Lines 565–710  
**Current CC:** ~31 → **Target:** 15  
**Reduction Needed:** 52% (~16 points)

#### Complex Structure Analysis:

```
Main method contains:
1. analogWrite PWM check (while loop)                +1 (while) +1 (if)
2. pinMode collection (while loop)                   +1 (while)
3. pinModeCalls delegation                          +1
4. loopConfiguredPins delegation                    +1
5. digitalRead/digitalWrite check (while loop)      +1 (while)
   ├─ Complex condition (lines 624–626)             +3 (nested &&)
   └─ Inner logic                                   +1
6. Variable pin checking (for + while)              +1 (for) +1 (while) +1 (if)
7. Dynamic pin usage check                          +2 (nested if)
8. OUTPUT pin conflict check (for loop)             +1 (for) +1 (if)
9. checkOutputPinsReadAsInput delegation            +1
```
**Total CC Estimate:** ~31

#### Extraction Opportunities:

**A. Extract `checkAnalogWritePWM()` method**
```typescript
private checkAnalogWritePWM(code: string): ParserMessage[] {
  // Lines 574–592 extracted
  // Returns messages array
  
  const PWM_PINS = [3, 5, 6, 9, 10, 11];
  // ... validation logic
}
```
**Reduces:** 3 CC points

**B. Extract `checkDigitalIOWithoutSetup()` method**
```typescript
private checkDigitalIOWithoutSetup(
  code: string,
  pinModeSet: Set<string>,
  loopConfiguredPins: Set<number>
): ParserMessage[] {
  // Lines 607–643 extracted
  // Complex nested conditions simplified
  
  // Implementation handles:
  // - digitalRead/digitalWrite without pinMode
  // - Variable pin usage
}
```
**Reduces:** 8–10 CC points (removes all the nested if chains and regex loops)

**C. Extract `checkPinModeVariables()` method**
```typescript
private checkPinModeVariables(
  code: string,
  uncommentedCode: string,
  usedVariables: Set<string>
): ParserMessage[] {
  // Lines 644–666 extracted
}
```
**Reduces:** 4 CC points

**D. Extract `determineOutputPins()` method**
```typescript
private determineOutputPins(
  pinModeCalls: Map<string, PinModeEntry>,
  uncommentedCode: string
): Set<number> {
  // Lines 691–700 extracted
  // Collects all OUTPUT pins from direct and loop-based calls
}
```
**Reduces:** 2 CC points

#### After Refactoring Structure:
```typescript
parseHardwareCompatibility(code: string): ParserMessage[] {
  const messages: ParserMessage[] = [];
  const uncommentedCode = this.removeComments(code);
  const pinChecker = new PinCompatibilityChecker(uncommentedCode);
  
  // Delegate to focused analyzers
  messages.push(...this.checkAnalogWritePWM(code));
  
  const pinModeCalls = pinChecker.getPinModeInfo(
    (c) => this.getLoopPinModeCalls(c)
  );
  messages.push(...pinChecker.checkPinModeConflicts(pinModeCalls));
  
  const pinModeSet = this.collectPinModeSet(code);
  const loopConfiguredPins = this.getLoopConfiguredPins(code);
  
  messages.push(
    ...this.checkDigitalIOWithoutSetup(
      code, 
      pinModeSet, 
      loopConfiguredPins
    )
  );
  
  const outputPins = this.determineOutputPins(
    pinModeCalls, 
    uncommentedCode
  );
  
  messages.push(
    ...pinChecker.checkOutputPinsReadAsInput(
      uncommentedCode,
      outputPins,
      (p) => this.parsePinNumber(p),
    ),
  );
  
  return messages;
}
```
**New CC:** ~12–14 (Target achieved!)

---

### Method 2.3: `analyzeLargeArraysAndRecursion()`

**Location:** Lines 226–290  
**Current CC:** ~18 → **Target:** 15  
**Reduction Needed:** 17% (~3 points)

#### Complex Structure Analysis:

```
Method:
1. Array validation                                 +1 (if)
2. Array size check                                 +1 (if)
3. Recursion detection loop (FUNCTION_DEF)         +1 (while)
4. Brace matching nested for-loop                  +1 (for)
   ├─ Opening brace check                          +1 (if)
   ├─ Closing brace check                          +1 (if)
   └─ Break condition (nested)                     +1 (if)
5. Function call checking regex                    +1 (if)
```
**Total CC Estimate:** ~18

#### Extraction Opportunities:

**A. Extract `findFunctionEnd()` method**
```typescript
private findFunctionEnd(
  code: string,
  startIndex: number
): number {
  // Lines 245–259 extracted
  // Returns index of closing brace
  // Reduces nested for-loop and if conditions
}
```
**Reduces:** 4 CC points

**B. Extract `isRecursive()` method**
```typescript
private isRecursive(
  functionBody: string,
  functionName: string
): boolean {
  // Lines 264–267: simplified
  const functionCallRegex = new RegExp(
    String.raw`\b${functionName}\s*\(`, 
    "g"
  );
  const calls = functionBody.match(functionCallRegex);
  return calls && calls.length > 1;
}
```
**Reduces:** 1 CC point

#### After Refactoring:
```typescript
analyzeLargeArraysAndRecursion(): ParserMessage[] {
  const messages: ParserMessage[] = [];
  
  messages.push(...this.checkLargeArrays());
  messages.push(...this.checkRecursion());
  
  return messages;
}

private checkLargeArrays(): ParserMessage[] {
  // Lines 229–245 extracted
}

private checkRecursion(): ParserMessage[] {
  // Lines 247–289 extracted
  const messages: ParserMessage[] = [];
  const functionDefinitionRegex = PARSER_PATTERNS.FUNCTION_DEF;
  let match;
  
  while ((match = functionDefinitionRegex.exec(this.uncommentedCode)) !== null) {
    const functionName = match[1];
    const functionEnd = this.findFunctionEnd(
      this.uncommentedCode,
      match.index
    );
    const functionBody = this.uncommentedCode.slice(match.index, functionEnd + 1);
    
    if (this.isRecursive(functionBody, functionName)) {
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "performance",
        severity: 2 as SeverityLevel,
        message: `Recursive function '${functionName}' detected...`,
        suggestion: "// Use iterative approach instead",
        line: this.findLineInFull(
          new RegExp(String.raw`\b${functionName}\s*\(`)
        ),
      });
    }
  }
  
  return messages;
}
```
**New CC:** ~12–14 (Target achieved!)

---

### Method 2.4: `FOR_LOOP_HEADER` Regex Pattern

**Location:** Line 27  
**Current Complexity:** ~29 → **Target:** 20  
**Type:** Regex Complexity (not traditional CC, but refactoring improves maintainability)

#### Issue Analysis:

```typescript
// Current (Complex):
FOR_LOOP_HEADER: /for\s*\(\s*(?:(?:unsigned\s+int|uint8_t|unsigned|byte|int|var)\s+)?([a-zA-Z_]\w*)\s*=\s*(\d+)\s*;\s*\1\s*(<=?)\s*(\d+)\s*;[^)]*\)/g,
```

**Problems:**
1. Multiple type alternations clutify intent
2. Hard to extend with new types
3. Unclear that types are optional
4. No comments explaining alternation order
5. Backreference `\1` is non-obvious

#### Refactoring Strategy:

**A. Create type patterns constant:**
```typescript
const TYPE_KEYWORDS = (
  'unsigned\\s+int|uint8_t|unsigned|byte|int|var'
);
const OPTIONAL_TYPE = `(?:(?:${TYPE_KEYWORDS})\\s+)?`;
```

**B. Build regex incrementally with comments:**
```typescript
// Better: Document each component
const FOR_LOOP_PATTERNS = {
  // Matches: for (type? varName = start; varName <= end; ...)
  // Types: int, byte, unsigned int, uint8_t, unsigned, var, or none
  SIMPLE_LOOP: new RegExp(
    String.raw`for\s*\(\s*` +           // "for ("
    `(?:(?:unsigned\s+int|uint8_t|unsigned|byte|int|var)\s+)?` + // Optional type
    `([a-zA-Z_]\w*)\s*=\s*(\d+)\s*;` + // varName = start;
    `\s*\1\s*(<=?)\s*(\d+)\s*;` +       // varName <=/>= end;
    `[^)]*\)`,                          // ... ; )
    'g'
  ),
} as const;
```

**C. Alternative: Use named capture groups (ES2018+):**
```typescript
const FOR_LOOP_HEADER = /for\s*\(\s*(?:(?<type>unsigned\s+int|uint8_t|unsigned|byte|int|var)\s+)?(?<var>[a-zA-Z_]\w*)\s*=\s*(?<start>\d+)\s*;\s*\k<var>\s*(?<op><=?)\s*(?<end>\d+)\s*;[^)]*\)/g;

// Usage:
const match = regex.exec(code);
const { var: varName, start, op, end } = match.groups!;
```

**Benefit:** If team adopts named groups, code becomes self-documenting.

**D. Create helper function for clarity:**
```typescript
function createForLoopRegex(): RegExp {
  // Matches for-loops with numeric bounds and optional type declaration
  // Example: for (int i = 0; i <= 10; i++)
  // Captures: varName, startValue, operator (<|<=), endValue
  
  const optionalType = String.raw`(?:(?:unsigned\s+int|uint8_t|unsigned|byte|int|var)\s+)?`;
  const varName = String.raw`([a-zA-Z_]\w*)`;
  const number = String.raw`(\d+)`;
  const operator = String.raw`(<=?)`;
  const loopBody = String.raw`[^)]*`;
  
  return new RegExp(
    String.raw`for\s*\(\s*${optionalType}${varName}\s*=\s*${number}\s*;` +
    String.raw`\s*\1\s*${operator}\s*${number}\s*;${loopBody}\)`,
    'g'
  );
}
```

**Benefit:** Improves readability while reducing regex cognitive load.

---

## 3. SUMMARY TABLE

| Issue | Location | Type | Current | Target | Reduction | Strategy |
|-------|----------|------|---------|--------|-----------|----------|
| `getLoopPinModeCalls()` | L494 | Method CC | 33 | 15 | -55% | Extract loop parsing, body extraction, pin mode extraction |
| `parseHardwareCompatibility()` | L565 | Method CC | 31 | 15 | -52% | Extract PWM check, digital IO check, pin mode vars, output pins |
| `analyzeLargeArraysAndRecursion()` | L226 | Method CC | 18 | 15 | -17% | Extract brace matching, recursion detection |
| `FOR_LOOP_HEADER` regex | L27 | Regex | 29 | 20 | -31% | Document with constants, use named groups, create helper |
| Negated conditions | L75, L87 | Code smell | 2 | 0 | -100% | Invert if conditions to positive logic |

---

## 4. IMPLEMENTATION ROADMAP

### Phase 1: Quick Wins (No dependencies)
- [ ] Refactor negated conditions (L75, L87)
- [ ] Extract `parsePinNumber()` improvements
- [ ] Document FOR_LOOP_HEADER regex (add comments)

### Phase 2: Medium extractions (Build helper methods)
- [ ] Extract `findFunctionEnd()` method
- [ ] Extract `isRecursive()` helper
- [ ] Extract `checkLargeArrays()` method
- [ ] Extract `getPwmPins()` constant → class property

### Phase 3: Major refactoring (Systemaic method decomposition)
- [ ] Extract loop parsing helpers from `getLoopPinModeCalls()`
- [ ] Extract hardware compatibility checks into focused methods
- [ ] Consolidate similar regex patterns

### Phase 4: Polish (Docs + tests)
- [ ] Add JSDoc to new methods
- [ ] Verify test coverage for extracted methods
- [ ] Update dependency documentation

---

## 5. TESTING STRATEGY

### For `getLoopPinModeCalls()` extraction:
- Test `parseForLoopHeader()` with various for-loop formats
- Test `extractLoopBody()` with braced and braceless bodies
- Test `extractPinModesFromBody()` with multiple pinMode calls
- Verify end-to-end behavior unchanged

### For `parseHardwareCompatibility()` extraction:
- Test `checkAnalogWritePWM()` with PWM and non-PWM pins
- Test `checkDigitalIOWithoutSetup()` with various scenarios
- Test `determineOutputPins()` combination of direct and loop-based
- Verify no regressions in existing tests

### For `analyzeLargeArraysAndRecursion()`:
- Test `findFunctionEnd()` with nested braces
- Test `isRecursive()` with self-referential functions
- Test `checkRecursion()` with various recursion patterns

---

## 6. NOTES

- All refactorings are **additive** (no removal of functionality)
- Tests should be run frequently during implementation
- Consider velocity impact: estimate 2–3 days for full implementation
- Prioritize based on: impact (CC reduction) + risk (test coverage)

