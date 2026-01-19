# UnoSim - Aufgabenliste für Agenten

Diese Aufgabenliste ist speziell für **einfachere AI-Agenten** konzipiert. Jede Aufgabe enthält klare, schrittweise Anweisungen, Dateipfade und erwartete Ergebnisse.

**Projekt-Überblick:** UnoSim ist ein webbasierter Arduino-Simulator mit Monaco-Editor, WebSocket-Kommunikation und Docker-Sandbox-Execution.

**Aktuelle Test-Coverage:** 81.88% Statements | 61.59% Branches | 79.16% Functions

---

## 📊 PERFORMANCE-OPTIMIERUNGEN

### PERF-001: Recharts Lazy Loading überprüfen
**Priorität:** Niedrig  
**Geschätzte Zeit:** 15 Minuten  
**Datei:** [client/src/pages/arduino-simulator.tsx](client/src/pages/arduino-simulator.tsx)

**Status:** ✅ Bereits implementiert (Zeile 41-42)

**Prüfaufgabe:**
```typescript
// Überprüfe, dass folgende Zeile existiert:
const SerialPlotter = lazy(() => import('@/components/features/serial-plotter').then(m => ({ default: m.SerialPlotter })));
```
Das Lazy Loading für SerialPlotter ist bereits implementiert.

---

### PERF-002: Monaco Editor Bundle-Size analysieren
**Priorität:** Mittel  
**Geschätzte Zeit:** 2-3 Stunden  
**Datei:** [client/src/components/features/code-editor.tsx](client/src/components/features/code-editor.tsx)

**Problem:** Monaco Editor ist ~4MB groß und wird beim ersten Load komplett geladen.

**Aufgabe:**
1. Analysiere die aktuelle Monaco-Integration in `code-editor.tsx`
2. Prüfe ob `@monaco-editor/react` bereits genutzt wird (besseres Code-Splitting)
3. Falls nicht, evaluiere Migration mit:
   ```bash
   npm install @monaco-editor/react
   ```
4. Alternativ: Implementiere Lazy Loading für Monaco mit `React.lazy()`

**Erwartetes Ergebnis:** Reduzierte Initial-Ladezeit durch verzögertes Laden des Editors.

---

### PERF-003: WebSocket-Nachrichtenvolumen reduzieren
**Priorität:** Mittel  
**Geschätzte Zeit:** 1-2 Stunden  
**Dateien:** 
- [server/services/sandbox-runner.ts](server/services/sandbox-runner.ts)
- [server/routes.ts](server/routes.ts)

**Problem:** Bei schnellen Serial-Ausgaben werden viele einzelne WebSocket-Nachrichten gesendet.

**Aufgabe:**
1. Analysiere die Funktion `flushPendingSerialEvents()` in `sandbox-runner.ts` (Zeile 65-85)
2. Prüfe das aktuelle Batching-Verhalten
3. Optimiere die Batch-Größe und Flush-Intervalle
4. Führe den Load-Test aus: `npm test -- tests/server/load-test-50-clients.test.ts`

**Erwartetes Ergebnis:** Weniger WebSocket-Nachrichten bei gleichbleibender Funktionalität.

---

## 🧪 ERGÄNZENDE TESTS

### TEST-001: CodeParser - parsePerformance() Tests erweitern
**Priorität:** Hoch  
**Geschätzte Zeit:** 45 Minuten  
**Zieldatei:** [tests/server/services/code-parser.test.ts](tests/server/services/code-parser.test.ts)

