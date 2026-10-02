# UnoSim – Umsetzungsplan zur Vereinfachung von Tutor und Tutor Quality

> **HISTORICAL / SUPERSEDED (2026-10-02).** Dieser Plan ist abgeschlossen bzw. überholt und keine Arbeitsgrundlage mehr. Aktueller Plan: `docs/UNOSIM_TUTOR_QUALITY_AUTOMATION_PLAN.md`; normativ: `ssot/ssot_function_definition_TutorQualityEvaluation.md`.

Stand: 2026-09-29
Grundlage: `docs/UNOSIM_TECHNICAL_ARCHITECTURE_HEALTH_REVIEW.md`
Geprüft gegen:

- `main` @ `59686397817e6dba123374590e00c750d0e41200`
- PR-2-Branch im Worktree `/private/tmp/unosim-tutor-quality-stage-2b-absolute-judge`,
  letzter sauberer Checkpoint `68c8e22915a77bf901825a7aed0146bbcd3e4093`
  (Commits `ae2cb817`, `25f31146`, `1443212a`, `68c8e229`)
- uncommittete Checkpoint-5-Arbeit im selben Worktree (getrennt betrachtet)

Dieses Dokument ist ein Plan. Code wurde nicht geändert.

---

## 0. Die Antwort in fünf Sätzen

1. Der kürzeste risikoarme Weg führt über den **bestehenden Stage-2A-Runner**.
   Er führt den echten Tutor bereits mit dem echten KI:connect-Provider aus,
   budgetiert Calls und schreibt Transcripts. Ihn erweitern wir um **einen kleinen
   Judge-Schritt** und **einen Markdown-/JSON-Report** (zusammen ~500 NCLOC).
2. Vor dem ersten realen Lauf werden nur zwei Runtime-Befunde behoben, weil sie
   die Aussagekraft des Reports verfälschen: `temperature` in der Identity und der
   `Function.toString()`-Prompt-Digest. Die übrigen Befunde gefährden den
   Strategie-Test nicht und folgen in Phase 3.
3. Der Judge wird **zuerst gemessen, dann festgelegt**. Ein Smoke-Test vergleicht
   das bestehende 9-Dimensionen-/Citation-Protokoll (Branch-Stand `68c8e229`) mit
   einem minimalen Kriterien-Protokoll auf identischen Tutor-Transcripts. Eine
   vorher festgelegte Entscheidungsregel (Gate G1) wählt das Protokoll.
4. Danach werden die LEARN-, DEEPEN- und EXPAND-Fälle im **vorhandenen**
   Anchor-Korpus ausgebaut, und die Stage-2B-Bibliothek auf `main` wird entfernt:
   sie hat keinen Produktions- oder Skript-Konsumenten.
5. Checkpoint 5 wird **verworfen**. Nur eine Idee daraus bleibt: Der Status leitet
   sich ausschließlich aus den für den Fall geforderten Kriterien ab. Der PR-2-Branch
   wird **nicht gemergt**. Nur die Structured-Provider-Grenze (`ae2cb817`) wird
   übernommen.

---

## 1. Verifikation der Review-Befunde gegen den aktuellen Code

| Befund (Review) | Ergebnis der Nachprüfung | Konsequenz |
| --- | --- | --- |
| R3: zusätzlicher `listModels`-Call pro Request | **Bestätigt, präzisiert.** Pro Tutor-Turn gibt es genau **einen** `listModels`- und einen Generierungs-Call. Bei fester Modell-ID ruft `TutorService.resolveModel` die Liste ab (`server/services/tutor/tutor-service.ts:720-725`), bei `auto` tut es `KiconnectProvider.resolveModel` (`server/services/tutor/kiconnect-provider.ts:245-250`). Das Review-Diagramm („bei auto intern nochmals“) war hier ungenau: Es sind nicht drei Calls. | Phase 3 |
| R8: unbeschränkter Session-Store | **Bestätigt** (`server/services/course-content/course-content-session.ts:32-65`). | Phase 3 |
| R9: parallele Requests derselben Session | **Bestätigt als Mechanismus.** Der Client setzt `isLoading` (`client/src/hooks/use-tutor.ts:313, 381`), verhindert parallele Requests in der Funktion selbst aber nicht; Neue-Frage und Dialog können sich überlappen. Der Eval-Runner arbeitet in-process und sequenziell und ist davon **nicht** betroffen. | Phase 3 |
| A2: `temperature` in `evaluationIdentity`, aber nicht im Provider-Call | **Bestätigt.** Identity/Metadaten: `real-provider-evaluation.ts:331, 373`. CLI setzt `0.2`: `scripts/tutor-quality-real-provider-eval.ts:222`. Provider hartkodiert `0.2`: `kiconnect-provider.ts:216`. | **Phase 1, blockierend** |
| R2: Prompt-Digest via `Function.toString()` | **Bestätigt** (`tutor-service.ts:765-776`). | **Phase 1, blockierend** |
| Prepare-Timeout | **Bestätigt**: `Promise.race` mit nie gecleartem `setTimeout` (`server/services/sandbox/execution-phases/prepare-phase.ts:41-47`) zusätzlich zum Gatekeeper-Timeout gleicher Länge. | Phase 3 (Kern, unabhängig) |
| 8.4: `dockerTestBypassGateway` in Produktion | **Korrektur am Review:** Es gibt bereits einen Startup-Guard. Das Flag ist nur mit `NODE_ENV=test` **und** Docker-Modus erlaubt, sonst wirft `config.ts` (`server/config.ts:100-110`). | kein Handlungsbedarf |
| Stage 2B ohne Konsumenten | **Bestätigt.** Außer den eigenen Tests importiert nichts `server/services/tutor/evaluation/semantic/*`. | Phase 2: REMOVE |
| Checkpoint `68c8e229` | **Grün.** Der Export des Commits (ohne Working-Tree-Änderungen) besteht alle Tutor-/Semantic-Tests: 30 von 31 Dateien, 283 von 284 Tests. Einzige Ausnahme ist der Git-State-Test der CLI, weil der Export kein `.git` hat. Das ist ein Artefakt des Exports, kein Codefehler. | Branch ist als Messbasis nutzbar |
| Uncommittete Checkpoint-5-Arbeit | 9 geänderte Dateien (+60/−6) plus 2 neue: `absolute-evaluation.ts` (528 Zeilen) und `semantic-evaluation.test.ts` (522 Zeilen). **2 Testdateien rot.** Inhalt: `assessableDimensions` wird in Evidence und Prompt aufgenommen, der Status wird nur aus den geforderten Dimensionen abgeleitet, Prompt-Revision v1 → v2, `assessableDimensions` darf leer sein, Orchestrator `evaluateSemanticSample`. | **verwerfen** (Details in Abschnitt 5) |
| `ae2cb817` ändert die Fehlerart für HTTP 5xx | `provider-unavailable` → `provider-server-error`. `tutor.routes.ts` bildet unbekannte Arten auf `PROVIDER_UNAVAILABLE` ab, die API-Antwort bleibt also gleich. Stage-2A-Reports zählen `technicalErrorKinds` künftig unter neuem Namen. | beim Übernehmen im PR-Text dokumentieren |

---

## 2. Zielbild und Abgrenzung

### 2.1 Ziel

```text
StrategyTestCase (anchor-corpus.yaml, optional mit judge-Block)
  → echter Tutor (TutorService in-process + KiconnectProvider → KI:connect)
  → TutorResult/Transcript (Stage-2A-Transcript, unverändert)
  → Judge (ein Structured-Call über KiconnectProvider, anderes Modell/Credential möglich)
  → SemanticEvaluation (strikt validiert, fail-closed)
  → report.json + report.md
```

**Festlegung „echte API“:** Der Tutor läuft in-process über `TutorService` mit dem
echten Provider, wie heute in Stage 2A. Der HTTP-Weg über `/api/tutor/*` bleibt
außen vor. Begründung: Route, Session-Store und Rate-Limit sind unit-getestet und
beeinflussen die didaktische Qualität nicht. Ein HTTP-Runner bräuchte zusätzlich
einen laufenden Server, eine Identity und Credential-Transport. Das ist mehr
Aufwand ohne Mehrwert für die Fragestellung. **DEFER** (Abschnitt 11).

