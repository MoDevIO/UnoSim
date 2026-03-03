# SESSION HANDOVER

**Datum:** 26. Februar 2026

## Architektur-Vision 🚀

Das übergeordnete Ziel der Refactoring-Session ist die schrittweise Migration des bestehenden `SandboxRunner`-Backends in eine **Worker-Thread-Architektur**. Diese soll

1. deutlich bessere Skalierung bei hoher Nutzlast bieten,
2. einen adaptiven Batch-Mechanismus für Serial- und Pin-Outputs integrieren und
3. die Compiler-Pipeline durch einen Gatekeeper semaphorisierten Concurrency-Limits und Precompiled-Linker (.a Archive) optimieren.

Langfristig soll das System in der Lage sein, mehrere Hundert Sketches parallel zu verarbeiten, ohne dass der Hauptthread blockiert oder Tests wegen Race-Conditions flakig werden.

---

## Lessons Learned ⚠️

### 1. Vorsicht beim Entfernen "ungenutzter" Variablen

Während `npm run check` und `tsc` Meldungen über nicht verwendete Variablen gaben, führten radikale Löschungen zu verblüffenden Testfehlern in Vitest. Viele dieser Variablen waren **Mock-Abhängigkeiten** (Logger, Debug-Flags, interne Zeitgeber), die lediglich durch den Test-Runner referenziert wurden. Entfernt man sie ohne Rücksprache mit den Tests, schlagen die Mocks fehl und Vitest bricht mit kryptischen `undefined`-Fehlern.

> Regel: Unbenutzte Felder, die ausschließlich für Tests existieren, sollten mit `// used by tests` kommentiert oder in eine explizite `TestHooks`-Schnittstelle verlagert werden.

### 2. Analyse des Syntax-Chaos

Die Wurzel des Syntaxproblems war die Methode `runSketch`, die im Laufe der Session zur Monsterfunktion angeschwollen war. Mehrere Hilfsfunktionen (`createWrappedCallbacks`, `initializeRunState` etc.) waren *innerhalb* von `runSketch` definiert. Dadurch entstanden verschachtelte Closures und ein multimediales Durcheinander von `{}`-Paaren. Der TypeScript-Compiler meldete schließlich `TS1128: Declaration or statement expected`, weil ein `private`-Methodenkopf mitten in einer anderen Funktion stand.

Die chirurgische Lösung bestand darin,

- `runSketch` frühzeitig zu beenden (korrekte `}`-Platzierung),
- alle internen Helfer als *private Methoden der Klasse* auszugliedern,
- `this`-Bindings über `createWrappedCallbacks` stabil zu halten und
- ein `isTestEnv`-Flag einzuführen.

Ein mechanischer Brace-Scanner (grep/awk/Python) war unverzichtbar, um die Einrückungspegel über 1 700 Zeilen hinweg zu verfolgen.

### 3. Ursprung der 59 fehlschlagenden Tests

Nach den ersten Refactorings liefen plötzlich 59 Tests rot. Die Gründe:

* **State‑Machine‑Validierung:** Der Runner speicherte den letzten Pin‑State in einer globalen `RegistryManager`. Ohne Zurücksetzen (jetzt `resetForTests()`) kollidierten parallele Tests mit alten Werten.
  * **Integrität sichern:** Operationen müssen entweder den Status abwarten (Promises) oder eine klare Fehlermeldung/Boolean zurückgeben – stillschweigendes Ignorieren führt zu schwer auffindbaren Race-Conditions.
* **Batcher‑Initialisierung:** Die Serial- und Pin-Batcher wurden nur beim ersten Sketch erstellt; im Testmodus fehlten sie komplett, was `undefined`-Exceptions auslöste.
* **Mock‑Inkompatibilität:** Einige Tests erwarteten, dass der Runner die Callback-Funktionen synchron aufruft; im Refactor kehrten sie asynchron zurück, und die Mocks warteten nicht auf `Promise<void>`.

Lösung: Test-Hooks ergänzen, Registry zurücksetzen, Batcher in `initializeRunState()` forcieren und Polling-Mechanismen in Mocks aktualisieren.

---

## Masterplan für den Wiederaufbau 🔄

### **Phase 1 – Clean Foundation**

1. `runSketch` auf eine klar definierte, wenige-hundert‑Zeilen‑Methode reduzieren.
2. Alle substanziellen Teile (kompilieren, startProcess, cleanup, callbacks) als `private` Klassenelemente extrahieren.
3. Beheben der sieben verbliebenen TS-Check-Fehler mit **chirurgischen Eingriffen**:
   * Prefix für dort noch referenzierte Variablen verwenden (`_unused`).
   * Dummy-Reads (`void this.logger;`) anbringen, die Vitest-Mocks befriedigen, ohne Runtime‑Kosten.
   * `// eslint-disable-next-line` nur in eng begrenzten Blöcken.

### **Phase 2 – Efficiency-Layer**

- **Compile-Gatekeeper**: Semaphore‑Pattern mit maximal acht parallelen Compiler-Tasks. (Pseudocode siehe unten.)
- Integration eines Precompiled-Linker: Vorher erstellte `.a`-Archive werden bei identischem Quellcode wiederverwendet – geringer Aufwand.
   * **Pfad-Konvention:** Die `.a`-Archive sollten in einem dedizierten `cache/`-Ordner außerhalb von `temp/` liegen, damit sie einen `git clean` oder `rm -rf temp` überleben. Der LocalCompiler hält diesen Pfad als statisches Attribut bereit.
- Benchmark-Skripte (`bench-sandbox.ts`) aktualisieren, um Telemetrie (`BENCH_TELEMETRY`) für Gatekeeper‑Wartezeiten zu erfassen.

