# ArduinoSimulatorPage Refactoring Analysis

**Current File Size:** 1510 lines  
**Goal:** Extract large code blocks into sub-components to improve maintainability

---

## 1. SIDEBAR / PIN MONITOR SECTION

**Lines:** ~150-160 scattered across file  
**Primary Location:** Lines 180-250 (state hooks), 950-1020 (handlers), 1460-1490 (JSX)

### Code Structure:
```
- usePinState hook initialization (40 lines)
  - pinStates, detectedPinModes, pendingPinConflicts
  - pinToNumber, resetPinUI state management
  
- Pin interaction handlers (80 lines)
  - handlePinToggle() - toggle digital pins
  - handleAnalogChange() - update analog slider values
  - handleReset() - reset all pins
  
- JSX Rendering (30 lines)
  - SimulatorSidebar component
  - ResizablePanel wrapper at lines 1460-1490
```

### State Dependencies:
- **From:** `useSimulationStore()` → `pinStates`, `setPinStates`, `batchStats`
- **From:** `usePinState()` → `analogPinsUsed`, `detectedPinModes`, `pendingPinConflicts`
- **Local:** `txActivity`, `rxActivity`, `pinMonitorVisible`

### Handler Functions:
- `handlePinToggle(pin, newValue)` - send `set_pin_value` WebSocket message
- `handleAnalogChange(pin, newValue)` - handle analog input (0-1023)
- `handleReset()` - reset pin states
- Toast notifications for inactive simulation

### Can Extract To: **`PinMonitorController` subcomponent**
- Accept: `simulationStatus`, `pinStates`, handlers
- Manage: Pin UI events, LED activity, analog/digital toggling
- **Estimated reduction:** 100-120 lines from main file

---

## 2. OUTPUT PANEL / STATUS BAR (BOTTOM PANEL)

**Lines:** ~240-280 scattered  
**Primary Location:** Lines 295-350 (useOutputPanel setup), 900-1000 (handlers), 1380-1440 (JSX)

### Code Structure:
```
- useOutputPanel hook (50 lines)
  - compilationPanelSize, outputPanelRef management
  - Auto-show/hide logic based on errors
  
- Output panel event handlers (90 lines)
  - handleOutputTabChange()
  - handleOutputCloseOrMinimize()
  - handleParserMessagesClear()
  - handleParserGoToLine()
  - handleInsertSuggestion()
  - handleRegistryClear()
  
- Debug message handlers (60 lines)
  - handleSetDebugMessageFilter()
  - handleSetDebugViewMode()
  - handleCopyDebugMessages()
  - handleClearDebugMessages()
  
- JSX Rendering (40 lines)
  - OutputPanel component with 20+ props
  - Tab switching logic
  - ResizablePanel wrapper
```

### State Dependencies:
- **From:** `useOutputPanel()` → sizing, visibility, panel refs
- **From:** `useDebugConsole()` → debug messages, filters, view modes
- **Local:** `activeOutputTab`, `showCompilationOutput`, `parserPanelDismissed`

### Data Dependencies:
- `compilationStatus`, `hasCompilationErrors`, `lastCompilationResult`
- `cliOutput`, `compilerErrors`
- `parserMessages`, `ioRegistry`
- `debugMessages`, `debugMessageFilter`, `debugViewMode`

### Handler Functions:
- **Compiler:** `handleClearCompilationOutput()` - clears compiler output
- **Parser:** `handleInsertSuggestion()`, `handleParserGoToLine()`, clear messages
- **Registry:** `handleRegistryClear()` - clears I/O registry view
- **Debug:** Messages filter, view mode toggle, copy, clear

### Can Extract To: **`OutputPanelController` subcomponent**
- Accept: compilation data, parser messages, debug messages, sizing props
- Manage: Tab switching, panel resizing, content rendering
- **Estimated reduction:** 180-220 lines from main file

---

## 3. SIMULATION CONTROLS / HEADER TOOLBAR

**Lines:** ~60-80  
**Location:** Lines 1280-1350

### Code Structure:
```
- SimulationControls component (70 lines of JSX)
  - 30+ event handler props
  - Control buttons (Compile, Start, Stop, Pause, Resume)
  - File management (Load, Download, Add, Rename)
  - Editor commands (Undo, Redo, Cut, Copy, Paste, Find, Format)
  - Settings, simulation timeout controls
```

### State Dependencies:
- `simulationStatus`, `compilationStatus`
- `baudRate`, `board`, `simulationTimeout`
- Various mutation pending states

### Handler Functions:
- `onCompile()`, `onCompileAndStart()`, `onSimulate()`
- `onStop()`, `onPause()`, `onResume()`
- `onFileAdd()`, `onFileRename()`, `onLoadFiles()`, `onDownloadAllFiles()`
- `onUndo()`, `onRedo()`, `onCut()`, `onCopy()`, `onPaste()`
- `onSelectAll()`, `onGoToLine()`, `onFind()`, `onFormatCode()`
- `onSettings()`, `onOutputPanelToggle()`

