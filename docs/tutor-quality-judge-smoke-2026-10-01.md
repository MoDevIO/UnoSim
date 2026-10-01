# Tutor Quality Judge Smoke — 2026-10-01

## Ergebnis

Protocol A wird für PR 1.4 als **`NON_REPRODUCIBLE_HISTORICAL_PROTOCOL`** klassifiziert. Es war historisch vorgesehen, lässt sich aus Code und Tests aber nicht eindeutig rekonstruieren und wird deshalb nicht als Baseline verwendet. Es wurden keine Rubrik-ID, Version oder Outcome-Codes erfunden oder widersprüchliche Fixtures harmonisiert. Ein valider A/B-Vergleich ist damit nicht möglich; der Engineering-Smoke prüft ausschließlich den aktuell implementierten Minimal-Judge Protocol B.

Der erste B-Batch bleibt als `connectivity-invalidated batch` dokumentiert und zählt nicht zu G1. Der einzige formale B-Batch ist abgeschlossen und G1 **FAIL**. Es wurden keine Produktionsdateien verändert und keine Kriterien für `learn-to-deepen` oder `expand` ergänzt. Wegen G1 FAIL wurden weder Removal noch LOC-Messung oder Removal-Gates begonnen.

## A. Historischer Protocol-A-Vertrag

Geprüft wurde der lokale historische Commit `68c8e22915a77bf901825a7aed0146bbcd3e4093` im Worktree `/tmp/unosim-pr1-4-protocol-a`. Die drei verlangten Produktionsdateien wurden vollständig und in der vorgegebenen Reihenfolge gelesen. Dazu wurden die drei direkten Judge-Tests (`judge-schema.test.ts`, `judge-prompt.test.ts`, `judge-provider.test.ts`) sowie der Evidence-Vertragstest (`judge-evidence.test.ts`) vollständig gelesen. Die Tests definieren nur Fixtures; sie liefern keine gemeinsame vollständige Rubrik.