### 2.2 Nicht-Ziele (für diesen Plan verbindlich)

- keine Benchmark-Plattform, kein Ranking, keine Pairwise-Evaluation
- keine statistischen Modellvergleiche oder Konfidenzintervalle
- keine Calibration-Governance, keine Held-out-/Gold-Governance
- keine Exposure-/Kontaminations-Nachverfolgung
- kein Import fremder oder alter Transcripts
- keine Token-/Kostenrechnung

### 2.3 Was wofür nötig ist

| Kategorie | Komponenten |
| --- | --- |
| **Für den Tutor selbst erforderlich** | `tutor.routes.ts`, `TutorService`, `llm-provider.ts`, `KiconnectProvider`, `model-preference.ts`, `CurriculumTutorAdapter` inkl. `curriculum/*` und `strategy/*`, `course-content/*` (Loader, Schema, Annotation, Session), `shared/tutor.ts`, Client-Tutor |
| **Für den minimalen automatisierten Tutor-Test erforderlich** | Stage-2A-Runner (`real-provider-evaluation.ts`, vereinfacht), `anchor-corpus.ts`, `anchor-course-content.ts`, CLI `scripts/tutor-quality-real-provider-eval.ts`, `StructuredLLMProvider` + `generateStructuredResponse` (aus `ae2cb817`), **neu**: `judge.ts`, `report.ts`, eine Canonical-Digest-Funktion, bestehender Workflow `tutor-quality-real-provider.yml` (erweitert) |
| **Deterministische Absicherung (bleibt CI-Gate)** | Stage 1 (`course-content/tutor-quality-*`, `scripts/validate-tutor-course-content.mjs`), Strategy-Conformance-, Precedence-, Mastery-Progression-, TQ-REG- und Szenario-Tests (`npm run test:tutor-quality`) |
| **Nur für künftige Benchmark-/Research-Anforderungen** | Case Exposure, Transcript-Compatibility-Mapping und -Ingestion, Transcript-Referenzen, Provenance-Identities, Corpus-Evolution-Vergleich, Case-Rollen (`calibration`, `held-out-evaluation`), Factual-Reference-Review-Status/-Digests, Human Reference, Calibration-Status/-Identity, Candidate-Identity, 4-teiliges Call-Budget, 9-Dimensionen-Rubrik mit Outcome-Code-Katalog (falls G1 dagegen entscheidet) |

### 2.4 Grenzen, die unbedingt erhalten bleiben

**Sicherheit**

1. Credentials nur über **Env-Var-Namen**, nie als CLI-Wert. Getrennte Namen und
   Secrets für Tutor und Judge.
2. Redaction aller Strings in Artefakten (`redact`) und Allowlist-Projektion der
   Tutor-Ergebnisse (`safeResult`).
3. Real-Provider-Läufe **nur** per `workflow_dispatch` bzw. manuell. **Kein**
   Provider-Call in `test`, `test:unit`, `test:tutor-quality` oder CI.
4. Hartes **Call-Budget** über Tutor- *und* Judge-Calls (ein `CountingProvider`,
   eine Obergrenze).
5. Feste Modell-IDs, `auto` wird für Tutor und Judge abgelehnt.

**Evidence / Judge-Integrität**

6. Der Judge sieht **nur**: Sketch, geprüfte Fakten des Falls, die gebundene Frage,
   die Lernendenantwort, die finale Tutor-Antwort (Feedback, Folgefrage,
   `answerRating`, `learningPhase`) und die Fallkriterien. Er sieht **nicht**:
   Tutor-Modell-ID, Raw-Provider-Output, Tutor-Prompts, erwartete Verdicts und
   andere Samples.
7. Alle Evidence-Strings werden im Judge-Prompt ausdrücklich als Daten markiert,
   nicht als Anweisungen.
8. Die Judge-Ausgabe wird strikt validiert und **fail-closed** behandelt: Ist sie
   ungültig, wird der Status `judge-invalid` mit Grund gesetzt. Es gibt keine
   Reparatur und keinen Retry mit stiller Umdeutung.
9. Zitate müssen **nachprüfbar** sein. Das zitierte Material muss im Evidence-Text
   vorkommen; das wird vom Code geprüft, nicht vom LLM behauptet.

**Reproduzierbarkeit**

10. Git-SHA und Clean-Check (tracked und relevante untracked Dateien).
11. Ein **Run-Manifest** im Report: Git-SHA, Digest der Korpus-Datei, Digests der
    Sketches, Tutor-Prompt-Revision (ID + Text-Digest), Digest jedes tatsächlich
    gesendeten Prompts, Tutor- und Judge-Modell (angefragt und geliefert),
    **effektive** Temperaturen, Timeout, Budget, Judge-Prompt-Revision und
    -Digest.
12. **Eine** kanonische JSON-/Digest-Funktion für alle Identities.

---

## 3. Empfohlene Zielarchitektur

### 3.1 Module

```text
scripts/tutor-quality-real-provider-eval.ts        (KEEP, erweitert: --case, --judge-model, --judge-credential-env)
  │
  ├─ server/services/tutor/evaluation/anchor-corpus.ts        (KEEP, erweitert um optionalen judge-Block)
  ├─ server/services/tutor/evaluation/anchor-course-content.ts (KEEP, + Fixture progression-deepen)
  ├─ server/services/tutor/evaluation/real-provider-evaluation.ts (SIMPLIFY → Runner)
  │     └─ CountingProvider: zählt jetzt auch generateStructuredResponse (Judge)
  ├─ server/services/tutor/evaluation/judge.ts        (NEU, ~200–250 NCLOC)
  │     buildJudgeInput(case, transcript)  → Allowlist-Evidence
  │     buildJudgePrompt(input)            → {system, user, revision, digest}
  │     parseJudgeResult(raw, case, input) → SemanticEvaluation (fail-closed)
  │     judgeTranscript(provider, …)       → genau 1 Call, kein Retry
  ├─ server/services/tutor/evaluation/report.ts       (NEU, ~150–200 NCLOC)
  │     writeRunArtifacts(outputDir, manifest, transcripts, evaluations)
  │       → report.json, report.md, transcripts/*.json
  └─ server/services/tutor/evaluation/canonical.ts    (NEU durch MERGE, ~40 NCLOC)
        canonicalJson(), sha256(), canonicalDigest()
```

### 3.2 Datenmodell: ein Korpus

`evals/tutor-quality/anchor-corpus.yaml` bekommt einen **optionalen** `judge`-Block
pro Szenario. Szenarien ohne `judge` verhalten sich exakt wie heute.

```yaml
corpusId: unosim-tutor-quality-anchor
corpusVersion: 2
scenarios:
  - id: TQ-SEM-001
    sketch: evals/tutor-quality/semantic-fixtures/TQ-SEM-001-input-pullup.ino
    courseContent: free
    turns:
      - kind: dialog
        question: Welche logische Bedingung muss erfüllt sein, damit die LED eingeschaltet wird?
        answer: buttonPin, also an PIN2 muss GND anliegen!
        bindsToQuestion: Welche logische Bedingung muss erfüllt sein, damit die LED eingeschaltet wird?
        difficulty: 30
    judge:
      facts:
        - pinMode(buttonPin, INPUT_PULLUP) aktiviert den internen Pull-up an buttonPin.
        - Mit Taster gegen GND liefert digitalRead(buttonPin) beim Drücken LOW.
        - Der Sketch schaltet ledPin (LED_BUILTIN) HIGH, wenn digitalRead(buttonPin) == LOW.
      criteria:
        - id: accepts-correct-answer
          text: Das Feedback erkennt die Kernaussage der Antwort als fachlich korrekt an.
        - id: no-false-claim
          text: Feedback und Folgefrage enthalten keine fachlich falsche Aussage über den Sketch.
        - id: distinct-followup
          text: Die Folgefrage ist sketchbezogen und fordert einen neuen Denkschritt.
```

