import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { createAnchorCourseContent, ANCHOR_COURSE_CONTENT_FIXTURE_IDS, type AnchorCourseContentFixtureId } from "../server/services/tutor/evaluation/anchor-course-content";
import {
  parseTutorQualityCorpus,
  type TutorQualityCorpusSource,
  type TutorQualityHistoryEntrySource,
  type TutorQualityTurnSource,
} from "../server/services/tutor/evaluation/anchor-corpus";
import {
  runTutorQualityEvaluation,
  type TutorQualityEvaluationScenario,
  type TutorQualityGitState,
  type TutorQualityTurn,
} from "../server/services/tutor/evaluation/real-provider-evaluation";
import { KiconnectProvider } from "../server/services/tutor/kiconnect-provider";
import type { LLMProvider } from "../server/services/tutor/llm-provider";

export interface TutorQualityCliOptions {
  readonly model: string;
  readonly samples: number;
  readonly maxCalls: number;
  readonly outputDir: string;
  readonly corpusPath: string;
  readonly credentialEnv: string;
}

export interface TutorQualityCliDependencies {
  readonly cwd?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly provider?: LLMProvider;
  readonly git?: TutorQualityGitState;
}

const DEFAULT_CORPUS_PATH = "evals/tutor-quality/anchor-corpus.yaml";
const DEFAULT_CREDENTIAL_ENV = "UNOSIM_TUTOR_EVAL_CREDENTIAL";

function readArgument(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInteger(value: string, flag: string, allowZero = false): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1)) throw new Error(`${flag} is out of range`);
  return parsed;
}

function parseCredentialEnvironmentName(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(value)) throw new Error("--credential-env must be an environment-variable name");
  return value;
}

export function parseTutorQualityCliArgs(argv: readonly string[]): TutorQualityCliOptions {
  let model: string | undefined;
  let samples = 1;
  let maxCalls = 20;
  let outputDir: string | undefined;
  let corpusPath = DEFAULT_CORPUS_PATH;
  let credentialEnv = DEFAULT_CREDENTIAL_ENV;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--model":
        model = readArgument(argv, index, flag);
        index += 1;
        break;
      case "--samples":
        samples = parsePositiveInteger(readArgument(argv, index, flag), flag);
        index += 1;
        break;
      case "--max-calls":
        maxCalls = parsePositiveInteger(readArgument(argv, index, flag), flag, true);
        index += 1;
        break;
      case "--output-dir":
        outputDir = readArgument(argv, index, flag);
        index += 1;
        break;
      case "--corpus":
        corpusPath = readArgument(argv, index, flag);
        index += 1;
        break;
      case "--credential-env":
        credentialEnv = parseCredentialEnvironmentName(readArgument(argv, index, flag));
        index += 1;
        break;
      default:
        throw new Error(`Unknown Tutor Quality evaluation option: ${flag}`);
    }
  }
  if (!model || model === "auto") throw new Error("--model requires a fixed model id; auto is not allowed");
  if (!outputDir) throw new Error("--output-dir is required");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) throw new Error("--model is invalid");
  return { model, samples, maxCalls, outputDir, corpusPath, credentialEnv };
}

function historyEntry(entry: TutorQualityHistoryEntrySource): import("../shared/tutor").TutorDialogTurn {
  return {
    question: entry.question,
    answer: entry.answer ?? "synthetic scripted history",
    responseStyle: entry.responseStyle ?? "normal",
    ...(entry.answerRating === undefined ? {} : { answerRating: entry.answerRating }),
    ...(entry.questionId === undefined ? {} : { questionId: entry.questionId }),
  };
}

function materializeTurn(turn: TutorQualityTurnSource): TutorQualityTurn {
  if (turn.kind === "initial") return turn;
  return {
    ...turn,
    ...(turn.history === undefined ? {} : { history: turn.history.map(historyEntry) }),
  };
}

