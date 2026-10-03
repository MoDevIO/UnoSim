# Tutor Quality – L3-Lauf Guidance-only (Prompt v4)

Status: Auswertung, **nicht normativ**. Misst die Guidance-Änderung aus #141
getrennt (#146: Remediation/Klärung nennen ihren SSOT-Auslöser, sonst
nichts) und grenzt sie gegen Prompt v1 und den Antwortbewertungsrahmen v3 ab
(`docs/tutor-quality-answer-frame-rerun-2026-10-03.md`). Rohartefakte liegen
nur lokal.

## 1. Lauf

| Merkmal | Wert |
| --- | --- |
| Run-ID | `tq2a-20261003T143508110Z-87ba5744-f91d-43ca-b834-fa6d8bdf5b7e` |
| Git | Head von #146, `577a86a1`, sauberer separater Worktree |
| Corpus | v7, 18 Cases, 26 Turns, 8 mit Judge |
| Tutor-Prompt | `tutor-prompts-v4`, Digest `c758c6a4…` (Provenance-Fix #145 plus Guidance-Trigger) |
| Modelle | Tutor `openai-gpt5.4-mini` → `gpt-5.4-mini-2026-03-17`; Judge `openai-gpt5.5` → `gpt-5.5-2026-04-24` |
| Samples | 5 |
| Calls | **291 / 291** (126 Model-List, 125 Generierung, 40 Judge) |
| Dauer | 405 s |

Budget vor dem Lauf aus dem Callgraph des ausgecheckten Heads geprüft:
`1 + 5 × (50 + 8) = 291`. 90 / 90 Samples `completed`; 0 Produkt- oder
State-Violations; eine LLM-Violation (`answer-rating-out-of-band`,
`strategy-deepen-transfer` s0, Rating 3 statt [4, 5]). 39 / 40 Judge
`evaluated`, 1 `judge-error` (Provider-Timeout bei
`strategy-expand-wrong-effect` s2; nicht wiederholt). Keine Credential-Werte in
den Artefakten. Provider-Calls der Serie: 437 + 291 = 728.

## 2. `qualityVerdict`

**`fail`**. Repeated (≥ 3/5):

| Case | Schlüssel | Samples |
| --- | --- | --- |
| `strategy-expand-observation` | `criterion/expand-observable-result` | 5/5 |
| `strategy-expand-observation` | `criterion/expand-sketch-grounding` | 3/5 (**neu**) |
| `strategy-learn-strong-answer` | `criterion/learn-feedback-grounds-sketch` | 3/5 |

Isoliert (`warn`): `TQ-SEM-001` `accepts-correct-answer` und
`correct-answer-rejected` je 2/5; `strategy-learn-strong-answer` dieselben je
2/5; `strategy-deepen-transfer` `deepen-uses-transfer` 2/5, Rating außerhalb
des Bands 1/5; `strategy-learn-weak-answer` `learn-hint-first` und
`complete-solution` je 1/5. `inconclusive`: der eine `judge-error`.

## 3. Vergleich v1 – Guidance-only (v4) – v3

v1 = Baseline (n = 3) und Remediation-Nachlauf (n = 3); v4 und v3 je n = 5 auf
Corpus v7. Relativierung = Feedback beginnt mit „Fast“, „Knapp“ oder
„Teilweise“. Ist-Einschub = das Feedback stellt einem Vorschlag den
aktuellen Sketch als Korrektur gegenüber (Handkodierung).

| Befund | v1 | v4 Guidance | v3 Frame |
| --- | --- | --- | --- |
| `expand-observable-result` fail | 6/6 | 5/5 | 5/5 |
| `expand-sketch-grounding` fail | 0/6 | **3/5** | 1/5 |
| Ratings `strategy-expand-observation` | 2,2,2 / 2,2,3 | 2,4,4,2,4 | 3,4,4,3,3 |
| Ist-Einschub bei Vorschlagsantworten | 13/15 | 8/15 | 8/15 |
| `strategy-deepen-transfer` Ratings | 4,4,4 | 3,4,4,4,4 | 5,5,4,4,4 |
| `deepen-uses-transfer` fail | 1/3 | 2/5 | 0/5 |
| Relativierung richtiger Antworten (`TQ-SEM-001` + LEARN-strong) | 6/9 | 6/10 | 7/10 |
| `correct-answer-rejected` LEARN-strong | 1/3, 2/3 | 2/5 | 4/5 |
| `learn-feedback-grounds-sketch` fail | 3/3 | 3/5 | 2/5 |
| Rating LEARN-strong im Band [3, 5] | 3/3, 2/3 | 5/5 | 5/5 |
| `learn-hint-first` fail | 1/3 | 1/5 | 3/5 |
| „Fast“ bei falscher Antwort (`learn-weak`, `deepen-correction`) | 2/6 | 1/10 | 2/10 |
| Negativkontrollen im Band [1, 2] | 6/6 | 15/15 | 15/15 |
| `strategy-expand-wrong-effect`: falsche Wirkung korrigiert | – | 5/5 | 5/5 |

Unterschiede von ein bis zwei Samples bei n = 3 bzw. 5 liegen im Bereich der
Modellvarianz (dieselben v1-Prompts ergaben einmal 1/3, einmal 2/3).

## 4. Bewertung der Guidance-Änderung

**Erwarteter Effekt nicht messbar.** Die Änderung sollte Hinweise und
Relativierungen nach richtigen Antworten verringern. Die Relativierungsrate
richtiger Antworten bleibt bei 6/10 (v1: 6/9); `correct-answer-rejected` bei
LEARN-strong 2/5 entspricht v1.

**Keine Schäden an den Negativkontrollen.** Alle drei bleiben 5/5 im Band;
falsche Antworten beginnen mit „Nicht ganz“ statt „Fast“; `learn-hint-first`
1/5 wie in v1. Die v3-Verschlechterung von `learn-hint-first` (3/5) stammt damit
plausibel aus dem Bewertungsrahmen von #142, nicht aus dem Guidance-Text.

**Neue wiederholte Auffälligkeit:** `expand-sketch-grounding` 3/5 (v1 0/6).
In s1, s2 und s4 bestätigt das Feedback den Vorschlag nur knapp („Das ist
inhaltlich passend und am Sketch direkt prüfbar.“) und grenzt ihn nicht mehr
vom bestehenden Sketch ab. Das passt zum Wegfall des unbedingten
Hinweisauftrags: weniger „… aber“, dafür auch keine Abgrenzung. Mit k = 3 bei
n = 5 kann das auch Varianz sein; als echte Rate verursacht es nach
`tutor-quality-verdict-v1` ein neues `fail`.

**Ergebnis:** Die Guidance-Änderung bringt den Prompt in Übereinstimmung mit
LearningQuestions 2.2, verbessert aber keinen gemessenen Befund und zeigt eine
mögliche neue Auffälligkeit. Für eine Merge-Entscheidung aus Qualitätssicht
reicht das nicht.

## 5. Was v3 gegenüber v4 zusätzlich bewirkte

Plausibel #142 zuzuordnen (v4 enthält den Guidance-Teil, v3 zusätzlich den
Rahmen): bessere DEEPEN-Transfer-Bewertung (`deepen-uses-transfer` 0/5 statt
2/5, keine Ist-Korrektur in zwei Samples) und die Abgrenzung des Ist-Zustands
bei EXPAND-Observation (`expand-sketch-grounding` 1/5 statt 3/5). Ebenso
plausibel #142 zuzuordnen: mehr Relativierung bei LEARN-strong (4/5) und die
`learn-hint-first`-Verschlechterung.