| Vertragspunkt | Historischer Befund | Beleg |
| --- | --- | --- |
| Rubric ID | **not defined in historical Protocol A** als autoritativer Wert. Das Ergebnis-Schema verlangt ein nichtleeres `rubricId`; die Prompt-/Provider-Schnittstellen übernehmen den konkreten Wert aus einer geladenen Rubrik. | `judge-schema.ts:92–109`, `judge-prompt.ts:57–90, 170–198`, `judge-provider.ts:6–23, 96–100`; Fixture-IDs weichen ab: Schema-Test `:30–37`, Prompt-Test `:64–73`, Provider-Test `:31–38`. |
| Rubric version | **not defined in historical Protocol A** als autoritativer Wert. Das Schema verlangt Integer ≥ 1; kein kanonischer Wert ist festgelegt. | `judge-schema.ts:92–109, 146–160`; dieselben drei Fixture-Stellen oben verwenden Versionen 7, 1 und 3. |
| Dimension-IDs | `factual-correctness`; `sketch-code-grounding`; `learner-answer-diagnosis`; `precision`; `instructional-usefulness`; `scaffolding`; `dialogic-progression`; `non-repetition`; `difficulty-appropriateness`. | `semantic-types.ts:4–15`; alle neun werden als exakte Schlüssel verlangt in `judge-schema.ts:63–66, 152–160` und `judge-prompt.ts:66–75`. |
| Dimension-Verdicts | Für jede Dimension gilt `assessed`, `not-assessable` oder `abstained`. `assessed` verlangt ein Outcome; die anderen Statusformen dürfen kein Outcome enthalten. | `judge-schema.ts:32–61`; dieselben Regeln stehen als Prompt-Vertrag in `judge-prompt.ts:33–44`. |
| Outcome-Codes je Dimension | **Nicht eindeutig rekonstruierbar.** Schema-Test nutzt für alle Dimensionen `fixture-supported` und `fixture-weakness` (`judge-schema.test.ts:30–37`). Prompt-Test nutzt pro Dimension `${dimension}-supported` und `${dimension}-weak` (`judge-prompt.test.ts:64–73`). Provider-Test nutzt pro Dimension nur `${dimension}-supported` (`judge-provider.test.ts:31–38`). Der Validator verlangt einen expliziten nichtleeren Katalog in der geladenen Rubrik und lehnt andere Codes ab. | `judge-schema.ts:104–109, 146–160, 264–270`; `judge-prompt.ts:57–79`. Die Fixtures widersprechen einander und benennen sich selbst als Test-/Fixture-Rubriken. |
| Issue Codes | Die drei Judge-Test-Fixtures stimmen auf `major-weakness` und `minor-weakness` überein. Das ist der einzige aus den Tests konsistent ablesbare Code-Satz; eine historische produktive Rubrikinstanz, die ihn als Protocol-A-Vertrag bindet, existiert in den geprüften Quellen nicht. | `judge-schema.test.ts:30–37`; `judge-prompt.test.ts:64–73`; `judge-provider.test.ts:31–38`; Code muss zusätzlich in `judge-schema.ts:272–274` in `rubric.issueCodes` enthalten sein. |
| Issue-Felder | Pflicht: `code`, `severity` (`major`/`minor`), mindestens eine `affectedDimensions`, `rationale`, `materialityRationale`, mindestens eine `citedEvidence`. Keine Zusatzfelder. | `judge-schema.ts:68–75`; Prompt-Spiegelung `judge-prompt.ts:42`. |
| Evidenz-/Citation-Felder | Citation ist exakt `{ locationId }`, ID-Form `ev-` plus 64 kleingeschriebene Hexzeichen; ID muss in `evidence.locations` aufgelöst werden. `assessed`: mindestens eine Citation; `not-assessable`/`abstained`: Citation-Liste darf leer sein. Issue: mindestens eine Citation. Kritischer Fehler: eine Claim-Citation und ≥1 Contrary-Citation; Claim muss auf `stage-a-final-response`, Contrary-Belege auf andere Evidence-Quellen zeigen. Evidence-Locations sind auf `repository/sketch`, `frozen-pre-turn-context`, `stage-a-final-response`, `reviewed-factual-reference` beschränkt. | `judge-schema.ts:19–30, 32–55, 68–85, 168–193, 223–232, 280–285`; Evidence-Allow-List-Test `judge-evidence.test.ts` (vollständig geprüft). |
| Top-Level Pflicht/Optional | Pflicht: `schemaVersion`, `evaluationIdentity`, `rubricId`, `rubricVersion`, `semanticEvaluationStatus`, alle neun `rubricResults`, `issues`, `criticalSemanticFailures`. `abstain` ist optional und nur bei globalem Status `abstained` zulässig bzw. dann erforderlich. Objekte sind strict. | `judge-schema.ts:92–102, 288–293`; Prompt `judge-prompt.ts:40–44`. |
| Status-/Schema-Invarianten | `schemaVersion` ist `tutor-quality-absolute-judge-result-v1`; Evaluation Identity ist SHA-256. Globaler Status muss aus Dimensionen folgen: alle assessed → `completed`; mindestens eine assessed und mindestens eine nicht assessable/abstained → `partially-completed`; keine assessed → `abstained`. Issues und kritische Fehler dürfen nur assessable Dimensionen betreffen. | `judge-schema.ts:9, 92–102, 199–213, 259–293`. |
| Critical-failure taxonomy | Exakt `factually-wrong-feedback`, `correct-answer-rejected`, `false-sketch-claim`, `invented-sketch-property`, `contract-breaking-complete-solution`, `semantic-contradiction`, `false-premise-question`. Pflichtfelder: `taxonomyCode`, `claim`, `claimCitation`, `contraryEvidence`, mindestens eine `contraryEvidenceCitations`, mindestens eine `affectedDimensions`, `materialityRationale`. | `judge-schema.ts:10–18, 77–85`; Citation-Quelleninvariante `:223–232`; Prompt `judge-prompt.ts:37–44`. |
| Call-Vertrag | Ein strukturierter Aufruf pro `callJudgeOnce`, feste Modell-ID, explizite finite Temperatur; kein Retry oder semantisches Repair in dieser Funktion. Historischer Provider-Test belegt Temperatur 0 und Single-Call-Verhalten. | `judge-provider.ts:78–114, 116–155`; `judge-provider.test.ts:40–54, 97–120`. |

### Exakter Stop-Grund

Die eindeutige Ausführbarkeit scheitert an diesen historischen Lücken:

1. Kein autoritativer `rubricId` und keine autoritative `rubricVersion`.
2. Kein eindeutiger `outcomeCodesByDimension`-Katalog: Die drei Test-Fixtures verwenden inkompatible Definitionen.
3. Die gemeinsamen Issue-Codes sind in allen drei Fixtures gleich, aber kein geladener Protocol-A-Rubrikdatensatz bindet sie als autoritativ.

`buildJudgePrompt` verlangt diese Rubrik explizit und validiert, dass sie genau alle erforderlichen Dimensionen plus eindeutige nichtleere Outcome-/Issue-Codes enthält (`judge-prompt.ts:57–79, 170–181`). Protocol A wird nicht ausgeführt und nicht als Baseline verwendet. Es gab **keine formalen A-Aufrufe**.