Regeln: 1–6 Kriterien pro Szenario, eindeutige IDs, Fakten sind Klartext. Digests
werden **vom Code berechnet** und im Manifest ausgegeben, nicht in YAML gepflegt.

### 3.3 Judge-Ausgabe (Protokoll B, vorbehaltlich Gate G1)

```json
{
  "criteria": [
    { "id": "accepts-correct-answer", "verdict": "pass", "reason": "…", "quote": "…" }
  ],
  "criticalIssues": [
    { "code": "correct-answer-rejected", "quote": "…", "reason": "…" }
  ]
}
```

Validierung (Code, fail-closed):

- `criteria` enthält **jede** Fall-Kriterien-ID genau einmal und keine unbekannte ID.
- `verdict ∈ {pass, fail, unclear}`; `reason` nicht leer und ≤ 600 Zeichen.
- `quote` ist Pflicht bei `fail` und optional sonst. Wenn vorhanden, muss es nach
  Whitespace-Normalisierung wörtlich in der Tutor-Antwort oder im Sketch vorkommen.
- `criticalIssues[].code` stammt aus einer festen Liste: `factually-wrong-feedback`,
  `correct-answer-rejected`, `invented-sketch-property`, `complete-solution`,
  `false-premise-question` (Teilmenge der bestehenden Taxonomie). Jedes Issue
  braucht ein prüfbares `quote`.
- Keine Echos von Identities oder Hashes: Die Identity berechnet der Runner.

`SemanticEvaluation.status ∈ { evaluated, judge-invalid, judge-error, not-evaluated, budget-exhausted }`.
`not-evaluated` heißt: Der Tutor-Turn war nicht `completed`, es findet kein
Judge-Call statt.

### 3.4 Report

- `report.json`: Manifest (2.4, Punkt 11), je Szenario × Sample der Stage-2A-Status,
  die deterministischen Checks, die `SemanticEvaluation`, Judge-Latenz und -Modell
  sowie Call-Zähler (List, Generate, Judge).
- `report.md`: Kopf mit Manifest. Eine Tabelle Szenario × Kriterium (pass/fail/unclear,
  Anzahl über Samples). Pro `fail` bzw. Critical Issue das Zitat und die Begründung.
  Eine Zeile je Nicht-Ergebnis (`judge-invalid` mit Validierungsgrund,
  `judge-error` mit Fehlerart). Am Ende eine Zusammenfassung pro Phase
  (LEARN/DEEPEN/EXPAND). Es gibt **keinen** aggregierten Score und keine
  Rangliste.

### 3.5 Ein Kommando

```text
npm run eval:tutor-quality:real -- \
  --model <tutor-model> --credential-env UNOSIM_TUTOR_EVAL_CREDENTIAL \
  --judge-model <judge-model> --judge-credential-env UNOSIM_TUTOR_JUDGE_CREDENTIAL \
  --case TQ-SEM-001 --samples 3 --max-calls 30 --output-dir .tutor-quality-output
```

Ohne `--judge-model` bleibt das heutige Stage-2A-Verhalten erhalten. `--case` ist
wiederholbar; ohne `--case` laufen alle Szenarien.

---

## 4. Datei-für-Datei-Entscheidung

Legende: **KEEP** unverändert · **SIMPLIFY** verkleinern/umbauen · **MERGE** in ein
anderes Modul · **DEFER** entfernen und später bei Bedarf aus der Git-Historie
zurückholen · **REMOVE** entfernen ohne Rückholabsicht.

### 4.1 Tutor Runtime (`main`)

| Datei | Entscheidung | Phase | Begründung / Maßnahme |
| --- | --- | --- | --- |
| `server/routes/tutor.routes.ts` | **SIMPLIFY** (klein) | 3 | Serialisierung pro Session-Handle (R9), Tutor-Metriken; ansonsten KEEP |
| `server/services/tutor/llm-provider.ts` | **KEEP** (+ `StructuredLLMProvider` aus `ae2cb817`) | 1 | minimales Interface |
| `server/services/tutor/kiconnect-provider.ts` | **KEEP** (+ `ae2cb817`), dann **SIMPLIFY** | 1 / 3 | Phase 1: Structured-Call und Temperatur-Konstante. Phase 3: Modellliste cachen (R3) |
| `server/services/tutor/model-preference.ts` | **KEEP** | – | |
| `server/services/tutor/tutor-service.ts` | **SIMPLIFY** | 1 / 3 | Phase 1: Prompt-Revision aus Prompt-*Texten* (R2). Phase 3: Prompts/Heuristiken nach `tutor-prompts.ts`; `resolveModel` nutzt den gecachten Provider |
| `server/services/tutor/tutor-planning.ts` | **KEEP** | – | Typvertrag |
| `server/services/tutor/tutor-service-factory.ts` | **KEEP** | – | 8 Zeilen; ein MERGE bringt nichts und berührt zwei Aufrufer |
| `server/services/tutor/curriculum-tutor-adapter.ts` | **SIMPLIFY** | 3 | Legacy-`repository`-Pfad und `courseContent`-Provider-Seam entfernen (test-only); Result-Builder vereinheitlichen; **Fachlogik unverändert** |
| `server/services/tutor/curriculum/learning-planner.ts` | **KEEP** (Interface **SIMPLIFY**) | 3 | Interface `LearningPlanner` entfällt, `DefaultLearningPlanner` bleibt |
| `server/services/tutor/curriculum/sketch-facts.ts`, `topic-matcher.ts` | **SIMPLIFY** | 3 | Interfaces entfallen; Klassen oder Funktionen bleiben |
| `server/services/tutor/curriculum/progression-state.ts` | **KEEP** | – | Transaktions-Clone/Commit fachlich nötig |
| `server/services/tutor/curriculum/curriculum-schema.ts` | **KEEP** | – | Content-Vertrag |
| `server/services/tutor/curriculum/content-repository.ts` | **SIMPLIFY** | 3 | `StaticDidacticContentRepository` und `DidacticContentRepository` nach `tests/` verschieben. `parseManifest`/`parseTopic`/YAML-Tag-Schutz bleiben, sofern noch genutzt |
| `server/services/tutor/strategy/*` | **KEEP** | – | Prompt-Injection-Schutz |
| `server/services/course-content/course-content-loader.ts`, `-schema.ts`, `embedded-tutor-annotation.ts` | **KEEP** | – | geteilt mit Examples |
| `server/services/course-content/course-content-session.ts` | **SIMPLIFY** | 3 | Obergrenzen global und pro Identity (R8) |
| `shared/tutor.ts`, `client/src/hooks/use-tutor.ts`, `client/src/lib/tutor-*` | **KEEP** | – | Client-seitig sollte zusätzlich ein früher Return bei `isLoading` die Doppel-Submits verhindern (Phase 3, optional) |

### 4.2 Tutor Quality – Stage 1 und deterministische Tests

| Datei | Entscheidung | Begründung |
| --- | --- | --- |
| `server/services/course-content/tutor-quality-validator.ts`, `-directory-validator.ts`, `-schema.ts`, `scripts/validate-tutor-course-content.mjs` | **KEEP** | deterministisches Authoring-Gate, klein |
| `tests/server/services/tutor/{strategy-conformance,strategy-precedence,mastery-progression*,topic-precedence,tq-reg-001-pwm,tutor-quality-scenarios,question-quality-regressions,fallback-matrix,final-review-fixes}.test.ts`, `support/tutor-quality-scenario-runner.ts` | **KEEP** | schnelle (≈1 s) Absicherung der deterministischen LEARN/DEEPEN/EXPAND-Logik und Sicherheitsnetz für die Phase-3-Refactorings |

### 4.3 Tutor Quality – Stage 2A (`main`)