### Can Extract To: **Already largely extracted**
- Exists as separate `SimulationControls` component
- Could be further split into:
  - ControlButtons (control flow)
  - FileToolbar (file operations)
  - EditorToolbar (editor commands)
- **Estimated reduction:** 0 lines (already extracted)

---

## 4. SERIAL MONITOR / SERIAL IO

**Lines:** ~130-150  
**Location:** Lines 100-150 (useSerialIO), 210-230 (input handlers), 1015-1055 (send handlers), 1420-1450 (JSX)

### Code Structure:
```
- useSerialIO hook (80 lines)
  - serialOutput, renderedSerialOutput management
  - Baudrate rendering simulation
  - Auto-scroll, view modes (monitor/plotter)
  
- Serial input handlers (30 lines)
  - handleSerialInputKeyDown()
  - handleSerialInputSend()
  
- Serial send handlers (40 lines)
  - handleSerialSend() - with TX LED activity
  - handleClearSerialOutput()
  
- JSX Rendering (25 lines)
  - SerialMonitorView component
  - ResizablePanel wrapper
```

### State Dependencies:
- **From:** `useSerialIO()` → serialOutput, renderedSerialOutput, serial state management
- **Local:** `serialInputValue`, `setSerialInputValue` (managed by hook)

### Handler Functions:
- `handleSerialInputSend()` - send input when Enter pressed
- `handleSerialInputKeyDown()` - keyboard event handler
- `handleSerialSend(message)` - send to WebSocket, trigger TX LED
- `handleClearSerialOutput()` - reset serial output

### Data Dependencies:
- `isConnected` (WebSocket status)
- `simulationStatus`
- `baudRate`

### Can Extract To: **`SerialIOController` subcomponent**
- Accept: serial state, isConnected, simulationStatus
- Manage: Input handling, message sending, LED activity
- **Estimated reduction:** 80-100 lines from main file

---

## 5. KEYBOARD SHORTCUTS & GLOBAL EVENT HANDLERS

**Lines:** ~110-140  
**Location:** Lines 220-260 (debug toggle), 500-575 (editor shortcuts)

### Code Structure:
```
- Debug mode toggle (40 lines)
  - Ctrl+D / Cmd+D keyboard listener
  - localStorage sync with global store
  - Custom event dispatch
  
- Editor shortcuts (70 lines)
  - F5: Compile only
  - Escape: Stop simulation
  - Ctrl/Cmd+U: Compile & Start
  - Input element detection (ignores keystrokes in editors)
```

### State Dependencies:
- `debugMode`, `setDebugMode` (global store)
- `simulationStatus`, `compilationStatus`
- `compileMutation.isPending`, `startMutation.isPending`

### Handler Functions:
- Global keyboard event listeners
- Focus/blur detection for input elements

### Can Extract To: **`useGlobalKeyboardShortcuts` hook**
- Encapsulate all keyboard listeners
- Provide configuration-driven shortcut binding
- **Estimated reduction:** 90-110 lines from main file

---

## 6. CODE EDITOR & TAB MANAGEMENT

**Lines:** ~250-280  
**Location:** Lines 750-900 (handlers), 1100-1180 (JSX code slot)

### Code Structure:
```
- Code change handler (20 lines)
  - handleCodeChange()
  - Sync with active tab
  
- Tab management handlers (140 lines)
  - handleTabClick() - switch tabs
  - handleTabAdd() - create new header file
  - handleTabClose() - remove tab (protect main .ino)
  - handleTabRename() - rename file
  
- File loading handlers (80 lines)
  - handleFilesLoaded() - load .ino/.h files
  - handleLoadExample() - load from examples
  
- File manager integration (30 lines)
  - useFileManager hook
  - Download/upload UI
  
- JSX Rendering (50 lines)
  - codeSlot memoized component
  - SketchTabs + CodeEditor
```

### State Dependencies:
- **From:** `useFileSystem()` → code, tabs, activeTabId, isModified
- Compilation/simulation status
- Serial output (cleared on load)

### Handler Functions:
- `handleTabClick(tabId)` - set active, restore code
- `handleTabAdd()` - add new .h file
- `handleTabClose(tabId)` - remove with validation
- `handleTabRename(tabId, newName)` - update tab name
- `handleFilesLoaded(files, replaceAll)` - load .ino/.h files
- `handleLoadExample(filename, content)` - load example sketch
- `handleCodeChange(newCode)` - sync editor → state

### Can Extract To: **`CodeEditorController` subcomponent**
- Accept: code, tabs, simulation/compilation state
- Manage: Tab switching, file operations, code changes
- **Estimated reduction:** 150-180 lines from main file

---

## 7. PIN STATE EFFECTS & LOGIC

**Lines:** ~200-220  
**Location:** Lines 630-750 (useEffect hooks scattered)