## B. External Calls und Budget

Die Zähler wurden aus den Stage-A-Reports und dem protokollierten B-Batch ermittelt. Der ursprüngliche vom Nutzer gemeldete Modelllisten-Aufruf ist separat berücksichtigt.

| Kategorie | Calls |
| --- | ---: |
| Ursprünglicher Modelllisten-Aufruf | 1 |
| Zusätzliche `listModels`: fehlgeschlagener Preflight + Connectivity-Diagnose + erfolgreicher Stage-A-Lauf | 8 |
| Tutor-Generierungen | 5 |
| Connectivity-invalidated Protocol-B-Batch | 15 |
| Formales Protocol A | 0 |
| Formales Protocol B | 15 |
| **Verbraucht nach formalem B** | **44** |
| **Verbleibend von 80** | **36** |

Die acht zusätzlichen Modelllisten-Aufrufe setzen sich aus 1 fehlgeschlagenem Stage-A-Preflight, 1 diagnostischem Connectivity-Aufruf und 6 im erfolgreichen Stage-A-Lauf zusammen. Der erfolgreiche Stage-A-Report weist 11 Provider-Calls aus: 6 `listModels` und 5 Tutor-Generierungen. Vor dem formalen B-Lauf waren 29 Calls verbraucht; der formale Lauf fügte exakt 15 Judge-Calls hinzu. Es gab keine neuen Tutor-, Stage-A-, Sample-, `listModels`- oder Protocol-A-Aufrufe.

Der formale B-Lauf führte auf **44/80 verbrauchte Calls** und **36 verbleibende Calls**.

## C. Connectivity-Incident

- Der erste B-Batch umfasst **15 Calls**, davon **13 Providerfehler**.
- Er wird als `connectivity-invalidated batch` dokumentiert und aus G1 ausgeschlossen: **ja**.
- Alle 15 Calls zählen weiter zum globalen External-Call-Budget.
- Keine einzelnen Calls dieses B-Batches wurden wiederholt.
- Der formale B-Batch nach Rückkehr ins stabile Heim-WLAN erhielt für alle 15 Requests HTTP 200; in diesem Batch wurde kein Connectivity-Ausfall erkannt.

Der Incident-Batch bleibt unverändert in `.tutor-quality-output/pr-1-4-frozen/protocol-b/`. Seine Ergebnisse sind keine formalen G1-Messwerte.

## D. Stage-A-Transcripts

- Fall: `TQ-SEM-001`
- Tutor-Modell: `openai-gpt5.4-mini`
- Erfolgreiche Auswertung: 5/5 Samples, alle `completed`
- Run-ID: `tq2a-20261001T143951923Z-ad386bcd-df92-4bf1-9d39-a79ec091317e`
- Evaluation Identity: `8cd67e689c36a570f65f237f0910cdb07d6420b9b5db141c829b1a54931b0a25`
- Speicherort/Freeze-Manifest: `.tutor-quality-output/pr-1-4-frozen/`

| Sample | SHA-256 Digest | Status |
| --- | --- | --- |
| `TQ-SEM-001-0` | `1b92f7ca32acaaca3f246556c0e04438c7ef24ebfc432328c6a2740085b2e783` | completed |
| `TQ-SEM-001-1` | `368a1486e5782e3de45c5effe32dc67c0eba40414b9283a26fb76eab817d5a96` | completed |
| `TQ-SEM-001-2` | `189ebacba8199f14f55493af23f14f3ec3a5d99d1fa5fc8bb811a06b73a21ba8` | completed |
| `TQ-SEM-001-3` | `49088182f8f1c559ad324f247ab73ec052d0c23c94da4e981b95f49b5f238e4e` | completed |
| `TQ-SEM-001-4` | `7f7e47c9cb325211b9056178e8e4dc38fc706d6390fc6e80171634b3bc7fda2a` | completed |

Unmittelbar vor dem formalen B-Lauf wurden alle fünf Digest-Werte erneut aus den Transcript-Dateien berechnet und mit dem Freeze-Manifest verglichen: **5/5 stimmen überein**. Alle fünf Transcript-Dateien haben `executionStatus=completed` und sind auswertbar. Die frühere Manifest-Prüfung nach dem invalidierten Batch ist zusätzlich in `.tutor-quality-output/pr-1-4-frozen/post-protocol-b-digests.json` abgelegt. Es wurden keine neuen Tutor-Samples erzeugt.

## E. Formales G1