| Datei | Entscheidung | Phase | Maßnahme |
| --- | --- | --- | --- |
| `server/services/tutor/evaluation/real-provider-evaluation.ts` (1.164 Z.) | **SIMPLIFY** | 1 (klein) / 2 (Umbau) | Phase 1: Judge-Hook, `CountingProvider` zählt Structured-Calls, Temperatur aus Konstante, `stableJson`/`hashCanonical` → `canonical.ts`. Phase 2: Artifact-I/O nach `report.ts`, Rates/`byScenario`-Aggregation durch einfache Zähler ersetzen, leeren No-op-Block entfernen. Ziel ≈ 650–800 Zeilen |
| `server/services/tutor/evaluation/anchor-corpus.ts` | **KEEP** + erweitern | 1 | optionaler `judge`-Block (zod), Case-Filter |
| `server/services/tutor/evaluation/anchor-course-content.ts` | **KEEP** + erweitern | 2 | Fixture `progression-deepen` (Topic gemeistert, Phase DEEPEN) |
| `scripts/tutor-quality-real-provider-eval.ts` | **KEEP** + erweitern | 1 | Flags `--case`, `--judge-model`, `--judge-credential-env`; Timeout aus `config.tutor.timeoutMs` statt `Number(env)` |
| `evals/tutor-quality/anchor-corpus.yaml` | **KEEP** + erweitern | 1 / 2 | TQ-SEM-001 übernehmen, Strategie-Fälle ergänzen |
| `evals/tutor-quality/fixtures/*.ino` | **KEEP** | – | |
| `.github/workflows/tutor-quality-real-provider.yml` | **KEEP** + erweitern | 1 | Inputs `judge_model`, `case`; Secret `UNOSIM_TUTOR_JUDGE_CREDENTIAL`; weiterhin nur `workflow_dispatch`, Retention 14 Tage |
| `tests/server/services/tutor/evaluation/real-provider-evaluation.test.ts`, `tutor-quality-real-provider-cli.test.ts`, `anchor-corpus.test.ts`, `tutor-prompt-revision.test.ts`, `tutor-question-diagnostics.test.ts` | **KEEP/SIMPLIFY** | 1 / 2 | an neue Flags anpassen; Rate-Tests entfallen mit der Aggregation; Prompt-Revision-Test prüft den Text-Digest |

### 4.4 Tutor Quality – Stage 2B, PR 1 (bereits auf `main`)

| Datei | Entscheidung | Phase | Begründung |
| --- | --- | --- | --- |
| `semantic/semantic-canonical.ts` | **MERGE** → `evaluation/canonical.ts` | 1 | eine Digest-Funktion für alles (UTF-8-Byte-Sortierung, Zyklen- und Nicht-JSON-Schutz sind gut); `deepFreeze` entfällt |
| `semantic/semantic-types.ts` | **REMOVE** | 2 | Rollen, Answer-Categories und Evidence-Source-Kinds entfallen; die Kriterien liegen im Korpus |
| `semantic/semantic-corpus.ts` | **REMOVE** (Inhalt **MERGE** in `anchor-corpus.ts`) | 2 | Fakten und Kriterien wandern in den `judge`-Block; Digest-Ketten, Evolution-Vergleich, Rollen und Review-Status entfallen |
| `semantic/frozen-context.ts` | **REMOVE** (Inhalt **MERGE**) | 2 | Frage, Antwort, History und Difficulty sind bereits Stage-2A-Turn-Felder; die Bindung `question == bindsToQuestion` prüft `anchor-corpus.ts` schon |
| `semantic/case-exposure.ts` | **DEFER** | 2 | nur für Held-out-/Kontaminationsaussagen |
| `semantic/stage2a-adapter.ts` | **REMOVE** | 2 | ohne separaten Korpus gibt es kein Case→Scenario-Mapping |
| `semantic/stage2a-transcript.ts` | **DEFER** (Ingestion/Compatibility) | 2 | Minimalprüfung „Turn completed + finalTutorResult vorhanden“ übernimmt `judge.ts` in ~10 Zeilen |
| `semantic/transcript-reference.ts` | **REMOVE** | 2 | keine Verwendung ohne Ingestion |
| `evals/tutor-quality/semantic-corpus.yaml` | **REMOVE** (Case migriert) | 2 | TQ-SEM-001 lebt im Anchor-Korpus weiter |
| `evals/tutor-quality/semantic-fixtures/TQ-SEM-001-input-pullup.ino` | **KEEP** | – | wird vom Anchor-Korpus referenziert |
| `evals/tutor-quality/semantic-case-review-matrix.md` | **DEFER** | 2 | Ideen für TQ-SEM-002..005 als Kandidaten in Phase 2 sichten, Datei dann entfernen |
| `tests/server/services/tutor/evaluation/semantic/*` (6 Dateien + Fixtures) | **REMOVE** | 2 | folgen ihren Modulen |

### 4.5 Tutor Quality – Stage 2B, PR 2 (nur im Branch)

| Commit / Datei | Entscheidung | Begründung |
| --- | --- | --- |
| `ae2cb817` `StructuredLLMProvider`, `KiconnectProvider.generateStructuredResponse`, `requestChatCompletion` + Tests | **KEEP** (cherry-pick in Phase 1) | ein Transport, ein Timeout, eine Fehlerabbildung; Tutor-Pfad unverändert |
| `25f31146` `judge-evidence.ts` | **SIMPLIFY** → Idee in `judge.ts` | Allowlist bleibt; Location-IDs `ev-<sha256>`, Provenance-Felder und Frozen-Context-Projektion entfallen |
| `1443212a` `judge-schema.ts` | **SIMPLIFY** → `judge.ts` | fail-closed bleibt, die Critical-Failure-Taxonomie als Teilmenge; 9-Dimensionen-Pflicht, Outcome-Codes und Identity-Echo entfallen (vorbehaltlich G1) |
| `68c8e229` `judge-prompt.ts` | **SIMPLIFY** → `judge.ts` | „Evidence ist Daten“, „keine Vermutungen“, „nur erlaubte Codes“ bleiben; Rubrik-Projektion und Metadaten-Echo entfallen |
| `68c8e229` `judge-provider.ts` | **REMOVE** | Doppelstruktur `JudgeCallConfiguration`/`JudgeCallMetadata`, Re-Parsing des eigenen Prompts, Calibration-Felder. `judgeTranscript()` ruft den Provider direkt |
| Calibration-Metadaten (`calibrationStatus: "uncalibrated"`, `calibrationIdentity: null`) | **DEFER** | kein Konsument; der Report hält stattdessen fest: „Judge unkalibriert, explorativ“ |
| Branch insgesamt | **nicht mergen** | nur für die Protokoll-A-Messung in Phase 1 verwenden, danach archivieren |

### 4.6 Checkpoint 5 (uncommittet)

| Teil | Entscheidung |
| --- | --- |
| `absolute-evaluation.ts` (528 Z.), `semantic-evaluation.test.ts` (522 Z.) | **verwerfen**. Er verdrahtet Exposure, Provenance, Candidate-Identity und das 4-teilige Budget, also genau die Teile, die entfallen |
| Änderung „Status nur aus geforderten Dimensionen“ (`judge-schema.ts`, `expectedStatus`) | **Idee übernehmen**: Protokoll B bewertet ohnehin nur die Fall-Kriterien. Für die Protokoll-A-Messung wird diese Änderung verwendet, damit A fair gemessen wird |
| `assessableDimensions` in Evidence/Prompt, Prompt-Revision v2 | nur für die Protokoll-A-Messung auf dem Branch |
| Sicherung | Stand vor dem Verwerfen als Commit auf einem Archiv-Branch festhalten (z. B. `archive/stage-2b-checkpoint-5-wip`), **nicht** auf `main` |

---

## 5. Umgang mit den bisherigen PR-2-Commits

1. **`ae2cb817` (Structured Provider):** in PR 1.2 per `git cherry-pick` auf einen
   neuen Branch von `main` übernehmen. Die Fehlerart `provider-server-error` im
   PR-Text dokumentieren. Tests (`kiconnect-provider.test.ts`, +106 Zeilen) kommen
   mit.
2. **`25f31146`, `1443212a`, `68c8e229`:** **nicht** mergen. Sie bleiben auf dem
   PR-2-Branch und dienen in PR 1.4 als **Protokoll A** für die Vergleichsmessung.
   Dafür wird auf dem Branch die Status-Korrektur aus Checkpoint 5 angewendet und
   ein Wegwerf-Skript ergänzt (Abschnitt 6, PR 1.4). Beides wird nie gemergt.
