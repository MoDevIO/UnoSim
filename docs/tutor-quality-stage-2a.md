# Tutor Quality Stage 2A – Real-Provider Evaluation

Stage 2A is an explicitly invoked observation run. It uses the versioned
anchor corpus and the normal `TutorService`/`KiconnectProvider` path. It does
not run in unit tests or pull-request gates and does not measure learning
effect or assign semantic quality scores.

## Local run

Use a clean relevant Git state, a fixed model ID, and a caller-selected
disposable output directory:

```sh
npm run eval:tutor-quality:real -- \
  --model <fixed-model-id> \
  --credential-env UNOSIM_TUTOR_EVAL_CREDENTIAL \
  --samples 2 \
  --max-calls 30 \
  --output-dir /tmp/unosim-tutor-quality-stage-2a
```

The credential is read from the named environment variable only. Never pass a
credential value as a command-line argument. The runner never writes the
credential, authorization headers, or `process.env` to an artifact.

The call budget includes model-list and generation calls. The report exposes
both categories separately. If the credential is absent, the command writes a
run-level `report.json` with `runStatus: "not-run"`,
`reason: "missing-credential"`, zero provider calls, and no sample
transcripts.

Each invocation is bounded to at most 20 samples per scenario and 500 total
provider calls. The CLI rejects larger values before any provider call.

## Artifacts

`report.json` contains the run identity, corpus/course/prompt/provider/model
metadata, explicit status counts and rates, provider-call counts, and per-
scenario aggregates. One allow-listed JSON transcript is written per sample
when execution starts. Transcripts retain synthetic inputs, Tutor request
prompts, parsed provider results before service validation/repair, normalized
Tutor results, state snapshots, deterministic checks, and technical errors.

`completed` observations may still contain deterministic invariant violations;
technical failures and invalid evaluation metadata remain separate categories.
Generated output is disposable and must not be committed.

## Scope boundary

Stage 2A reports schema/response validity, question-count and complete-solution
guards, bounded question-repeat checks, application-owned planning/state
consistency, provider failures, and execution counts. It deliberately does
not judge clarity, scaffolding quality, difficulty, learning support, or
learning progress. Those require the Stage 2B semantic and human-calibration
workflows.