| Protocol | Schema | Evidence | Repeatability | Ergebnis |
| --- | --- | --- | --- | --- |
| A | nicht ausgeführt | nicht ausgeführt | nicht ausgeführt | `NON_REPRODUCIBLE_HISTORICAL_PROTOCOL`; keine Baseline |
| B | 15/15 = **100 %** (PASS) | 15/15 = **100 %** (PASS) | 0/0 evaluierbare Paare = **nicht auswertbar** (Schwelle nicht erfüllt) | **FAIL** |

G1-Grenzwerte bleiben Schema ≥95 %, Evidence ≥90 %, Repeatability ≥80 %. Die 15 Calls des ersten connectivity-invalidated B-Batches fließen in keinen G1-Zähler ein.

Der formale Batch hatte 15/15 HTTP-200-Antworten, 15 schema-valide Ergebnisse und 15 evidence-valide Ergebnisse. Allerdings meldeten **alle 15** Antworten `gpt-5.5-2026-04-24` statt der angeforderten Judge-ID `openai-gpt5.5`. Der aktuelle Evaluator klassifiziert einen zurückgegebenen Modell-Mismatch als `judge-invalid` vor der semantischen Ergebnisannahme (`real-provider-evaluation.ts:1310–1324`). Damit gab es 0 gültige Ergebnisse für die angeforderte Modell-ID und keine evaluierbaren Verdict-Paare für Repeatability. Es gab **0 Abstentions** unter den für die angeforderte Modell-ID akzeptierten Ergebnissen, **15 technische Modell-Mismatch-Fehler**, **0 Providerfehler** und keine Response-Format-Ablehnung.

Minimale Latenz: **5.113 ms**; Median: **8.448 ms**; maximale Latenz: **10.653 ms**. Jeder Call zählte genau als ein Provider-Call.

Die drei geforderten Kriterien im Anchor Case sind `accepts-correct-answer`, `no-false-claim` und `distinct-followup`. Der Harness hat Verdicts nur dann in die Attempts übernommen, wenn die zurückgegebene Modell-ID exakt der angeforderten ID entsprach. Daher wurden für diese 15 Modell-Mismatch-Ergebnisse keine Criterion-Verdicts persistiert; sie lassen sich ohne einen verbotenen Retry nicht rekonstruieren. Die Einzelerfassung lautet:

| Sample | Repeat | Schema | Evidence | Criterion-Verdicts | Abstention | Technischer Fehler | Providerfehler | Latenz (ms) | Calls |
| --- | ---: | --- | --- | --- | --- | --- | --- | ---: | ---: |
| `TQ-SEM-001-0` | 1 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 8.958 | 1 |
| `TQ-SEM-001-0` | 2 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 10.653 | 1 |
| `TQ-SEM-001-0` | 3 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 6.515 | 1 |
| `TQ-SEM-001-1` | 1 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 9.633 | 1 |
| `TQ-SEM-001-1` | 2 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 8.983 | 1 |
| `TQ-SEM-001-1` | 3 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 5.113 | 1 |
| `TQ-SEM-001-2` | 1 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 7.270 | 1 |
| `TQ-SEM-001-2` | 2 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 7.353 | 1 |
| `TQ-SEM-001-2` | 3 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 6.952 | 1 |
| `TQ-SEM-001-3` | 1 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 8.563 | 1 |
| `TQ-SEM-001-3` | 2 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 8.756 | 1 |
| `TQ-SEM-001-3` | 3 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 10.016 | 1 |
| `TQ-SEM-001-4` | 1 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 7.761 | 1 |
| `TQ-SEM-001-4` | 2 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 8.448 | 1 |
| `TQ-SEM-001-4` | 3 | gültig | gültig | nicht gespeichert (Modell-ID-Mismatch) | nicht auswertbar | returned-model-mismatch | nein | 6.600 | 1 |

**Protocol B besteht G1 nicht.** Da alle Gates gemeinsam bestehen müssen, endet der Smoke hier. Keine Threshold-Änderung, kein Retry, keine neue Judge-Architektur und kein Removal.

## F. Removal, LOC und Gates

G1 ist fehlgeschlagen. Deshalb wurde die Stage-2B-Removal-Slice nicht begonnen; es gibt keinen Removal-Branch und keinen Commit. LOC-Messung und Removal-Gates wurden nicht ausgeführt. Es wurden keine Dateien entfernt.

## G. Verbleibende Arbeit

- `learn-to-deepen`-Kriterien
- `expand`-Kriterien
- Vereinfachung des Stage-A-Runners
- Auflösung der Modell-ID-Abbildung zwischen angefordertem Alias und vom Provider gemeldetem Snapshot, bevor ein weiterer Judge-Smoke möglich ist

`UNOSIM_MINIMAL_JUDGE_G1_PASS_AND_STAGE2B_REMOVAL_READY_FOR_REVIEW=NO`

