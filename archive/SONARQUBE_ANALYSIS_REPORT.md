# SonarQube Analyse Report - UnoWebSim Projekt
**Generiert:** 23. März 2026  
**Projekt:** UnoWebSim (unowebsim)  
**Status:** 🔴 **QUALITY GATE: ERROR**

---

## 📊 Zusammenfassung der Projekt-Metriken

| Metrik | Wert | Status |
|--------|------|--------|
| **Lines of Code (NCLOC)** | 24.086 | ✅ |
| **Gesamtprobleme (Violations)** | 250 | ❌ |
| **Bugs** | 19 | 🟡 |
| **Code Smells** | 231 | ⚠️ Hoch |
| **Vulnerabilities** | 0 | ✅ |
| **Coverage** | 0.0% | ❌ Keine Tests |
| **Duplicated Lines** | 5.3% | 🟡 |
| **Technical Debt** | 1.485 Stunden | ⚠️ Erheblich |

---

## 🚨 Quality Gate Status: ERROR

Das Projekt erfüllt die Quality Gate Bedingungen **NICHT**:

### Fehlgeschlagene Bedingungen:

1. **Coverage (Neu Code)**: 💔 `0.0%` (Schwellenwert: `80%`)
   - Kein Test-Coverage für neuen Code vorhanden
   
2. **Duplicated Lines Density (Neu Code)**: 📋 `4.87%` (Schwellenwert: `3%`)
   - Zu viele duplizierte Zeilen im neuen Code
   
3. **New Violations**: ⚠️ `10 Probleme` (Schwellenwert: `0`)
   - 10 neue Verletzungen gefunden

---

## 🔴 Kritische Probleme (CRITICAL - HIGH)

### Insgesamt: **34 kritische/hohe Probleme** (Seite 1 von 4)

#### Top 10 gefundene Probleme:

1. **S3776: Cognitive Complexity zu hoch**
   - 📄 [client/src/components/features/arduino-board.tsx](client/src/components/features/arduino-board.tsx#L450)
   - Severity: **CRITICAL** | Status: OPEN
   - Komplexität: **28** (erlaubt: 15)
   - Refactoring erforderlich

2. **S3776: Cognitive Complexity zu hoch**
   - 📄 [shared/code-parser.ts](shared/code-parser.ts#L197)
   - Severity: **CRITICAL** | Status: OPEN
   - Komplexität: **22** (erlaubt: 15)
   - Refactoring erforderlich

3. **S2004: Zu tiefe Funktionsverschachtelung**
   - 📄 [client/src/hooks/useWebSocketHandler.ts](client/src/hooks/useWebSocketHandler.ts#L337)
   - Severity: **CRITICAL** | Status: OPEN
   - Nesting-Tiefe: **> 4 Level**
   - Funktion aufteilen erforderlich

4. **S3776: Cognitive Complexity zu hoch** (CLOSED)
   - 📄 [client/src/components/features/app-header.tsx](client/src/components/features/app-header.tsx#L110)
   - Severity: **CRITICAL** | Status: CLOSED ✅
   - Komplexität: **63** (erlaubt: 15)

5. **S3776: Cognitive Complexity zu hoch**
   - 📄 [client/src/hooks/useSimulatorKeyboardShortcuts.ts](client/src/hooks/useSimulatorKeyboardShortcuts.ts#L67)
   - Severity: **CRITICAL** | Status: OPEN
   - Komplexität: **17** (erlaubt: 15)

6-10. **Multiple S3776-Verletzungen in [usePinPollingEngine.ts](client/src/hooks/usePinPollingEngine.ts)**
   - Komplexitäten: 32, 41, 17, 46 (alle > 15)
   - Status: Alle OPEN

---

## 🔐 Security Hotspots: 31 zu überprüfen

### Priority A - HIGH Vulnerabilität:

1. **S2068: Hardcodiertes Passwort erkannt**
   - 📄 [shared/logger.ts](shared/logger.ts#L119)
   - Zeilen 119-120
   - Status: **TO_REVIEW**
   - Wahrscheinlichkeit: **HIGH**

2. **S2068: Hardcodiertes Passwort erkannt**
   - 📄 [shared/logger.ts](shared/logger.ts#L120)
   - Status: **TO_REVIEW**
   - Wahrscheinlichkeit: **HIGH**

### Priority B - MEDIUM Vulnerabilität (Regex DoS):

**8 RegEx Backtracking Probleme** (S5852) gefunden:
- [client/src/components/features/code-editor.tsx](client/src/components/features/code-editor.tsx#L18) (L18, L104)
- [client/src/hooks/use-sketch-analysis.ts](client/src/hooks/use-sketch-analysis.ts#L31) (L31, L34)
- [server/services/arduino-compiler.ts](server/services/arduino-compiler.ts#L782)
- [server/services/arduino-output-parser.ts](server/services/arduino-output-parser.ts#L40)
- [server/services/arduino-output-parser.ts](server/services/arduino-output-parser.ts#L214)
- [server/services/compiler/compiler-output-parser.ts](server/services/compiler/compiler-output-parser.ts#L36)

**Alle mit Status: TO_REVIEW**

---

## 📋 Code-Duplikationen: 5.3% Overall Density

### Kritische Duplikationen (>80%):

1. **[client/src/hooks/useArduinoSimulatorPageImplCore.tsx](client/src/hooks/useArduinoSimulatorPageImplCore.tsx)**
   - Duplicated Lines: **674** (81.0% des Dateinhinhalts)
   - Duplicated Blocks: 8
   - **Sehr hohes Refactoring-Potenzial**

2. **[client/src/hooks/useArduinoSimulatorPage.tsx](client/src/hooks/useArduinoSimulatorPage.tsx)**
   - Duplicated Lines: **620** (86.4% des Dateiinhalts)
   - Duplicated Blocks: 5
   - **Sehr hohes Refactoring-Potenzial**

### Hohe Duplikationen (>20%):

3. **[client/src/components/simulator/ArduinoSimulatorPageLayout.tsx](client/src/components/simulator/ArduinoSimulatorPageLayout.tsx)**
   - Duplicated Lines: 65 (20.5%)
   - Duplicated Blocks: 1

4. **[client/src/components/simulator/SimulationControls.tsx](client/src/components/simulator/SimulationControls.tsx)**
   - Duplicated Lines: 36 (76.6%)
   - Duplicated Blocks: 2

### Weitere Duplikationen (5-15%):

- [client/src/components/features/output-panel.tsx](client/src/components/features/output-panel.tsx): 11.4%
- [client/src/components/features/app-header.tsx](client/src/components/features/app-header.tsx): 7.6%
- [client/src/hooks/use-compile-and-run.ts](client/src/hooks/use-compile-and-run.ts): 10.3%
- [client/src/hooks/useSimulatorKeyboardShortcuts.ts](client/src/hooks/useSimulatorKeyboardShortcuts.ts): 14.4%
- [client/src/hooks/use-simulation-controls.ts](client/src/hooks/use-simulation-controls.ts): 10.2%
- [client/src/hooks/useSimulatorEffects.ts](client/src/hooks/useSimulatorEffects.ts): 4.9%
- [client/src/hooks/useSimulatorPinControls.ts](client/src/hooks/useSimulatorPinControls.ts): 22.9%

**Gesamt-Statistik:**
- Gesamt duplizierte Zeilen: 1.632
- Gesamt duplizierte Blöcke: 30

---

## 📈 Test-Coverage: KRITISCH

**Coverage: 0.0%** 

📍 **Status:** Keine Tests vorhanden oder Tests generieren keine Coverage-Berichte.

**Empfehlung:** 
- Stelle sicher, dass vitest/jest mit Coverage konfiguriert ist
- Überprüfe `vitest.config.ts` für Coverage-Settings
- Führe Tests mit Coverage aus: `npm run test:coverage`

---

## 🎯 Prioritäre Maßnahmen

### 1️⃣ SOFORT (Diese Woche)
- [ ] **Hardcodierte Passwörter in logger.ts entfernen** (S2068)
  - Sicherheitsrisiko: HIGH
  - Dateien: `shared/logger.ts` Zeilen 119-120

### 2️⃣ SEHR WICHTIG (Diese Woche/Nächste Woche)
- [ ] **Cognitive Complexity reduzieren**
  - `usePinPollingEngine.ts`: 4 Funktionen mit CC 17-46 (erlaubt: 15)
  - `arduino-board.tsx`: CC 28 (erlaubt: 15)
  - `code-parser.ts`: CC 22 (erlaubt: 15)
  - `useWebSocketHandler.ts`: Nesting-Tiefe > 4
  
- [ ] **RegEx DoS-Anfälligkeit beheben** (S5852)
  - 8 problematische Regex-Muster in verschiedenen Dateien
  - Verursachen potenzielle Denial-of-Service-Anfälligkeit

### 3️⃣ WICHTIG (Diese/Nächste Woche)
- [ ] **Code-Duplikationen reduzieren**
  - Priorität: `useArduinoSimulatorPageImplCore.tsx` (81% dupliziert)
  - Priorität: `useArduinoSimulatorPage.tsx` (86.4% dupliziert)
  - Potenzial: ~40% Code-Reduktion durch Refactoring

- [ ] **Test-Coverage aufbauen**
  - Aktuell: 0%
  - Ziel: Mindestens 80% (Quality Gate Requirement)
  - Schreibe Unit-Tests für kritische Funktionen

### 4️⃣ MITTELFRISTIG (Nächste 2-4 Wochen)
- [ ] **Code Smells adressieren** (231 Violations)
- [ ] **19 Bugs beheben**
- [ ] **Technical Debt reduzieren** (1.485 Stunden)

---

## 📝 Detaillierte Statistiken nach Severity

### Issues nach Severity:
- **CRITICAL:** 11 Probleme 🔴
- **HIGH:** 23 Probleme 🟠
- **MEDIUM:** 134 Probleme 🟡
- **LOW:** 82 Probleme 🔵

### Bugs nach Komponente:
- Server: Arduino Compiler & Parser
- Client: Simulator Hooks (usePinPollingEngine.ts)
- Shared: Code Parser

---

## 📊 Trend-Analyse

```
Quality Gate Status: ERROR ❌
├─ Coverage: 0.0% (Required: 80%) ❌
├─ New Duplications: 4.87% (Allowed: 3%) ❌
└─ New Violations: 10 (Allowed: 0) ❌

Violations Summary:
├─ Bugs: 19
├─ Code Smells: 231
├─ Vulnerabilities: 0
└─ Total: 250

Hotspots (Security):
├─ HIGH: 2 (hardcoded passwords)
└─ MEDIUM: 29 (regex DoS)
```

---

## 🔧 nächste Schritte

1. **Automatisierte Linting überprüfen:**
   - `npm run check` (ESLint/TypeScript)
   - `npm run test:fast` (Tests)

2. **SonarQube Analysis lokal durchführen:**
   - `sonar-scanner` (falls installiert)

3. **Issues in Batches beheben:**
   - Phase 1: Security Hotspots (hardcoded credentials)
   - Phase 2: Cognitive Complexity (Refactoring)
   - Phase 3: Test Coverage (Unit Tests schreiben)
   - Phase 4: Duplikation (Code-Sharing)

4. **Quality Gate wieder grün bekommen:**
   - Coverage: 80%+ für neuen Code
   - Keine neuen Violations
   - Duplicated Lines < 3%

---

## 📞 Kontakt für Fragen

Bitte kontaktiere den entwickler für:
- Fragen zur Security (hardcoded passwords)
- Fragen zum Cognitive Complexity Refactoring
- Fragen zur Test-Strategie

---

**Report generiert vom SonarQube MCP Server**  
**Projekt:** UnoWebSim (unowebsim)  
**Datum:** 2026-03-23