### **Phase 3 – Flow-Control**

- Adaptive Batching für Serial- und Pin-Outputs neu einbauen: der Verzögerungsalgorithmus (Latenz‑vs‑Durchsatz) passt die Batch‑Größe dynamisch an.
- Stress‑Tests (z. B. Mehrfachregler, 500 Sketches) laufen lassen und Batch‑Parameter (maxSize, maxAge) feinjustieren.
- Batcher in der `RegistryManager` verwalten; Tests fügen einen `collection-complete`-Event hinzu.

### **Phase 4 – Isolation**

- Schrittweise Verschiebung der `SandboxRunner`-Instanzen in `worker_threads`.
- Sicherstellen, dass alle bisherigen Events (`onOutput`, `onError`, `onPinState`, `onCompile`) via `MessageChannel` weitergereicht werden.
- Vitest-Konfiguration: `BENCH_NO_WORKER` für deterministische Single‑Thread‑Ausführung, damit vorhandene Mock‑Suiten unverändert bleiben.

---

## Wichtige Code-Snippets 🧩

### Adaptive Batching (Pseudocode)
```ts
interface BatchOptions { maxSize: number; maxAge: number; }
class AdaptiveBatcher {
  private buffer: any[] = [];
  private timer?: NodeJS.Timeout;
  constructor(private opts: BatchOptions) {}
  push(item: any) {
    this.buffer.push(item);
    if (this.buffer.length >= this.opts.maxSize) return this.flush();
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.opts.maxAge);
    }
  }
  flush() {
    clearTimeout(this.timer!);
    sendToClient(this.buffer);
    this.buffer = [];
    this.timer = undefined;
  }
  adjust(latency: number) {
    // einfache Logik: wenn Latenz hoch, Größe reduzieren
    this.opts.maxSize = Math.max(1, this.opts.maxSize - 1);
  }
}
```

### Robust Cleanup (Windows EPERM trick)

```ts
// Um 'EPERM' Fehler beim Löschen von noch gesperrten .exe Dateien zu vermeiden:
try {
  const trashPath = `${targetPath}.trash.${Date.now()}`;
  renameSync(targetPath, trashPath); // Verschieben ist oft erlaubt, wenn Löschen blockiert
  rm(trashPath, { recursive: true, force: true }).catch(() => {});
} catch {
  rm(targetPath, { recursive: true, force: true }).catch(() => {});
}
```

### Compile-Gatekeeper (Semaphore)
```ts
class CompileGatekeeper {
  private available = 8;
  private queue: Array<() => void> = [];
  acquire(): Promise<() => void> {
    return new Promise<() => void>((res) => {
      const grant = () => { this.available--; res(this.release.bind(this)); };
      this.available > 0 ? grant() : this.queue.push(grant);
    });
  }
  private release() {
    this.available++;
    if (this.queue.length) {
      const next = this.queue.shift()!;
      next();
    }
  }
}
```

---

Dieses Dokument dient als Wissensanker, wenn nach einem Git‑Reset auf den `dev`‑Stand (ca. 11 h vor dem 26. Februar 2026) die Arbeit wieder aufgenommen wird. Jeder Abschnitt kann als Checkliste genutzt werden, um Fortschritte zu messen und Regressionen zu vermeiden.

---

*Ende der Session-Handover*

# SESSION HANDOVER (Update: 03. März 2026)

## Aktueller Status: "The Great Clean-up" ✅
Die Codebase wurde von Altlasten befreit und die Test-Infrastruktur auf ein professionelles Niveau gehoben.

### Erreichte Meilensteine
1. **Pipeline-Stabilisierung:** Ein neues `./run-tests.sh` Script mit automatischem Server-Management, Health-Checks und radikaler Log-Filterung ist aktiv.
2. **Cache-Vollständigkeit:** Der 3. Test für `cache-optimization.test.ts` (TTL-Eviction) wurde identifiziert und erfolgreich implementiert.
3. **Repo-Hygiene:** Das Root-Verzeichnis wurde von ~30 Dateien auf 8 essentielle Bestandteile reduziert; Altlasten liegen in `/archive`.
4. **Test-Konsolidierung:** E2E-Tests (Playwright) und Unit/Integration-Tests (Vitest) sind nun sauber getrennt (`/e2e` vs. `/tests/core` & `/tests/server`).

---

## Offene technische Positionen (Priorisiert) 🚩

### 1. Der "Timing-Flake" im Serial-Monitor
* **Symptom:** `serial-monitor-baudrate-rendering.test.tsx` schlägt gelegentlich fehl.
* **Vermutung:** Durch die schnellere Test-Execution (weniger Datei-I/O) passen die `setTimeout`-Mocks nicht mehr perfekt zu den Render-Zyklen.
* **Task:** `waitFor` statt fester Timeouts nutzen oder die Taktung des virtuellen Baudrate-Generators im Test stabilisieren.

### 2. Dependency Injection für CACHE_TTL
* **Kontext:** Der neue 3. Cache-Test prüft die Eviction. Aktuell ist der Wert im Code (5 Min) für schnelle Tests schwer zu handhaben.
* **Task:** `CACHE_TTL` in `compiler.routes.ts` via Umgebungsvariable oder Constructor-Injection steuerbar machen.

---

## Masterplan Update
Wir befinden uns jetzt am Übergang von **Phase 1 (Foundation)** zu **Phase 2 (Efficiency)**. 
Der nächste große Block ist der **Compilation-Worker-Pool**, um die sequentielle Abarbeitung aufzubrechen.