## H. Follow-up nach Model-Identity-Korrektur

Dieser Abschnitt ist der aktuelle Stand und ersetzt für G1 die frühere Auswertung in Abschnitt E. Der zuvor ausgewertete Batch mit 15 `returned-model-mismatch`-Fehlern bleibt historisch und wird nicht neu interpretiert. Seine Verdicts wurden damals nicht gespeichert und sind nicht rekonstruierbar.

### Root Cause und korrigierte Invariante

- Angefordert wurde der öffentliche Alias `openai-gpt5.5`; KI:connect lieferte in den Completions `gpt-5.5-2026-04-24` zurück.
- Stage A und der Judge verglichen diese Strings zuvor exakt und verwarfen die Auswertung, obwohl der Provider den Alias zuvor als verfügbar meldete und eine konkrete Antwortmodell-ID lieferte. Ein OpenAI-kompatibler Provider garantiert nicht, dass ein Alias als identischer String im Completion-Response wiederholt wird.
- Prüfbar sind stattdessen: ein fixes, explizites und im Preflight verfügbares Request-Modell (kein `auto`), eine nichtleere returned model identity als Provenance sowie deren Batch-Konsistenz. Request-Alias und returned/resolved ID bleiben getrennt sichtbar. Ein fehlendes returned model bleibt fail-closed.
- Minimal geändert wurden `real-provider-evaluation.ts`, `kiconnect-provider.ts`, fokussierte Evaluation-/Provider-Regressionstests und die relevante Modellidentitätsaussage in `ssot_function_definition_TutorQualityStage2A.md`. `report.ts` kann requested und returned IDs bereits getrennt ausweisen. Die geschützte `ssot_function_tutor_model_registration.md` blieb unverändert.
- RED wurde für Alias-Auflösung, fehlende returned ID und Judge-Preflight beobachtet; anschließend liefen die fokussierten Tests sowie die im Arbeitsstand dokumentierten lokalen Gates erfolgreich: `npm run check`, Tutor-TS-Compile, Tutor-Quality-Tests, Unit-Tests, Docs-Check und `git diff --check`.

### Freeze und Calls

Unmittelbar vor diesem Batch stimmten die SHA-256-Digests der fünf eingefrorenen Transcripts erneut alle mit dem Freeze-Manifest überein (5/5); alle waren `completed`. Es wurden keine Tutor-Samples, Stage-A-Aufrufe, Transcripts oder Protocol-A-Aufrufe erzeugt.

| Zähler | Calls |
| --- | ---: |
| Vor dem Follow-up | 44 |
| Model-Preflight (`listModels`) | 1 |
| Neue formale Protocol-B-Judge-Aufrufe | 15 |
| Aktueller Gesamtstand | **60 / 80** |
| Verbleibend | **20** |

Der Judge-Request war in allen 15 Fällen `openai-gpt5.5`. Der Preflight bestätigte den Alias als verfügbar. Alle 16 HTTP-Antworten (Preflight plus Judge) hatten Status 200; es gab 0 Provider- oder Connectivity-Fehler und keine Retries.

### Neuer formaler Protocol-B-Batch und G1

| Messung | Ergebnis | Grenze | Bewertung |
| --- | ---: | ---: | --- |
| Schema | 13/15 = **86,7 %** | ≥95 % | **FAIL** |
| Evidence | 13/13 = **100 %** | ≥90 % | PASS |
| Repeatability | 31/33 = **93,9 %** | ≥80 % | PASS |
| Returned model vorhanden | 15/15 | 15/15 | PASS |
| Unique returned models | `gpt-5.5-2026-04-24` (1) | genau 1 | PASS |
| Model-resolution consistency | **PASS** | genau 1 konsistente ID | PASS |
| Abstentions | **0** | — | — |
| Provider-/Connectivity-Fehler | **0** | — | — |

Repeatability umfasst alle drei Required Criteria über die drei paarweisen Run-Vergleiche. Zwei schema-valide Verdict-Datensätze fehlten wegen Schemafehlern; damit waren 33 statt maximal 45 Paare auswertbar. Der Nenner ist größer als null.

Die zwei Schemafehler waren `criterion-quote-invalid` bei `TQ-SEM-001-0`, Repeat 1, und `TQ-SEM-001-2`, Repeat 3. Es wurden keine Criterion-Verdicts für diese zwei nicht parsebaren Antworten angenommen. Für die übrigen 13 Antworten sind sämtliche Criterion-Verdicts unten gespeichert; ihre Erfassung erfolgte vor der Batch-Konsistenzprüfung. Rohantworten wurden nicht in den Smoke-Bericht übernommen.