export async function loadTutorQualityEvaluationScenarios(
  cwd: string,
  corpusPath: string,
): Promise<readonly TutorQualityEvaluationScenario[]> {
  const manifestPath = path.resolve(cwd, corpusPath);
  const source = parseYaml(await readFile(manifestPath, "utf8")) as TutorQualityCorpusSource;
  const sketchRefs = new Set<string>();
  for (const { sketch } of source.scenarios) {
    try {
      await access(path.resolve(cwd, sketch));
      sketchRefs.add(sketch);
    } catch {
      // Keep the reference absent so the corpus validator reports the contract error.
    }
  }
  const courseContentFixtures = new Set<string>(ANCHOR_COURSE_CONTENT_FIXTURE_IDS);
  const corpus = parseTutorQualityCorpus(source, { sketches: sketchRefs, courseContentFixtures });
  return Promise.all(corpus.scenarios.map(async (scenario) => ({
    id: scenario.id,
    corpusId: corpus.corpusId,
    corpusVersion: corpus.corpusVersion,
    sketchRef: scenario.sketch,
    sketch: await readFile(path.resolve(cwd, scenario.sketch), "utf8"),
    ...(scenario.courseContent === "free"
      ? {}
      : { courseContent: createAnchorCourseContent(scenario.courseContent as AnchorCourseContentFixtureId) }),
    turns: scenario.turns.map(materializeTurn),
    ...(scenario.expected === undefined ? {} : { expected: scenario.expected }),
  })));
}

function statusLines(cwd: string): readonly string[] {
  const output = execFileSync("git", ["status", "--porcelain=v1", "-uall"], { cwd, encoding: "utf8" });
  return output.split("\n").map((line) => line.trimEnd()).filter(Boolean);
}

export function isTutorQualityRelevantUntrackedPath(relativePath: string, outputDir: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const normalizedOutput = outputDir.replaceAll("\\", "/").replace(/\/$/, "");
  if (normalizedOutput && (normalized === normalizedOutput || normalized.startsWith(`${normalizedOutput}/`))) return false;
  return normalized.startsWith("evals/tutor-quality/")
    || normalized.startsWith("server/")
    || normalized.startsWith("shared/")
    || normalized.startsWith("scripts/")
    || ["package.json", "package-lock.json", ".nvmrc"].includes(normalized);
}

export function readTutorQualityGitState(cwd: string, outputDir: string): TutorQualityGitState {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const lines = statusLines(cwd);
  const trackedClean = lines.every((line) => line.slice(0, 2) === "??");
  const outputRelative = path.relative(cwd, path.resolve(cwd, outputDir));
  const relevantUntrackedClean = lines.every((line) => {
    if (line.slice(0, 2) !== "??") return true;
    return !isTutorQualityRelevantUntrackedPath(line.slice(3).trim(), outputRelative);
  });
  return { sha, trackedClean, relevantUntrackedClean };
}

export async function runTutorQualityCli(
  argv: readonly string[],
  dependencies: TutorQualityCliDependencies = {},
) {
  const options = parseTutorQualityCliArgs(argv);
  const cwd = dependencies.cwd ?? process.cwd();
  const environment = dependencies.environment ?? process.env;
  const scenarios = await loadTutorQualityEvaluationScenarios(cwd, options.corpusPath);
  const git = dependencies.git ?? readTutorQualityGitState(cwd, options.outputDir);
  const provider = dependencies.provider ?? new KiconnectProvider();
  const timeoutMs = Number(environment.UNOSIM_LLM_TIMEOUT_MS ?? 30_000);
  const credential = environment[options.credentialEnv];
  return runTutorQualityEvaluation({
    scenarios,
    provider,
    providerId: "kiconnect",
    endpointOrigin: environment.UNOSIM_LLM_BASE_URL ? new URL(environment.UNOSIM_LLM_BASE_URL).origin : undefined,
    ...(credential ? { credential } : {}),
    requestedModel: options.model,
    samples: options.samples,
    maxCalls: options.maxCalls,
    timeoutMs,
    temperature: 0.2,
    outputDir: path.resolve(cwd, options.outputDir),
    git,
  });
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  runTutorQualityCli(process.argv.slice(2))
    .then(({ report }) => {
      console.log(JSON.stringify({ runId: report.runId, runStatus: report.runStatus, reason: report.reason, providerCalls: report.providerCalls }));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Tutor Quality evaluation failed");
      process.exitCode = 1;
    });
}