3. **Checkpoint-5-WIP:** vor dem Verwerfen auf einem Archiv-Branch committen.
   Danach den Worktree aufräumen.
4. **Nach Gate G1:** Branch mit einem Tag archivieren
   (z. B. `archive/stage-2b-pr2-protocol-a`) und den offenen PR mit Verweis auf
   diesen Plan und die Messergebnisse schließen.
5. **Der offene Stage-2B-Plan** (`docs/plan-tutor-quality-stage-2b.md`, PR 2–6) wird
   in Phase 2 durch einen kurzen Verweis auf diesen Plan ersetzt (siehe 6, PR 2.4).

---

## 6. Umsetzung in drei Phasen

Gemeinsame Gates für jeden PR: `npm run check`, `npm run lint`,
`npm run test:tutor-quality`, `npm run test:unit`, `npm run check:docs`; zusätzlich
bleibt `npx knip` (Zero-Baseline-Gate) grün. **Kein** PR ruft in Tests oder CI einen
echten Provider auf.

### Phase 1 – Erster echter End-to-End-Lauf mit gemessenem Judge

**Ziel:** Mit **einem** Kommando laufen TQ-SEM-001 und die vorhandenen LEARN→DEEPEN-
und EXPAND-Anchor-Szenarien über den echten Tutor und einen echten Judge. Ergebnis
ist ein nachvollziehbarer `report.md`. Das Judge-Protokoll wird anhand von
Messdaten festgelegt.

**PR-Slices (in dieser Reihenfolge):**

| PR | Inhalt | Dateien | Klasse | LOC (Src / Test) |
| --- | --- | --- | --- | --- |
| **1.1 Eval-Hygiene** | (a) `TUTOR_TEMPERATURE = 0.2` als eine exportierte Konstante, die Provider **und** Eval-Metadaten verwenden; der CLI-Wert `0.2` entfällt. (b) Prompt-Revision-Digest aus den Prompt-*Texten* (System-Prompt, Guidance-Konstanten, Strategy-Texte) statt `Function.toString()`; zusätzlich pro Turn der SHA-256 des tatsächlich gesendeten System- und User-Prompts im Transcript. (c) `canonical.ts` durch MERGE von `semantic-canonical.ts` und `stableJson`; Stage 2A nutzt es. (d) CLI-Timeout aus `config.tutor.timeoutMs` | `kiconnect-provider.ts`, `tutor-service.ts`, `real-provider-evaluation.ts`, `scripts/tutor-quality-real-provider-eval.ts`, neu `evaluation/canonical.ts`; `semantic-canonical.ts` wird zum Re-Export bis Phase 2 | SIMPLIFY/MERGE | ±0 / +40 |
| **1.2 Structured Provider** | Cherry-pick `ae2cb817`; `CountingProvider` implementiert zusätzlich `StructuredLLMProvider` und zählt Judge-Calls im **selben** Budget (`judgeCalls` als eigener Zähler) | `llm-provider.ts`, `kiconnect-provider.ts`, `real-provider-evaluation.ts` | KEEP | +130 / +130 |
| **1.3 Minimaler Judge + Report + CLI** | `judge.ts` (Protokoll B, 3.3), `report.ts` (3.4), optionaler `judge`-Block in `anchor-corpus.ts`, CLI-Flags `--case`, `--judge-model`, `--judge-credential-env`; TQ-SEM-001 als Szenario mit `judge`-Block in `anchor-corpus.yaml`; Workflow-Inputs und -Secret. Fake-Provider-Tests: gültig, ungültiges JSON, fehlendes Kriterium, unbekanntes Kriterium, Quote nicht im Text, Critical Issue ohne Quote, Judge-Timeout, Tutor-Turn nicht completed ⇒ kein Judge-Call, Budget erschöpft vor dem Judge, keine Credentials/Modell-IDs im Judge-Input, Report enthält keine Secrets | neu `evaluation/judge.ts`, `evaluation/report.ts`; `anchor-corpus.ts`, CLI, `anchor-corpus.yaml`, Workflow | NEU (klein) | +450 / +400 |
| **1.4 Judge-Smoke und Protokollentscheidung** | Manueller Lauf auf `main` (Protokoll B) und auf dem Archiv-Branch (Protokoll A, Wegwerf-Skript, nie gemergt); Messprotokoll als `docs/tutor-quality-judge-smoke-2026-xx.md` (Datum im Dateinamen) | nur Doku auf `main` | – | Doku |

**Judge-Smoke-Protokoll (PR 1.4):**

- **Eingabe:** dieselben Tutor-Transcripts für A und B. Zuerst wird ein Stage-2A-Lauf
  mit TQ-SEM-001 (Samples = 5) erzeugt, danach wertet jeder Judge **dieselben**
  5 Transcripts je **3-mal** aus (15 Judge-Calls pro Protokoll). Zusätzlich
  laufen `learn-to-deepen` und `expand` mit einem minimalen `judge`-Block
  (je 2 Samples × 2 Wiederholungen), damit nicht nur ein Free-Tutor-Fall gemessen
  wird. Budget: `--max-calls 80`.
- **Gemessen und im Protokoll tabelliert:**

| Metrik | Definition |
| --- | --- |
| JSON-Parse-Rate | Anteil der Antworten, die als JSON parsebar sind (auch ob `response_format: json_object` akzeptiert wird: 4xx ja/nein) |
| Schema-Erfolgsrate | Anteil, der die strikte Validierung vollständig besteht |
| Citation-/Evidence-Erfolgsrate | A: Anteil der Location-IDs, die existieren. B: Anteil der Quotes, die wörtlich vorkommen |
| Fehlende Dimensionen/Kriterien | Anzahl der geforderten Dimensionen/Kriterien, die fehlen oder unbekannt sind |
| Abstention/Unclear | A: Anteil `abstained`/`not-assessable` bei bewertbaren Dimensionen. B: Anteil `unclear` |
| Wiederholbarkeit | Übereinstimmung des Verdicts bzw. Outcome-Codes pro Kriterium über die 3 Wiederholungen desselben Transcripts |
| Latenz | p50/p95 der Judge-Calls (ms), getrennt nach Protokoll |
| Providerfehler | Anzahl je `TutorProviderErrorKind` (Timeout, Rate-Limit, 5xx, invalid-response) |
| Plausibilität | eine manuelle Stichprobe: Stimmen die Verdicts für TQ-SEM-001 mit der Fallerwartung überein (korrekte Antwort wird nicht zurückgewiesen)? |

- **Gate G1 (Entscheidungsregel, vorab festgelegt):**
  - Protokoll B wird übernommen, wenn Schema-Erfolgsrate ≥ 95 %,
    Quote-Erfolgsrate ≥ 90 % und Wiederholbarkeit ≥ 80 % erreicht sind.
  - Erreicht B die Schwellen nicht, gibt es **höchstens zwei** Prompt-Iterationen
    an B (keine Schema-Erweiterung). Danach wird neu gemessen.
  - Protokoll A wird nur dann in Teilen reaktiviert (ohne Exposure, Provenance oder
    Calibration), wenn B nach zwei Iterationen die Schwellen verfehlt **und** A sie
    erreicht.
  - Verfehlen beide die Schwellen: **STOP** und Rücksprache. Dann ist der Judge-Ansatz
    als solcher zu überdenken (anderes Judge-Modell, weniger Kriterien pro Call),
    nicht das Protokoll auszubauen.

**Abhängigkeiten:** 1.1 → 1.2 → 1.3 → 1.4. PR 1.1 und 1.2 können parallel reviewt
werden, weil sie sich nicht überschneiden, außer in `kiconnect-provider.ts`. Dort
reicht ein kleiner Merge.

**Acceptance Criteria Phase 1:**

1. Das Kommando aus 3.5 erzeugt für TQ-SEM-001 `report.json` und `report.md`,
   lokal oder per `workflow_dispatch`.