| Sample | Repeat | Returned model | Schema | Evidence | Criterion-Verdicts (ID = Verdict) | Abstentions | Technischer/Providerfehler | Latenz (ms) |
| --- | ---: | --- | --- | --- | --- | ---: | --- | ---: |
| TQ-SEM-001-0 | 1 | gpt-5.5-2026-04-24 | ungültig (`criterion-quote-invalid`) | ungültig | — | 0 | — | 11.453 |
| TQ-SEM-001-0 | 2 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=fail | 0 | — | 9.523 |
| TQ-SEM-001-0 | 3 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=fail | 0 | — | 10.904 |
| TQ-SEM-001-1 | 1 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 9.666 |
| TQ-SEM-001-1 | 2 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 7.277 |
| TQ-SEM-001-1 | 3 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 7.782 |
| TQ-SEM-001-2 | 1 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 7.808 |
| TQ-SEM-001-2 | 2 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 7.846 |
| TQ-SEM-001-2 | 3 | gpt-5.5-2026-04-24 | ungültig (`criterion-quote-invalid`) | ungültig | — | 0 | — | 7.117 |
| TQ-SEM-001-3 | 1 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 10.774 |
| TQ-SEM-001-3 | 2 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 8.533 |
| TQ-SEM-001-3 | 3 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 8.044 |
| TQ-SEM-001-4 | 1 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=pass; no-false-claim=pass; distinct-followup=pass | 0 | — | 6.492 |
| TQ-SEM-001-4 | 2 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=pass; no-false-claim=pass; distinct-followup=pass | 0 | — | 5.936 |
| TQ-SEM-001-4 | 3 | gpt-5.5-2026-04-24 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 10.598 |

Latenz: Minimum **5.936 ms**, Median **8.044 ms**, Maximum **11.453 ms**. Alle 15 calls wurden jeweils genau einmal ausgeführt.

### Entscheidung / Stopp

Der neue formale Batch besteht den Model Resolution Consistency Check, Evidence und Repeatability. G1 ist dennoch **FAIL**: 13/15 = 86,7 % Schema-Validität unterschreitet 95 %. Zwei malformed criterion quotes erklären genau die beiden Schemafehler; die Batch-Messung wird nicht repariert oder wiederholt. Gemäß Workflow endet PR 1.4 hier: kein PR-Merge, keine Post-Merge-CI und kein Stage-2B-Removal-Branch; keine LOC-Messung und keine Removal-Commits.

Die Modellidentitätskorrektur samt Tests und SSOT liegt im isolierten Branch `fix/tutor-quality-model-alias-provenance` auf Basis `ec8b2fccc41a9ef86588a2feac5f4c5bfc1d1275`. Die Smoke-Dokumentation wurde ergänzt. Die Änderungen sind lokal und nicht committed. Der Haupt-Checkout sowie geschützte SSOT-Dateien wurden nicht verändert.

`UNOSIM_MODEL_ALIAS_FIXED_G1_PASS_AND_STAGE2B_REMOVAL_READY_FOR_REVIEW=NO`

## I. Letzter autorisierter Protocol-B-Batch

Dieser Batch folgt auf die Offline-Diagnostik und ist die letzte erlaubte Provider-Messung. Der Harness wurde ausschließlich lokal ergänzt: Er bewahrt Top-Level-Keys, Criterion-/Issue-Anzahl, returned model, Schema-Status und bei fehlerhaften Criteria ID/Verdict/Validation-Reason sowie Quote-Typmetadaten. Er speichert keine Quote-Inhalte, Prompts, Credentials, Header, Evidence oder vollständige Tutor-/Provider-Antworten. Acht Fake-Quoteformen (missing, null, leer, whitespace, gültiger String, Zahl, Objekt, Array) wurden offline geprüft; sie wurden korrekt klassifiziert. Ein zusätzlicher Fake-Test bestätigt, dass einzeln lesbare Verdicts vor dem Verwerfen des Gesamtergebnisses erhalten bleiben.

Die fünf eingefrorenen Transcripts hatten vor dem Lauf erneut passende SHA-256-Digests (5/5, alle `completed`). Das zuvor protokollierte `listModels`-Preflight bestätigte `openai-gpt5.5`; dieser Batch führte keinen neuen Preflight aus. Es gab keine Tutor-Aufrufe, Retries, Reparaturen oder Fallbacks.

### Ergebnis