**Was getestet werden soll:** Die Funktion `parsePerformance()` in [shared/code-parser.ts](shared/code-parser.ts#L450-L510)

**Aktuell abgedeckt:** Grundfunktionalität
**Fehlend:** Edge Cases

**Neue Tests hinzufügen:**
```typescript
describe('parsePerformance', () => {
  it('should detect while(true) inside a function', () => {
    const code = `
      void setup() {}
      void loop() {}
      void myFunc() {
        while(true) { delay(10); }
      }
    `;
    const messages = parser.parsePerformance(code);
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'warning',
        category: 'performance',
        message: expect.stringContaining('while(true)')
      })
    );
  });

  it('should detect for loop without condition: for(;;)', () => {
    const code = `
      void setup() {}
      void loop() {
        for(int i=0; ; i++) { 
          Serial.println(i);
        }
      }
    `;
    const messages = parser.parsePerformance(code);
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'warning',
        category: 'performance',
        message: expect.stringContaining('infinite loop')
      })
    );
  });

  it('should detect arrays larger than 1000 elements', () => {
    const code = `
      int bigArray[5000];
      void setup() {}
      void loop() {}
    `;
    const messages = parser.parsePerformance(code);
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'warning',
        category: 'performance',
        message: expect.stringContaining('5000')
      })
    );
  });

  it('should NOT warn for reasonably sized arrays', () => {
    const code = `
      int smallArray[100];
      void setup() {}
      void loop() {}
    `;
    const messages = parser.parsePerformance(code);
    const arrayWarnings = messages.filter(m => m.message.includes('array'));
    expect(arrayWarnings).toHaveLength(0);
  });

  it('should detect recursive function calls', () => {
    const code = `
      void setup() {}
      void loop() {}
      int factorial(int n) {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
      }
    `;
    const messages = parser.parsePerformance(code);
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'warning',
        category: 'performance',
        message: expect.stringContaining('ecursive')
      })
    );
  });
});
```

**Test ausführen:**
```bash
npm test -- tests/server/services/code-parser.test.ts
```

---

### TEST-002: CodeParser - parsePinConflicts() Tests erweitern
**Priorität:** Hoch  
**Geschätzte Zeit:** 30 Minuten  
**Zieldatei:** [tests/server/services/code-parser.test.ts](tests/server/services/code-parser.test.ts)

**Was getestet werden soll:** Die Funktion `parsePinConflicts()` in [shared/code-parser.ts](shared/code-parser.ts#L400-L446)

**Neue Tests hinzufügen:**
```typescript
describe('parsePinConflicts', () => {
  it('should detect digital and analog use on same pin', () => {
    const code = `
      void setup() {
        pinMode(A0, OUTPUT);
      }
      void loop() {
        digitalWrite(A0, HIGH);
        int val = analogRead(A0);
      }
    `;
    const messages = parser.parsePinConflicts(code);
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: 'warning',
        category: 'hardware',
        message: expect.stringContaining('digital')
      })
    );
  });

  it('should NOT warn when digital and analog pins are separate', () => {
    const code = `
      void setup() {
        pinMode(13, OUTPUT);
      }
      void loop() {
        digitalWrite(13, HIGH);
        int val = analogRead(A0);
      }
    `;
    const messages = parser.parsePinConflicts(code);
    expect(messages).toHaveLength(0);
  });

  it('should detect conflict with numeric pin notation', () => {
    const code = `
      void setup() {
        pinMode(14, OUTPUT);  // A0 = 14
      }
      void loop() {
        digitalWrite(14, HIGH);
        analogRead(14);
      }
    `;
    const messages = parser.parsePinConflicts(code);
    expect(messages.length).toBeGreaterThan(0);
  });
});
```

---

### TEST-003: Logger-Tests für Browser-Kontext erweitern
**Priorität:** Mittel  
**Geschätzte Zeit:** 30 Minuten  
**Zieldatei:** [tests/shared/logger.test.ts](tests/shared/logger.test.ts)

**Was getestet werden soll:** Browser-spezifisches Verhalten in [shared/logger.ts](shared/logger.ts)

**Neue Tests hinzufügen:**
```typescript
describe('Logger - Browser Environment', () => {
  const originalWindow = global.window;
  const originalProcess = global.process;

  beforeEach(() => {
    // Simulate browser environment
    (global as any).window = {};
    (global as any).process = { env: {} };
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    (global as any).window = originalWindow;
    (global as any).process = originalProcess;
    jest.restoreAllMocks();
  });

  it('should suppress DEBUG logs in browser production mode', () => {
    (global as any).process.env.NODE_ENV = 'production';
    const logger = new Logger('TestBrowser');
    
    logger.debug('This should not appear');
    
    expect(console.log).not.toHaveBeenCalled();
  });

  it('should allow DEBUG logs in browser development mode', () => {
    (global as any).process.env.NODE_ENV = 'development';
    const logger = new Logger('TestBrowser');
    
    logger.debug('This should appear');
    
    expect(console.log).toHaveBeenCalled();
  });

  it('should always allow INFO/WARN/ERROR in browser', () => {
    (global as any).process.env.NODE_ENV = 'production';
    const logger = new Logger('TestBrowser');
    
    logger.info('Info message');
    logger.warn('Warn message');
    logger.error('Error message');
    
    expect(console.log).toHaveBeenCalledTimes(3);
  });
});
```

---

### TEST-004: ArduinoCompiler - Header-Einbettung testen
**Priorität:** Hoch  
**Geschätzte Zeit:** 45 Minuten  
**Zieldatei:** [tests/server/services/arduino-compiler.test.ts](tests/server/services/arduino-compiler.test.ts)

**Was getestet werden soll:** Header-Datei-Verarbeitung in [server/services/arduino-compiler.ts](server/services/arduino-compiler.ts#L80-L120)

**Neue Tests hinzufügen:**
```typescript
describe('Header File Processing', () => {
  it('should embed single header file into code', async () => {
    const code = `
      #include "myHeader.h"
      void setup() { Serial.begin(115200); }
      void loop() {}
    `;
    const headers = [{ name: 'myHeader.h', content: '#define MY_CONST 42' }];

    // Mock successful compilation
    (spawn as jest.Mock).mockImplementationOnce(() => ({
      stdout: {
        on: (event: string, cb: Function) => {
          if (event === 'data') cb(Buffer.from('Success'));
        }
      },
      stderr: { on: jest.fn() },
      on: (event: string, cb: Function) => {
        if (event === 'close') cb(0);
      }
    }));

    const result = await compiler.compile(code, headers);
    
    expect(result.processedCode).toContain('#define MY_CONST 42');
    expect(result.processedCode).toContain('--- Start of myHeader.h ---');
    expect(result.processedCode).not.toContain('#include "myHeader.h"');
  });

  it('should handle multiple header files', async () => {
    const code = `
      #include "header1.h"
      #include "header2.h"
      void setup() {}
      void loop() {}
    `;
    const headers = [
      { name: 'header1.h', content: 'int x = 1;' },
      { name: 'header2.h', content: 'int y = 2;' }
    ];

    (spawn as jest.Mock).mockImplementationOnce(() => ({
      stdout: { on: (e: string, cb: Function) => { if (e === 'data') cb(Buffer.from('OK')); } },
      stderr: { on: jest.fn() },
      on: (e: string, cb: Function) => { if (e === 'close') cb(0); }
    }));

    const result = await compiler.compile(code, headers);
    
    expect(result.processedCode).toContain('int x = 1;');
    expect(result.processedCode).toContain('int y = 2;');
  });

  it('should handle include without .h extension', async () => {
    const code = `
      #include "helper"
      void setup() {}
      void loop() {}
    `;
    const headers = [{ name: 'helper.h', content: 'void helperFunc() {}' }];

    (spawn as jest.Mock).mockImplementationOnce(() => ({
      stdout: { on: (e: string, cb: Function) => { if (e === 'data') cb(Buffer.from('OK')); } },
      stderr: { on: jest.fn() },
      on: (e: string, cb: Function) => { if (e === 'close') cb(0); }
    }));

    const result = await compiler.compile(code, headers);
    
    // The current implementation should handle this case
    expect(result.success).toBe(true);
  });
});
```

---

### TEST-005: WebSocket-Integration Tests erweitern
**Priorität:** Hoch  
**Geschätzte Zeit:** 1 Stunde  
**Zieldatei:** Neue Datei: `tests/server/websocket-messages.test.ts`

**Was getestet werden soll:** WebSocket-Nachrichtenformat in [server/routes.ts](server/routes.ts)

**Neue Testdatei erstellen:**
```typescript
import { wsMessageSchema } from '@shared/schema';

describe('WebSocket Message Schema Validation', () => {
  describe('wsMessageSchema', () => {
    it('should validate compile message', () => {
      const message = {
        type: 'compile',
        code: 'void setup() {} void loop() {}'
      };
      expect(() => wsMessageSchema.parse(message)).not.toThrow();
    });

    it('should validate run message', () => {
      const message = {
        type: 'run',
        code: 'void setup() {} void loop() {}'
      };
      expect(() => wsMessageSchema.parse(message)).not.toThrow();
    });

    it('should validate stop message', () => {
      const message = { type: 'stop' };
      expect(() => wsMessageSchema.parse(message)).not.toThrow();
    });

    it('should validate reset message', () => {
      const message = { type: 'reset' };
      expect(() => wsMessageSchema.parse(message)).not.toThrow();
    });

    it('should validate pin_input message', () => {
      const message = {
        type: 'pin_input',
        pin: 5,
        value: 127
      };
      expect(() => wsMessageSchema.parse(message)).not.toThrow();
    });

    it('should reject invalid message type', () => {
      const message = { type: 'invalid_type' };
      expect(() => wsMessageSchema.parse(message)).toThrow();
    });

    it('should reject compile message without code', () => {
      const message = { type: 'compile' };
      expect(() => wsMessageSchema.parse(message)).toThrow();
    });

    it('should validate message with headers', () => {
      const message = {
        type: 'compile',
        code: 'void setup() {} void loop() {}',
        headers: [{ name: 'test.h', content: '#define X 1' }]
      };
      expect(() => wsMessageSchema.parse(message)).not.toThrow();
    });
  });
});
```

---

### TEST-006: Serial Monitor UI-Tests erweitern
**Priorität:** Mittel  
**Geschätzte Zeit:** 45 Minuten  
**Zieldatei:** [tests/client/serial-monitor.ui.test.tsx](tests/client/serial-monitor.ui.test.tsx)

**Neue Tests hinzufügen (nach dem bestehenden describe-Block):**
```typescript
describe('SerialMonitor - Edge Cases', () => {
  it('should handle empty output array', () => {
    render(<SerialMonitor output={[]} />);
    // Sollte keine Fehler werfen
    expect(screen.queryByText(/./)).toBeNull();
  });

  it('should handle very long lines without breaking layout', () => {
    const longLine = 'A'.repeat(1000);
    const output = [{ text: longLine, isComplete: true }];
    render(<SerialMonitor output={output} />);
    expect(screen.getByText(longLine)).toBeInTheDocument();
  });

  it('should handle special characters in output', () => {
    const specialChars = '<script>alert("xss")</script>';
    const output = [{ text: specialChars, isComplete: true }];
    render(<SerialMonitor output={output} />);
    // Sollte escaped werden, kein echtes Script
    expect(screen.getByText(specialChars)).toBeInTheDocument();
  });

  it('should handle Unicode characters', () => {
    const unicode = '温度: 25°C 💡';
    const output = [{ text: unicode, isComplete: true }];
    render(<SerialMonitor output={output} />);
    expect(screen.getByText(unicode)).toBeInTheDocument();
  });

  it('should handle rapid output updates', async () => {
    const { rerender } = render(<SerialMonitor output={[]} />);
    
    // Simulate rapid updates
    for (let i = 0; i < 100; i++) {
      rerender(<SerialMonitor output={[{ text: `Line ${i}`, isComplete: true }]} />);
    }
    
    // Letzter Update sollte sichtbar sein
    expect(screen.getByText('Line 99')).toBeInTheDocument();
  });
});
```

---

### TEST-007: Carriage Return / Backspace Verarbeitung
**Priorität:** Hoch  
**Geschätzte Zeit:** 30 Minuten  
**Zieldatei:** Bereits vorhanden: [tests/server/control-characters.test.ts](tests/server/control-characters.test.ts)

**Überprüfen und ggf. erweitern:**
```typescript
describe('Control Characters - Additional Cases', () => {
  it('should handle multiple consecutive backspaces', () => {
    // Test: "ABCD\b\b\b" -> "A"
    const input = 'ABCD\b\b\b';
    // Implementiere den Test basierend auf dem tatsächlichen Handler
  });

  it('should handle backspace at start of string (no-op)', () => {
    const input = '\bABC';
    // Backspace am Anfang sollte ignoriert werden
  });

  it('should handle carriage return with partial overwrite', () => {
    // Test: "ABCDEF\rXY" -> "XYCDEF"
    const input = 'ABCDEF\rXY';
  });

  it('should handle mixed control characters', () => {
    // Test: "AB\bC\rX" -> "XC"
    const input = 'AB\bC\rX';
  });
});
```

---

## 🏗️ CODE-QUALITÄT & REFACTORING

### REFACTOR-001: Ungenutzte npm-Dependencies entfernen
**Priorität:** Mittel  
**Geschätzte Zeit:** 30 Minuten  
**Datei:** [package.json](package.json)

**Aufgabe:**
1. Führe aus: `npm ls --depth=0` um installierte Packages zu sehen
2. Suche nach Imports der folgenden Packages im `client/` und `server/` Ordner:
   - `@hookform/resolvers`
   - `@neondatabase/serverless`
   - `date-fns`
   - `framer-motion`
   - `next-themes`
   - `passport`, `passport-local`
   - `react-icons`

**Befehl zum Prüfen:**
```bash
grep -r "from '@hookform/resolvers'" client/ server/
grep -r "from 'date-fns'" client/ server/
grep -r "from 'framer-motion'" client/ server/
# ... für jedes Package
```

3. Nur Packages entfernen, die NICHT importiert werden:
```bash
npm uninstall <package-name>
```

4. Nach Entfernung: `npm run build` und `npm test` ausführen

---

### REFACTOR-002: Plattform-Helper zentralisieren
**Priorität:** Niedrig  
**Geschätzte Zeit:** 20 Minuten  
**Status:** ✅ Bereits erledigt

**Prüfung:** Die Datei [client/src/lib/platform.ts](client/src/lib/platform.ts) existiert bereits mit `isMac` Export.

---

### REFACTOR-003: OutputLine Interface zentralisieren
**Priorität:** Mittel  
**Geschätzte Zeit:** 30 Minuten  

**Problem:** Das `OutputLine` Interface ist 4x definiert:
- `arduino-simulator.tsx`
- `serial-monitor.tsx`
- `serial-plotter.tsx`
- `compilation-output.tsx`

**Aufgabe:**
1. Öffne [shared/schema.ts](shared/schema.ts)
2. Füge hinzu (falls nicht vorhanden):
```typescript
export interface OutputLine {
  text: string;
  isComplete?: boolean;
  timestamp?: number;
}
```

3. In allen 4 Dateien:
   - Import hinzufügen: `import type { OutputLine } from '@shared/schema';`
   - Lokale Interface-Definition entfernen

4. Testen: `npm run check && npm test`

---

### REFACTOR-004: UUID-Generierung vereinheitlichen
**Priorität:** Niedrig  
**Geschätzte Zeit:** 15 Minuten  
**Datei:** [shared/code-parser.ts](shared/code-parser.ts)

**Problem:** Eigene `generateUUID()` Funktion, obwohl `crypto.randomUUID()` verwendet werden kann.

**Aufgabe:**
1. Prüfe ob `randomUUID` bereits importiert ist (Zeile 2)
2. Falls ja, suche nach einer eigenen `generateUUID` Funktion und ersetze Aufrufe durch `randomUUID()`
3. Testen: `npm test -- tests/server/services/code-parser.test.ts`

---

## 📝 DOKUMENTATION & ÜBERSETZUNG

### DOC-001: Deutsche Testnamen übersetzen
**Priorität:** Niedrig  
**Geschätzte Zeit:** 1 Stunde  

**Betroffene Dateien:**
- `tests/client/components/parser-output.test.tsx` - ca. 17 deutsche Testnamen
- `tests/client/components/serial-monitor.test.tsx` - ca. 3 deutsche Testnamen

**Aufgabe:**
Beispiele für Übersetzungen:
- "sollte die PIN-Konfiguration anzeigen" → "should display PIN configuration"
- "zeigt Warnung bei falschem Baudrate" → "shows warning for wrong baudrate"

---

### DOC-002: Kommentare im Server-Code prüfen
**Priorität:** Niedrig  
**Geschätzte Zeit:** 30 Minuten  
**Dateien:** 
- `server/mocks/arduino-mock.ts`
- `server/routes.ts`

**Aufgabe:** Deutsche Kommentare in englische übersetzen, z.B.:
- "Pfad ggf. anpassen" → "adjust path if needed"
- "leicht gekürzt" → "slightly shortened"

---

## 🔍 SINNHAFTIGKEIT-PRÜFUNGEN

### SENSE-001: SandboxRunner Timeout-Logik prüfen
**Priorität:** Mittel  
**Geschätzte Zeit:** 30 Minuten  
**Datei:** [server/services/sandbox-runner.ts](server/services/sandbox-runner.ts#L115-L130)

**Fragen zu klären:**
1. Ist `timeoutSec = 0` für "unendlich" sinnvoll?
2. Was passiert bei sehr langen Sketches?
3. Wird der Timeout korrekt gecleard?

**Prüfschritte:**
1. Suche nach `executionTimeout` in der Datei
2. Prüfe die Timeout-Implementierung
3. Schreibe einen Test für Timeout-Verhalten:
```typescript
it('should respect custom timeout parameter', async () => {
  // Test mit timeoutSec=5
});

it('should run indefinitely when timeout is 0', async () => {
  // Test mit timeoutSec=0
});
```

---

### SENSE-002: Compilation Cache TTL überprüfen
**Priorität:** Niedrig  
**Geschätzte Zeit:** 15 Minuten  
**Datei:** [server/routes.ts](server/routes.ts#L35-L36)

**Aktuelle Konfiguration:**
```typescript
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
```

**Frage:** Ist 5 Minuten Cache sinnvoll für Compilation-Ergebnisse?

**Prüfschritte:**
1. Analysiere wie der Cache verwendet wird
2. Prüfe ob der Cache korrekt invalidiert wird bei Code-Änderungen
3. Dokumentiere die Entscheidung in einem Kommentar

---

### SENSE-003: Docker-Fallback Verhalten prüfen
**Priorität:** Hoch  
**Geschätzte Zeit:** 30 Minuten  
**Datei:** [server/services/sandbox-runner.ts](server/services/sandbox-runner.ts#L86-L110)

**Problem:** Bei fehlendem Docker wird auf "local execution" zurückgefallen.

**Prüfschritte:**
1. Ist die lokale Ausführung sicher genug?
2. Werden alle Ressourcen-Limits eingehalten?
3. Dokumentiere die Risiken

**Test hinzufügen:**
```typescript
describe('Fallback Behavior', () => {
  it('should log warning when Docker is unavailable', () => {
    // Mock execSync to throw
    // Verify warning is logged
    // Verify mode is 'local-limited'
  });
});
```

---

## ✅ CHECKLISTE VOR ABSCHLUSS

Vor dem Abschließen jeder Aufgabe:

- [ ] `npm run check` - TypeScript Fehler prüfen
- [ ] `npm test` - Alle Tests grün
- [ ] `npm run build` - Build erfolgreich
- [ ] Keine neuen Warnungen in der Konsole

---

## 📈 TEST-COVERAGE ZIELE

| Bereich | Aktuell | Ziel |
|---------|---------|------|
| Statements | 81.88% | 85%+ |
| Branches | 61.59% | 70%+ |
| Functions | 79.16% | 85%+ |
| Lines | 82.99% | 85%+ |

**Schwachstellen mit niedriger Coverage:**
- `client/src/components/features` - 73.18% Statements
- `shared/` - 79.9% Statements
- Branch Coverage generell niedrig

---

*Erstellt am: 18. Januar 2026*
*Für: UnoSim Projekt - Agent-Tasks*