2. Das Manifest im Report enthält alle Punkte aus 2.4 (11); die ausgewiesene
   Temperatur ist die tatsächlich gesendete.
3. Der Prompt-Revision-Digest ist unabhängig von der Toolchain (Test: Digest über
   feste Texte; Snapshot).
4. Tutor- und Judge-Calls unterliegen einem gemeinsamen Budget; ein erschöpftes
   Budget führt zu `budget-exhausted` und nicht zu einem Abbruch ohne Report.
5. Keine Credentials oder Tutor-Modell-IDs im Judge-Input; keine Credentials in
   Artefakten (Tests).
6. Das Smoke-Protokoll mit allen Metriken liegt vor, und G1 ist entschieden.

**Tests/Gates:** gemeinsame Gates plus neue Fake-Provider-Tests (PR 1.3). Der
Real-Provider-Lauf ist ausschließlich manuell.

**LOC-Wirkung Phase 1 (netto):** Src ≈ +580, Tests ≈ +570 gegenüber `main`.
Gegenüber dem PR-2-Branch-Stand sind das −1.990 Src und −1.860 Tests, weil
1.370 Src- und 1.430 Test-NCLOC (PR 2 ohne `ae2cb817`) nicht gemergt werden und
Checkpoint 5 entfällt.

**Risiken:** KI:connect unterstützt `response_format` nicht (dann wird im Smoke
gemessen, und der Structured-Call fällt auf die bestehende tolerante
JSON-Extraktion zurück, eine kleine Anpassung in PR 1.3). Quote-Matching ist zu
streng bei Umlauten oder typografischen Anführungszeichen; dagegen hilft
NFKC- und Whitespace-Normalisierung, abgedeckt in den Tests.

**STOP-Punkt Phase 1:** Weiter zu Phase 2 **erst**, wenn G1 entschieden ist und
das Team den ersten `report.md` für TQ-SEM-001 gelesen und als verständlich
akzeptiert hat. Wird G1 nicht erreicht, wird Phase 2 nicht begonnen.

---

### Phase 2 – Strategie-Tests LEARN/DEEPEN/EXPAND und Rückbau Stage 2B

**Ziel:** Ein Lauf beantwortet für jede Phase nachvollziehbar, ob Feedback,
`answerRating` und Folgefrage fachlich korrekt und phasengerecht sind. Die
Stage-2B-Bibliothek ist von `main` entfernt.

**PR-Slices:**

| PR | Inhalt | Dateien | Klasse | LOC (Src / Test) |
| --- | --- | --- | --- | --- |
| **2.1 Strategie-Fälle** | Fixture `progression-deepen` in `anchor-course-content.ts`; je **2–3 Szenarien** für LEARN, DEEPEN und EXPAND mit `judge`-Block. Kriterien pro Phase (Beispiele, final im PR): **LEARN:** Rating passt zur Antwortqualität, Feedback ohne Komplettlösung, bei schwacher Antwort Hinweis bzw. diagnostische Frage gemäß `hintFirst`. **DEEPEN:** Folgefrage verlangt Anwendung oder Transfer auf dasselbe Topic und fragt kein bereits Beherrschtes erneut ab. **EXPAND:** Frage zielt auf eine eigene, am Sketch prüfbare Erweiterung, bezieht sich auf das Expansion-Ziel und liefert keinen Ersatzcode. Deterministische `expected.learningPhase` bleibt für jedes Szenario gesetzt | `anchor-course-content.ts`, `anchor-corpus.yaml`, ggf. 1–2 neue `.ino`-Fixtures | KEEP + Daten | +60 / +40 |
| **2.2 Stage 2B entfernen** | Alle Dateien aus 4.4 mit REMOVE/DEFER löschen; `semantic-corpus.yaml` löschen (TQ-SEM-001 ist seit 1.3 migriert); Re-Export `semantic-canonical.ts` entfernen; knip bleibt grün | `server/services/tutor/evaluation/semantic/**`, `tests/…/semantic/**`, `evals/tutor-quality/semantic-corpus.yaml`, `semantic-case-review-matrix.md` | REMOVE/DEFER | −1.206 / −868 |
| **2.3 Stage-2A-Runner entschlacken** | `real-provider-evaluation.ts`: Artifact-I/O nach `report.ts`, Rates/`byScenario`-Aggregation durch einfache Zähler ersetzen, No-op-Block entfernen, Typen straffen; Verhalten der Checks unverändert | `real-provider-evaluation.ts`, `report.ts`, zugehörige Tests | SIMPLIFY | −500 bis −650 / −80 bis −120 |
| **2.4 Doku zurückschneiden** | `ssot/ssot_function_definition_TutorQualityStage2B.md` (1.285 Z.) auf „Stage 2B Core“ (≈150–250 Z.) kürzen: Ziel, Datenmodell, Judge-Protokoll nach G1, Evidence-Grenzen, Statusmodell, Report. Ein Abschnitt „Deferred“ verweist auf diesen Plan. `docs/plan-tutor-quality-stage-2b.md` durch einen kurzen Hinweis ersetzen. `docs/tutor-quality-stage-2a.md` um Judge-Nutzung ergänzen | `ssot/…Stage2B.md`, `docs/plan-tutor-quality-stage-2b.md`, `docs/tutor-quality-stage-2a.md` | SIMPLIFY | Doku ≈ −1.500 Zeilen |

**Abhängigkeiten:** Phase 1 abgeschlossen (G1). 2.1 ist unabhängig von 2.2 und 2.3.
2.2 vor 2.3, weil 2.3 dann keine Stage-2B-Importe mehr berücksichtigen muss. 2.4
zuletzt.

**Acceptance Criteria Phase 2:**

1. Ein realer Lauf über alle Strategie-Szenarien (Samples = 2) liefert einen
   `report.md` mit einer Zusammenfassung pro Phase; jedes `fail` hat ein
   nachprüfbares Zitat.
2. Deterministische Phasen-Erwartungen (`expected.learningPhase`) sind für alle
   Strategie-Szenarien erfüllt, bevor ein Judge-Ergebnis zählt. Bei einer
   Phasenabweichung weist der Report den Fall als deterministischen Fehler aus,
   nicht als Judge-Befund.
3. Auf `main` existiert kein Code unter `server/services/tutor/evaluation/semantic/`.
4. Die gesamte Tutor-Quality-Infrastruktur (Stage 1 + 2A + Judge/Report) liegt bei
   ≤ 2.300 NCLOC Src (Messung wie im Review).
5. `test:tutor-quality` bleibt unter dem 15-s-Budget und ist grün.

**LOC-Wirkung Phase 2:** Src ≈ −1.650 bis −1.800, Tests ≈ −910 bis −950,
Doku ≈ −1.500 Zeilen.

**Risiken:** Der DEEPEN-Fixture-State wird fachlich falsch konstruiert. Dagegen
hilft ein deterministischer Test, dass `planInitial` damit `learningPhase: DEEPEN`
liefert. Beim Entfernen von Stage 2B gehen Ideen verloren; die Git-Historie und
die Deferred-Liste (Abschnitt 11) sichern sie.

**STOP-Punkt Phase 2:** Weiter zu Phase 3 erst, wenn ein Strategie-Lauf über alle
drei Phasen reviewt wurde und das Team entschieden hat, welche Befunde
Tutor-Verbesserungen auslösen. Phase 3 ist unabhängig vom Eval und kann auch
parallel zu Phase 2 in einzelnen PRs laufen, sobald Kapazität frei ist.

---

### Phase 3 – Runtime-Hygiene (kleine, unabhängige PRs)

**Ziel:** Die Runtime-Befunde beheben, die Tutor-Runtime strukturell vereinfachen,
ohne die LEARN/DEEPEN/EXPAND-Fachlogik zu ändern, und den Kern-Timeout bereinigen.

**PR-Slices (jeweils einzeln reviewbar; Reihenfolge nach Nutzen):**

