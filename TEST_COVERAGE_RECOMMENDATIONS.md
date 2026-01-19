# Test Coverage Empfehlungen

## Aktuelle Situation

**E2E Tests (Playwright):**
- ✅ 6 Tests für Arduino Board Pin Frame Rendering
- ✅ Funktionieren perfekt im echten Browser
- ❌ Sammeln KEINE Coverage-Daten (separate Tool-Chain)

**Unit Tests (Jest):**
- ✅ 22 Test Suites passing
- ✅ 186 Tests passing
- ✅ ~82% Statement Coverage (486/591)
- ❌ Client-Komponenten haben niedrige Coverage

## Antworten auf deine Fragen

### 1. Werden E2E Tests mit `npm run test:coverage` ausgeführt?

**Nein.** `npm run test:coverage` führt nur Jest-Tests aus.

E2E Tests KÖNNEN theoretisch Coverage sammeln, aber:
- Erfordert Code-Instrumentierung (babel-plugin-istanbul)
- Playwright und Jest Coverage müssen zusammengeführt werden
- Sehr komplex und langsam
- **Nicht empfohlen** für dieses Projekt

**Empfehlung:** E2E und Unit Tests getrennt halten:
- `npm run test:coverage` → Unit Tests (Jest)
- `npm run test:e2e` → E2E Tests (Playwright)

### 2. Welche Tests sollten ergänzt werden?

#### Komponenten mit fehlender Coverage:

**Hohe Priorität:**
1. **code-editor.tsx** - Monaco Editor Wrapper
   - Problem: Schwierig zu mocken (Monaco API)
   - Lösung: Integration Tests oder Mock monaco-editor

2. **arduino-board.tsx** - SVG Board Visualisierung
   - Problem: Polling + useEffect → Infinite Loops in Jest
   - Lösung: ✅ **Bereits durch E2E Tests abgedeckt**

3. **serial-plotter.tsx** - Recharts-basierter Plotter
   - Problem: Komplexe Chart-Library
   - Lösung: Snapshots oder visuelles Regression Testing

**Mittlere Priorität:**
4. **examples-menu.tsx** - Dropdown mit Beispielen
5. **sketch-tabs.tsx** - Tab-Verwaltung
6. **settings-dialog.tsx** - Einstellungen Dialog

**Niedrige Priorität:**
7. **secret-dialog.tsx** - Wenig Logik
8. Hooks: useWebSocket, useLocalStorage

#### Bereits hinzugefügt:
✅ **compilation-output.test.tsx** - 5 Tests für Output-Anzeige

## Empfohlene nächste Schritte

### Option A: Pragmatischer Ansatz (Empfohlen)
```bash
# Fokus auf testbare Business Logic
npm run test:coverage   # Unit Tests für Backend/Logic
npm run test:e2e        # E2E Tests für UI-kritische Features
```

**Vorteile:**
- E2E Tests decken kritische UI-Flows ab (Pin Rendering)
- Unit Tests fokussieren auf Backend/Parser/Compiler
- Keine Mock-Hölle für komplexe UI-Komponenten

### Option B: Hohe Coverage-Zahlen
Weitere Unit Tests für:
- examples-menu (mit fetch-Mocks)
- sketch-tabs (mit Query Client)
- settings-dialog (Form-Testing)

**Nachteil:** Viel Aufwand für Mock-Setup bei geringem Mehrwert

## Coverage-Optimierung

### Bereits gut abgedeckt:
- ✅ Server/Backend (~90%+)
- ✅ Shared/Parser (~85%+)
- ✅ Arduino Compiler Tests
- ✅ WebSocket Tests
- ✅ Integration Tests

### Schwer testbar (akzeptabel niedrige Coverage):
- Monaco Editor (externe Library)
- Arduino Board (E2E-tested)
- Serial Plotter (Chart-Library)

## Fazit

**E2E + Unit Tests getrennt halten** ist die beste Strategie:

1. **Unit Tests (Jest):** Backend, Parser, Utils, einfache Components
2. **E2E Tests (Playwright):** Kritische User-Flows, UI-Interaktion
3. **Coverage-Ziel:** ~80% für testbare Units (bereits erreicht!)

Die wichtigsten Features (Pin Rendering) sind durch E2E Tests abgesichert. Weitere UI-Unit-Tests hätten diminishing returns.