## 6. Prompt-unabhängige Befunde

Über alle drei Prompt-Varianten stabil:

- **`expand-observable-result` 16/16 fail.** Kein Feedback nennt die konkrete
  erwartete Beobachtung eines Vorschlags. Zugleich ist die Planner-Folgefrage
  nach jeder DEEPEN-/EXPAND-Antwort die Ist-Frage „Welche Ausgabe erzeugt
  Serial.println im aktuellen Sketch?“ (Fixture-Grenze P6). Der Dialog greift
  den Vorschlag damit an keiner Stelle auf.
- **Richtige, aber anders formulierte oder überschießende Antworten** werden in
  rund zwei Dritteln relativiert, unabhängig von Prompt-Regeln. Das Modell
  beurteilt Vollständigkeit anders als Judge-Fakten und Kriterien; die
  Einordnung passt dabei zum eigenen Rating.

Diese Befunde sind durch Prompttext bei diesem Modell nicht erreichbar.
Weitere Prompt-Varianten sind ohne neue Evidenz nicht der nächste Schritt.

## 7. Einschränkungen

n = 5 pro Case, ein Lauf je Variante; v1-Vergleichswerte mit n = 3 auf älteren
Corpus-Versionen; Relativierung und Ist-Einschub sind Handkodierung.