| PR | Inhalt | Dateien | Klasse | LOC (Src / Test) |
| --- | --- | --- | --- | --- |
| **3.1 Modellliste cachen** | In-Memory-Cache in `KiconnectProvider`, Schlüssel ist der SHA-256 des Credentials (nie das Credential selbst), TTL 5 min, maximal 1.000 Einträge; Fehler werden nicht gecacht. `TutorService.resolveModel` und `auto` profitieren gleichermaßen. Eval-Zähler zeigen weniger `modelListCalls` | `kiconnect-provider.ts` | SIMPLIFY | +35 / +50 |
| **3.2 Session-Store begrenzen** | Obergrenzen global (z. B. 10.000) und pro Identity (z. B. 50) mit Eviction der ältesten Einträge; Prune auch bei `get` | `course-content-session.ts` | SIMPLIFY | +25 / +40 |
| **3.3 Session-Serialisierung** | Pro Handle eine Promise-Kette in `tutor.routes.ts`: Requests derselben Session laufen nacheinander, verschiedene Sessions parallel. Optional im Client ein früher Return bei `isLoading` | `tutor.routes.ts` (optional `use-tutor.ts`) | SIMPLIFY | +25 / +40 |
| **3.4 Prepare-Timeout** | Äußeres `Promise.race`/`setTimeout` entfernen; es gilt das Gatekeeper-Acquire-Timeout (gleicher Wert, `config.timeouts.compileGatekeeperAcquireMs`). Fehlerpfad und `ERROR`-Transition bleiben | `execution-phases/prepare-phase.ts` | SIMPLIFY | −8 / ±10 |
| **3.5 Adapter aufräumen** | Test-only-Seams entfernen (`repository`, `courseContent`-Provider; Tests übergeben Snapshots direkt); `exhaustionResult`/`blockedResult`/`transitionResult` in einen Builder zusammenführen; `strategySource`-Mapping einmal definieren; Single-Impl-Interfaces entfernen; `content-repository.ts`-Testteile nach `tests/`. **Gate:** alle Progression-/Conformance-Tests unverändert grün | `curriculum-tutor-adapter.ts`, `curriculum/*`, betroffene Tests | SIMPLIFY | −120 bis −180 / −50 bis −100 |
| **3.6 TutorService aufteilen** | Prompt-Texte, Builder und Antwortheuristiken nach `tutor-prompts.ts`; Service nur noch Orchestrierung; Metadaten-Mapping bündeln, **ohne** das API-Format zu ändern | `tutor-service.ts`, neu `tutor-prompts.ts` | SIMPLIFY | −60 bis −100 / ±0 |
| **3.7 Tutor-Metriken** | Zähler je `TutorProviderErrorKind` und Latenz in `server-metrics.ts`; im Status-Endpoint sichtbar | `server-metrics.ts`, `tutor.routes.ts` | KEEP + klein | +40 / +30 |

**Abhängigkeiten:** keine zwingenden. 3.5 und 3.6 kollidieren in
`tutor-service.ts` und `curriculum-tutor-adapter.ts` und laufen daher nacheinander.
3.1 vor 3.6.

**Acceptance Criteria Phase 3:**

1. Ein Tutor-Request mit fester Modell-ID macht bei warmem Cache genau **einen**
   KI:connect-Call (Test mit Fake-Fetch).
2. Session-Store: Obergrenzen greifen (Test); parallele Requests eines Handles
   verlieren keine Evidence (Test mit zwei überlappenden Dialog-Requests).
3. Prepare-Phase: Timeout- und Erfolgs-Pfad sind unverändert getestet; kein offener
   Timer nach Erfolg (Fake-Timer-Test).
4. `test:tutor-quality`, `test:unit` und `test:integration` sind grün;
   Strategy-Conformance und Mastery-Progression laufen **ohne** Anpassung ihrer
   Erwartungswerte.
5. Tutor-Server-Runtime ≤ 2.650 NCLOC.

**LOC-Wirkung Phase 3:** Src ≈ −150 bis −300 netto (Abbau 3.5/3.6 minus Zuwachs
3.1–3.3/3.7), Tests ≈ ±0 bis −60.

**Risiken:** 3.5 kann subtile Progressionsänderungen einführen. Nur strukturelle
Änderungen sind erlaubt, unveränderte Tests sind Gate, und ein Stage-2A-Lauf
vorher und nachher mit identischem Korpus zeigt dieselben deterministischen
Checks. 3.3 kann Requests blockieren, wenn ein Provider-Call hängt; das ist durch
das Provider-Timeout begrenzt.

**STOP-Punkt Phase 3:** Nach 3.7 wird kein weiterer Umbau der Tutor-Runtime
angestoßen, solange keine konkreten Befunde aus Strategie-Läufen vorliegen.

---

## 7. Konkrete PR-Reihenfolge (Übersicht)

| # | PR | Phase | blockiert durch |
| ---: | --- | --- | --- |
| 1 | 1.1 Eval-Hygiene (Temperatur, Prompt-Digest, `canonical.ts`, Timeout) | 1 | – |
| 2 | 1.2 Structured Provider (cherry-pick `ae2cb817` + Budget-Zählung) | 1 | – (Merge-Reihenfolge nach 1.1) |
| 3 | 1.3 Minimaler Judge + Report + CLI + TQ-SEM-001-Migration + Workflow | 1 | 1.1, 1.2 |
| 4 | 1.4 Judge-Smoke A/B, Protokoll, **Gate G1** | 1 | 1.3 |
| 5 | 2.1 Strategie-Fälle LEARN/DEEPEN/EXPAND | 2 | G1 |
| 6 | 2.2 Stage 2B von `main` entfernen | 2 | 1.3 (Migration), G1 |
| 7 | 2.3 Stage-2A-Runner entschlacken | 2 | 2.2 |
| 8 | 2.4 SSOT/Plan zurückschneiden | 2 | 2.2 |
| 9 | 3.1 Modellliste cachen | 3 | – (jederzeit möglich) |
| 10 | 3.2 Session-Store begrenzen | 3 | – |
| 11 | 3.3 Session-Serialisierung | 3 | – |
| 12 | 3.4 Prepare-Timeout | 3 | – |
| 13 | 3.5 Adapter aufräumen | 3 | – |
| 14 | 3.6 TutorService aufteilen | 3 | 3.1, 3.5 |
| 15 | 3.7 Tutor-Metriken | 3 | – |

### Runtime-Befunde: vor oder nach dem ersten realen Strategy-Test?

| Befund | Vor dem realen Test beheben? | Begründung |
| --- | --- | --- |
| `temperature` in der Identity, nicht im Call | **Ja (PR 1.1)** | sonst weist der Report einen Parameter aus, der nicht wirkt |
| `Function.toString()`-Prompt-Digest | **Ja (PR 1.1)** | Die Prompt-Revision ist Teil des Manifests; sie muss zwischen Läufen und Umgebungen vergleichbar sein |
| `listModels`-Call pro Request | Nein (3.1) | beeinflusst Latenz und Call-Zahl, nicht die Bewertung; der Report weist List-Calls getrennt aus |
| Unbegrenzter Session-Store | Nein (3.2) | der Eval-Runner nutzt keinen Session-Store; reines Produktionsrisiko |
| Parallele Requests derselben Session | Nein (3.3) | der Eval-Runner ist in-process und sequenziell |
| Prepare-Timeout | Nein (3.4) | Kern, unabhängig vom Tutor |

---

## 8. Geschätzter Codeabbau

NCLOC wie im Review gemessen. Die „PR-2-Stand“-Werte enthalten Branch und
Checkpoint 5.

| Bereich | `main` heute | PR-2-Stand | nach Phase 3 | Δ zu `main` | Δ zu PR-2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tutor Quality Src (Stage 1 + 2A + 2B bzw. Judge/Report) | 3.345 | 4.713 | **≈ 2.050–2.250** | −1.100 bis −1.300 | −2.450 bis −2.650 |
| davon Stage 2B / Judge+Report | 1.206 | 2.574 | ≈ 450–500 | −700 bis −750 | −2.070 bis −2.120 |
| davon Stage 2A | 1.686 | 1.686 | ≈ 1.100–1.250 | −450 bis −600 | −450 bis −600 |
| Tutor Quality Tests | 2.594 | 4.026 | **≈ 2.100–2.250** | −350 bis −500 | −1.780 bis −1.930 |
| Tutor Runtime Server (inkl. Structured Provider) | 2.834 | 2.899 | **≈ 2.550–2.700** | −130 bis −280 | −200 bis −350 |
| Tutor-Quality-Doku (SSOT/Plan/Matrix, Zeilen) | ≈ 2.500 | ≈ 2.500 | ≈ 900–1.000 | ≈ −1.500 | ≈ −1.500 |

