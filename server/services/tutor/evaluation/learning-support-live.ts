import { tutorModelSchema } from "@shared/tutor";

/**
 * Options and outcome rules of the live learning-support evaluation (scripts/tutor-learning-support-live.ts,
 * TutorQualityEvaluation 15). Kept apart from the script so that the evidence logic itself is tested.
 */

export const MAX_LIVE_SAMPLES = 10;

export interface LiveEvaluationOptions {
  readonly samples: number;
  readonly model: string;
  readonly outputDir: string;
  readonly credentialEnv: string;
}

type MutableOptions = { -readonly [K in keyof LiveEvaluationOptions]?: LiveEvaluationOptions[K] };

/** Checks one option and stores it; every value is checked, nothing is clamped. */
const OPTION_PARSERS: ReadonlyMap<string, (value: string, options: MutableOptions) => void> = new Map(Object.entries({
  "--samples": (value: string, options: MutableOptions) => {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_LIVE_SAMPLES) {
      throw new Error(`--samples must be an integer from 1 to ${MAX_LIVE_SAMPLES}`);
    }
    options.samples = Number(value);
  },
  "--model": (value: string, options: MutableOptions) => {
    if (!tutorModelSchema.safeParse(value).success) throw new Error("--model is not a valid model identifier");
    options.model = value;
  },
  "--output-dir": (value: string, options: MutableOptions) => { options.outputDir = value; },
  "--credential-env": (value: string, options: MutableOptions) => {
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(value)) throw new Error("--credential-env must be an environment-variable name");
    options.credentialEnv = value;
  },
}));

/** Strict command line: every value is checked, nothing is silently clamped or defaulted to a pass. */
export function parseLiveEvaluationOptions(argv: readonly string[]): LiveEvaluationOptions {
  if (argv.length % 2 !== 0) throw new Error("Every option requires a value");
  const options: MutableOptions = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]!;
    const parse = OPTION_PARSERS.get(flag);
    if (!parse) throw new Error(`Unknown option ${flag}`);
    parse(argv[index + 1]!, options);
  }
  if (!options.outputDir) throw new Error("--output-dir is required");
  return { samples: options.samples ?? 3, model: options.model ?? "auto", outputDir: options.outputDir, credentialEnv: options.credentialEnv ?? "UNOSIM_TUTOR_EVAL_CREDENTIAL" };
}

export type LiveCheck = { readonly id: string; readonly layer: "application" | "model"; readonly passed: boolean; readonly detail: string };

/** One requested sample: its checks, or why it could not be evaluated. */
export type LiveSampleResult =
  | { readonly kind: "completed"; readonly checks: readonly LiveCheck[] }
  | { readonly kind: "technical"; readonly failure: string };

export type LiveOutcome = "pass" | "fail" | "inconclusive";

/**
 * `fail` as soon as one completed sample has a failed application check. `pass` only when every requested
 * sample completed with at least one application check and all of them passed. Anything else, such as a
 * provider error or no completed sample at all, is `inconclusive`. Model checks never decide the outcome.
 */
export function decideLiveOutcome(requested: number, results: readonly LiveSampleResult[]): LiveOutcome {
  const completed = results.filter((result): result is Extract<LiveSampleResult, { kind: "completed" }> => result.kind === "completed");
  const application = (result: (typeof completed)[number]) => result.checks.filter(({ layer }) => layer === "application");
  if (completed.some((result) => application(result).some(({ passed }) => !passed))) return "fail";
  const allCompleted = requested > 0 && results.length === requested && completed.length === requested;
  return allCompleted && completed.every((result) => application(result).length > 0) ? "pass" : "inconclusive";
}

export const LIVE_EXIT_CODES: Readonly<Record<LiveOutcome, number>> = { pass: 0, fail: 2, inconclusive: 3 };