### Code Structure:
```
- Sketch analysis effect (30 lines)
  - useSketchAnalysis hook integration
  - Mirror detected pins to local state
  
- Pin mode application effect (50 lines)
  - When simulation starts, apply pinMode declarations
  - Detect analog pins from code analysis
  
- Pin state update effect (40 lines)
  - Override pin modes from io_registry
  - Ensure detected pins are present
  
- Serial output flush effect (20 lines)
  - Flush incomplete lines when simulation stops
  
- I/O Registry static parsing (20 lines)
  - Parse code for I/O when simulation not running
  
- Code change detection (10 lines)
  - Reset compilation status when code changes
```

### State Dependencies:
- `simulationStatus`, `code`, `tabs`
- `detectedPinModes`, `analogPinsUsed`, `pendingPinConflicts`
- `pinStates`, `serialOutput`
- `ioRegistry`

### Can Extract To: **`usePinStateEffects` hook**
- Consolidate all pin-related useEffect hooks
- Manage pin detection, mode application, registry updates
- **Estimated reduction:** 60-80 lines from main file (as more compact hook)

---

## 8. WEBSOCKET & BACKEND HEALTH

**Lines:** ~100-120  
**Location:** Lines 250-350 (hook initialization and setup)

### Current Structure:
```
- useWebSocket hook
- useBackendHealth hook  
- useWebSocketHandler hook
- Message sending wrapper
- Query client initialization
```

### Already Reasonably Separated
- Heavy lifting in custom hooks
- Main component only does initialization
- **No extraction needed**

---

## REFACTORING ROADMAP

### Phase 1: Low-Risk Extractions (150-200 lines reduction)
1. **Extract `usePinStateEffects` hook**
   - Consolidate 6 pin-related useEffect hooks
   - 60-80 line reduction
   - No JSX changes needed

2. **Extract `useGlobalKeyboardShortcuts` hook**
   - Move keyboard listeners
   - 90-110 line reduction
   - Configuration-driven approach

### Phase 2: Component Extractions (300-400 lines reduction)
1. **PinMonitorController** subcomponent
   - Sidebar + pin interaction logic
   - 100-120 line reduction
   - New file: `components/simulator/subcomponents/PinMonitorController.tsx`

2. **SerialIOController** subcomponent
   - Serial monitor + input handling
   - 80-100 line reduction
   - New file: `components/simulator/subcomponents/SerialIOController.tsx`

3. **CodeEditorController** subcomponent
   - Tab management + file operations
   - 150-180 line reduction
   - New file: `components/simulator/subcomponents/CodeEditorController.tsx`

### Phase 3: Panel Extractions (200-250 lines reduction)
1. **OutputPanelController** subcomponent
   - Bottom panel with tabs (compiler/parser/debug/registry)
   - 180-220 line reduction
   - New file: `components/simulator/subcomponents/OutputPanelController.tsx`

---

## Estimated Results

| Extraction | Lines Removed | Target File |
|---|---|---|
| Pin state effects hook | 60-80 | Main → Hook |
| Keyboard shortcuts hook | 90-110 | Main → Hook |
| PinMonitorController | 100-120 | Main → Subcomponent |
| SerialIOController | 80-100 | Main → Subcomponent |
| CodeEditorController | 150-180 | Main → Subcomponent |
| OutputPanelController | 180-220 | Main → Subcomponent |
| **TOTAL REDUCTION** | **660-810** | → 700-850 lines |

**Final Expected Size:** ~700-850 lines (55-57% size reduction)

---

## Dependencies Summary

### Top State Dependencies:
1. `simulationStatus` - used in 15+ handlers
2. `pinStates, setPinStates` - used in pin handlers + effects  
3. `code, setCode` - used in editor handlers + effects
4. `tabs, setTabs, activeTabId` - used in tab handlers
5. `compilationStatus`, `hasCompilationErrors` - status tracking
6. `serialOutput` - serial monitoring
7. `debugMode`, `debugMessages` - debug panel

### Top Prop Passing (for controller components):
- PinMonitor: simulationStatus, pinStates, handlers (4 props × 3-4 callbacks)
- SerialIO: serialOutput, isConnected, sendMessage (3 props × 2-3 callbacks)
- OutputPanel: compilation data, parser data, debug data (8+ props)
- CodeEditor: code, tabs, handlers, examples (6+ props × 4-5 callbacks)

---

## Notes for Implementation

- **Context vs Props:** Consider context for deeply nested state (debug mode, serial state)
- **Custom Hooks:** Pin effects and keyboard shortcuts should be hooks, not components
- **Memoization:** Existing memoized slots (codeSlot, compileSlot) should be preserved
- **Mobile Layout:** Ensure MobileLayout component receives correct props after extractions
- **ResizablePanels:** Panel refs and sizing logic stays in parent for coordination
- **Testing:** Each extracted component should have isolated unit tests