| Metrik | Ergebnis | Bewertung |
| --- | ---: | --- |
| Judge-Calls | 15/15 | vollständig |
| Requested model | `openai-gpt5.5` | — |
| Returned models | `gpt-5.5-2026-04-24` (15/15; unique = 1) | Consistency PASS |
| Schema | 14/15 = **93,3 %** | **FAIL** (erforderlich 15/15) |
| Evidence | 14/14 = **100 %** | PASS |
| Repeatability | 34/39 = **87,2 %** | PASS |
| Abstentions | 0 | — |
| Provider-/Connectivity-Fehler | 0 | — |
| HTTP-Status | 200 bei allen 15 Calls | — |
| Latenz | Minimum 5.262 ms; Median 9.832 ms; Maximum 11.733 ms | — |

### Schemafehler und Einordnung

Ein Fehler: `TQ-SEM-001-0`, Repeat 1, returned model `gpt-5.5-2026-04-24`, Validation-Reason `criterion-quote-invalid`. Top-Level-Keys waren `criteria`, `criticalIssues`; Anzahl: 3 Criteria und 1 Critical Issue. Vor dem Gesamtfehler wurden drei Verdicts erfasst. Die redigierte Diagnose fand:

| Criterion | Verdict | Quote present | JSON-Typ | Leer nach trim | Raw/trimmed length |
| --- | --- | --- | --- | --- | ---: |
| `no-false-claim` | pass | yes | string | yes | 0 / 0 |
| `distinct-followup` | pass | yes | string | yes | 0 / 0 |

**Root cause: PROMPT/PARSER CONTRACT BUG.** Der Prompt verlangt eine Quote bei `fail`, spezifiziert aber nicht ausdrücklich, dass bei `pass` oder `unclear` das Quote-Feld wegzulassen ist statt `""` zu senden. Der Parser erlaubt das Feld nur fehlend oder als nichtleeren String und lehnt `""` ab. Das gemessene Modellverhalten ist deshalb durch den Prompt nicht klar ausgeschlossen, während der Parser es verwirft.

Damals empfohlene Contract-Entscheidung: das Verhalten von `quote` für `pass`/`unclear` explizit festlegen. Die inzwischen bestätigte Semantik und Offline-Korrektur stehen in Abschnitt J. Der alte formale Batch bleibt unverändert und wird nicht rückwirkend neu bewertet.

### Einzelmessungen

| Sample | Repeat | Schema | Evidence | Criterion-Verdicts (ID=Verdict) | Abstentions | Technischer/Providerfehler | Latenz (ms) |
| --- | ---: | --- | --- | --- | ---: | --- | ---: |
| TQ-SEM-001-0 | 1 | ungültig (`criterion-quote-invalid`) | ungültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 8.397 |
| TQ-SEM-001-0 | 2 | gültig | gültig | accepts-correct-answer=pass; no-false-claim=pass; distinct-followup=fail | 0 | — | 10.622 |
| TQ-SEM-001-0 | 3 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=fail | 0 | — | 10.789 |
| TQ-SEM-001-1 | 1 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 7.400 |
| TQ-SEM-001-1 | 2 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 11.063 |
| TQ-SEM-001-1 | 3 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 11.367 |
| TQ-SEM-001-2 | 1 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 7.971 |
| TQ-SEM-001-2 | 2 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 8.821 |
| TQ-SEM-001-2 | 3 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 10.749 |
| TQ-SEM-001-3 | 1 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 7.575 |
| TQ-SEM-001-3 | 2 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 9.832 |
| TQ-SEM-001-3 | 3 | gültig | gültig | accepts-correct-answer=pass; no-false-claim=pass; distinct-followup=pass | 0 | — | 9.952 |
| TQ-SEM-001-4 | 1 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 9.706 |
| TQ-SEM-001-4 | 2 | gültig | gültig | accepts-correct-answer=fail; no-false-claim=pass; distinct-followup=pass | 0 | — | 11.733 |
| TQ-SEM-001-4 | 3 | gültig | gültig | accepts-correct-answer=pass; no-false-claim=pass; distinct-followup=pass | 0 | — | 5.262 |

### Stoppstatus

**G1 bleibt FAIL** ausschließlich wegen der Schemaquote 14/15 = 93,3 %, unter der erforderlichen 15/15. Der eine Fehler ist als eigener Prompt/Parser-Vertragsfehler belegt. Gemäß Auftrag: keine weiteren Provider-Calls, keine Threshold-Änderung, kein Removal und kein Fix vor einer bewussten Benutzerentscheidung. Gesamtbudget: **75/80**, verbleibend **5**.

`UNOSIM_FINAL_B_G1_FAIL_NO_MORE_PROVIDER_CALLS=YES`


## J. Offline-Korrektur des Quote-Vertrags

