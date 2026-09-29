# Stage-2B Semantic Case Review Matrix

The cases below are reserved Stage-2B intents, not executable Semantic Corpus
records. They become executable only after the exact sketch, frozen question,
answer binding, ordered history, declared application context, allowed
evidence, and human-reviewed interpretation are pinned. All initial observed
cases are known/exposed development material; none is Gold or held out.

| Case | Required pinned inputs and review | Current status |
| --- | --- | --- |
| `TQ-SEM-002` — `millis()` / `delay()` | Exact timing sketch; exact preceding question and correct answer; complete bounded turn order; phase/difficulty; reviewed timing facts and a human-defined range for a genuinely new non-blocking reasoning demand. | Reserved intent only; not executable. |
| `TQ-SEM-003` — `lastReport` | Exact declaration, assignments, and use; preceding question/answer/history; application context and difficulty; reviewed distinction between stored timestamp and elapsed duration. | Reserved intent only; not executable. |
| `TQ-SEM-004` — `unsigned long`, `millis()`, overflow | Exact type declaration and uses; ordered timing questions and answers; phase/Strategy/difficulty; reviewed return/type/wraparound facts and acceptable transfer beyond prior reasoning. | Reserved intent only; not executable. |
| `TQ-SEM-005` — matrix `int` versus `byte` | Exact matrix declaration, indexing, and use; preceding question/answer/history; Course Content/Strategy context or explicit absence; reviewed platform type/range facts and interpretation of the actual learner misconception. | Reserved intent only; not executable. |

No case details are inferred from these names. Adding any case or changing its
evidence/reference is a Semantic Corpus version change. Candidate-specific
exposure remains a separate `CaseExposureRecord`, never a corpus field.