Zusätzlich **vermiedener** Code: der noch geplante PR-2-Rest
(`semantic-artifact-writer.ts`, `human-report.ts`, CLI mit zwei Modi, Operator-Doku,
geschätzt +800 bis +1.200 NCLOC) und die geplanten PR 3–6 (Human Reference,
Benchmark, Pairwise, Ranking).

Ergebnis: Tutor Quality ist mit ≈ 2.100 NCLOC Src wieder **deutlich kleiner als die
Tutor-Runtime** und etwa halb so groß wie im PR-2-Stand.

---

## 9. Risiken der Vereinfachung

| Risiko | Wahrscheinlichkeit | Gegenmaßnahme |
| --- | --- | --- |
| Protokoll B ist zu grob für feine didaktische Unterschiede | mittel | Kriterien sind fallspezifisch und damit präziser als generische Dimensionen; `unclear` ist erlaubt; G1 misst die Wiederholbarkeit |
| Später wird Held-out-/Exposure-Tracking gebraucht | niedrig bis mittel | Deferred-Liste; Code liegt im Archiv-Tag; lässt sich als eigene Datei neben dem Korpus ergänzen, ohne Runner oder Judge umzubauen |
| Digest-Änderungen (Canonical-Merge, Prompt-Revision) brechen die Vergleichbarkeit alter Stage-2A-Reports | hoch (einmalig) | einmalig im PR 1.1 dokumentieren; es gibt kaum reale Altläufe |
| Adapter-Refactoring ändert das Verhalten | niedrig | unveränderte Progression-/Conformance-Tests als Gate; Vorher/Nachher-Stage-2A-Lauf |
| Team-Wissen aus dem großen SSOT geht verloren | mittel | SSOT wird gekürzt, nicht gelöscht; der Deferred-Abschnitt benennt jedes aufgeschobene Konzept mit Verweis auf den Archiv-Tag |
| Ein gemeinsames Budget lässt den Judge leer ausgehen, weil der Tutor alles verbraucht | mittel | Status `budget-exhausted` im Report; Hinweis im Kommando-Beispiel (`--max-calls` ≥ Szenarien × Samples × (Turns × 2 + 1)) |

---

## 10. Zustand nach Abschluss: Was kann UnoSim dann tatsächlich?

1. **Ein Kommando** (lokal oder per `workflow_dispatch`) führt ausgewählte
   Tutor-Strategie-Fälle über den echten Tutor und den echten KI:connect-Provider
   aus und lässt jedes Ergebnis von einem getrennt konfigurierten Judge-Modell
   bewerten.
2. Pro Fall gibt es eine **deterministische** Prüfung (Phase, Topic, keine
   Wiederholung, Invarianten) und eine **semantische** Prüfung der Kriterien mit
   Begründung und nachprüfbarem Zitat.
3. **LEARN, DEEPEN und EXPAND** sind je mit 2–3 Fällen abgedeckt; der Report fasst
   pro Phase zusammen.
4. Der **Report** (`report.md`) ist ohne Code-Kenntnis lesbar. `report.json`
   enthält ein vollständiges Manifest, sodass jeder Lauf nachvollziehbar und
   zwischen Läufen vergleichbar ist: gleiche Prompt-Revision, gleiche Fälle,
   gleiche Modelle, gleiche effektiven Parameter.
5. Judge-Ausfälle sind **sichtbar und unterscheidbar** (`judge-invalid` mit Grund,
   `judge-error` mit Fehlerart, `budget-exhausted`, `not-evaluated`) und werden nie
   stillschweigend umgedeutet.
6. Die Tutor-Runtime macht einen Provider-Call pro Request statt zwei, Sessions
   sind begrenzt und serialisiert, und Provider-Fehler sind als Metriken sichtbar.
7. Es gibt **keine** Aussagen über Modellrankings, statistische Signifikanz,
   Kalibrierung oder Lernwirkung, und der Report behauptet auch keine.

---

## 11. Bewusst auf später verschoben

| Thema | Auslöser, der eine Wiederaufnahme rechtfertigt | Quelle |
| --- | --- | --- |
| Case-Exposure-Records (hash-verkettet, append-only) | Held-out-Aussagen über Modelle sollen veröffentlicht werden | `semantic/case-exposure.ts` im Archiv-Tag |
| Import vorhandener Transcripts (Compatibility-Mapping, Transcript-Referenzen) | Transcripts aus fremden Läufen sollen nachträglich bewertet werden | `semantic/stage2a-transcript.ts`, `transcript-reference.ts` |
| Separater Semantic-Korpus mit Rollen (`development`/`calibration`/`held-out-evaluation`), Corpus-Evolution-Vergleich, Digest-Kaskaden | mehrere Autorengruppen oder Governance-Anforderungen am Korpus | `semantic/semantic-corpus.ts`, `frozen-context.ts` |
| 9-Dimensionen-Rubrik mit Outcome-Code-Katalog und Location-ID-Zitaten | nur falls G1 für Protokoll A entscheidet oder feinere Dimensionen nachweislich gebraucht werden | Branch-Stand `68c8e229` |
| Human Reference, Judge-Kalibrierung, Calibration-Identity | automatische Urteile sollen als belastbar (nicht nur explorativ) gelten | Stage-2B-Plan PR 3 |
| Multi-Modell-Benchmark, wiederholtes Sampling mit Statistik | Modellwahl für den Tutor soll datenbasiert entschieden werden | Stage-2B-Plan PR 4 |
| Pairwise-/Blinded-Vergleich, Ranking, Report-Views | wie oben, nach Kalibrierung | Stage-2B-Plan PR 5–6 |
| Token-/Kostenerfassung | Provider liefert Token-Daten und Budgets werden kostenrelevant | – |
| HTTP-basierter Eval-Runner über `/api/tutor/*` | Fehlerbilder, die nur mit Route/Session auftreten | – |
| Retries im Judge (versioniert) | Smoke zeigt transiente Providerfehler > 5 % | – |
| Zusammenlegung von `sketch-facts.ts` mit `analyzeStaticIO` | Topic-Matching braucht Pin-Fakten (z. B. INPUT_PULLUP-Topics) | Review R10 |
| Planungsmetadaten als ein Objekt in der API (`planningMetadata`) | nächste inkompatible Tutor-API-Version | Review Abschnitt 4 |
| Kern-Messungen (WS-Backpressure, unbegrenzte Queues, Stress-Test-Flakiness) | eigenes Kern-Health-Vorhaben | Review Abschnitte 7, 8, 17 |

---

## 12. Kurzfassung der Empfehlung

1. **Jetzt:** PR 1.1 → 1.2 → 1.3, dann der Judge-Smoke (PR 1.4) mit fester
   Entscheidungsregel G1. Checkpoint 5 wird archiviert und verworfen, der
   PR-2-Branch nicht gemergt. Nur `ae2cb817` wird übernommen.
2. **Danach:** Strategie-Fälle für LEARN/DEEPEN/EXPAND im Anchor-Korpus und Rückbau
   der Stage-2B-Bibliothek sowie der Doku.
3. **Parallel oder anschließend:** kleine Runtime-PRs (Modell-Cache,
   Session-Grenzen und -Serialisierung, Prepare-Timeout, Adapter/Service-Aufräumen,
   Metriken).
4. Keine weitere Evaluationsarchitektur, bevor ein Strategie-Lauf über alle drei
   Phasen reviewt ist.

UNOSIM_TUTOR_SIMPLIFICATION_PLAN_COMPLETE=YES