Ohne weitere Provider-Aufrufe wurde der belegte Prompt/Parser-Vertragsfehler minimal korrigiert. Für `fail` verlangt der Prompt weiter eine nichtleere exakte Quote aus der erlaubten Evidence. Für `pass` und `unclear` werden fehlende, `null`-, leere und whitespace-only Quotes als absent normalisiert; andere JSON-Typen bleiben ungültig. Jede nichtleere Quote wird weiterhin gegen dieselbe Evidence-Allowlist geprüft. Die Allowlist und die Critical-Issue-Quote-Regel wurden nicht verändert.

RED wurde für die bislang nicht unterstützten Fälle `pass` mit `""`, Whitespace und `null` sowie `unclear` mit `""` beobachtet. Die neuen Offline-Regressionstests bestehen jetzt für diese Fälle, für fehlende/ungültige Quotes bei `fail`, eine gültige Evidence-Quote bei `fail` sowie Zahl, Objekt und Array bei `pass`. Die normalisierten Resultate enthalten kein `quote`-Feld für die als absent behandelten Werte.

Dies ist ein lokaler Contract-Fix, keine empirische G1-Neubewertung. G1 bleibt **FAIL** auf Basis des unveränderten letzten formalen B-Batches (14/15 schema-valid). External-call budget: **75/80**, verbleibend **5**. Es gab keine Provider-Aufrufe und keinen Removal.

## K. Offline-Korrektur: formale Revalidierung

Nach Bereitstellung des lokal konfigurierten Judge-Credentials wurde genau ein Protocol-B-Revalidierungsbatch gegen dieselben fünf eingefrorenen `TQ-SEM-001`-Transcripts ausgeführt. Der Judge-Request war `openai-gpt5.5`; jede der fünf Samples erhielt drei unabhängige Runs. Es gab keinen `listModels`-, Tutor-, Stage-A-, Diagnose-, Retry-, Repair- oder Fallback-Aufruf. Alle 15 HTTP-Aufrufe antworteten mit Status 200. Das Credential wurde ausschließlich aus `.env.local` geladen und weder ausgegeben noch im Report gespeichert.

| Messung | Ergebnis | Grenze | Bewertung |
| --- | ---: | ---: | --- |
| Judge-Aufrufe | 15/15 | exakt 15 | vollständig |
| Schema | 15/15 = **100 %** | ≥95 % | PASS |
| Evidence | 15/15 = **100 %** | ≥90 % | PASS |
| Repeatability | 43/45 = **95,6 %** | ≥80 % | PASS |
| Returned model vorhanden | 15/15 | 15/15 | PASS |
| Unique returned models | `gpt-5.5-2026-04-24` (1) | genau 1 | PASS |
| Abstentions | 0 | — | — |
| Provider-/Connectivity-Fehler | 0 | — | — |
| Latenz | Minimum **5.564 ms**, Median **7.436 ms**, Maximum **8.582 ms** | — | — |

Repeatability vergleicht je `(sample, criterion)` die drei paarweisen Run-Paare. Ein Paar zählt nur bei identischem Verdict als übereinstimmend; Reason, Stil, Quote und Citation-Reihenfolge fließen nicht ein. Der Nenner enthält alle 45 auswertbaren Paare.

| Sample | Repeat 1 (accepts / claim / follow-up) | Repeat 2 (accepts / claim / follow-up) | Repeat 3 (accepts / claim / follow-up) | Latenzen (ms) |
| --- | --- | --- | --- | --- |
| `TQ-SEM-001-0` | pass / pass / fail | pass / pass / fail | pass / pass / fail | 7.885 / 7.436 / 7.867 |
| `TQ-SEM-001-1` | fail / pass / pass | fail / pass / pass | fail / pass / pass | 7.248 / 6.976 / 6.801 |
| `TQ-SEM-001-2` | fail / pass / pass | fail / pass / pass | fail / pass / pass | 7.816 / 8.033 / 6.986 |
| `TQ-SEM-001-3` | fail / pass / pass | pass / pass / pass | fail / pass / pass | 8.269 / 8.582 / 7.694 |
| `TQ-SEM-001-4` | pass / pass / pass | pass / pass / pass | pass / pass / pass | 6.105 / 5.564 / 6.789 |

All 15 parsed results were schema- and evidence-valid. The model alias and returned identity were recorded separately; all returned identities were present and consistent. The 43/45 agreement rate exceeds the repeatability threshold. **G1 PASS.** This is the first successful empirical G1 result for active Protocol B; Protocol A remains `NON_REPRODUCIBLE_HISTORICAL_PROTOCOL`. Stage-2B removal is not included in PR 1.4 and is handled as a separate post-merge slice.
