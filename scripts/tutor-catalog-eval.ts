/**
 * Runs the Tutor over every Example of a local Course Content directory with a simulated student and
 * reports deterministic findings (types the sketch does not use, repeated questions, focus order,
 * hand-over to the free Tutor). This makes real provider calls; it is not part of the test suite.
 *
 *   set -a; . ./.env.local; set +a
 *   npx tsx scripts/tutor-catalog-eval.ts --examples ../UnoSim-Examples --max-calls 150
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CourseContentLoader } from "../server/services/course-content/course-content-loader";
import { CurriculumTutorAdapter } from "../server/services/tutor/curriculum-tutor-adapter";
import { createTutorProgressionState } from "../server/services/tutor/curriculum/progression-state";
import { analyzeCatalogSession, type CatalogIssue, type CatalogTurn } from "../server/services/tutor/evaluation/catalog-checks";
import { KiconnectProvider } from "../server/services/tutor/kiconnect-provider";
import type { LLMProvider, StructuredLLMProvider } from "../server/services/tutor/llm-provider";
import { TutorService } from "../server/services/tutor/tutor-service";
import type { TutorContentResult, TutorDialogTurn } from "../shared/tutor";

const REVISION = "0".repeat(40);
const REPOSITORY = "local/course-content";

interface Options {
  readonly examples: string;
  readonly model: string;
  readonly turns: number;
  readonly maxCalls: number;
  readonly only: readonly string[];
  readonly out: string;
  readonly credentialEnv: string;
}

function parseOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index] ?? "", argv[index + 1] ?? "");
  return {
    examples: path.resolve(values.get("--examples") ?? "../UnoSim-Examples"),
    model: values.get("--model") ?? "openai-gpt5.4-mini",
    turns: Number(values.get("--turns") ?? 4),
    maxCalls: Number(values.get("--max-calls") ?? 150),
    only: (values.get("--only") ?? "").split(",").filter(Boolean),
    out: path.resolve(values.get("--out") ?? "temp/tutor-catalog-eval"),
    credentialEnv: values.get("--credential-env") ?? "UNOSIM_TUTOR_EVAL_CREDENTIAL",
  };
}

class BudgetExceeded extends Error {}

/** Counts completions only; model listing is cached and free of budget. */
class CountingProvider implements LLMProvider {
  calls = 0;
  private models: Promise<readonly string[]> | undefined;
  constructor(private readonly inner: KiconnectProvider, private readonly maxCalls: number) {}

  listModels(credential: string, signal?: AbortSignal): Promise<readonly string[]> {
    this.models ??= this.inner.listModels(credential, signal);
    return this.models;
  }

  async generateLearningQuestion(...args: Parameters<LLMProvider["generateLearningQuestion"]>) {
    this.count();
    return this.inner.generateLearningQuestion(...args);
  }

  async student(request: Parameters<StructuredLLMProvider["generateStructuredResponse"]>[0], credential: string) {
    this.count();
    return this.inner.generateStructuredResponse(request, credential);
  }

  private count(): void {
    if (this.calls >= this.maxCalls) throw new BudgetExceeded(`call budget of ${this.maxCalls} reached`);
    this.calls += 1;
  }
}

async function readLocal(root: string, url: URL): Promise<string> {
  const marker = `/${REVISION}/`;
  const index = url.pathname.indexOf(marker);
  if (index < 0) throw new Error("invalid local URL");
  const file = path.resolve(root, decodeURIComponent(url.pathname.slice(index + marker.length)));
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error("path escapes root");
  return readFile(file, "utf8");
}

const PERSONAS = ["strong", "wrong", "strong", "wrong"] as const;

async function studentAnswer(
  provider: CountingProvider,
  options: Options,
  credential: string,
  input: { code: string; question: string; persona: typeof PERSONAS[number] },
): Promise<string> {
  const style = input.persona === "strong"
    ? "Du antwortest fachlich korrekt, knapp und in eigenen Worten."
    : "Du antwortest selbstsicher, aber inhaltlich falsch, weil du einer typischen Fehlvorstellung folgst.";
  const { result } = await provider.student({
    model: options.model,
    temperature: 0.7,
    systemPrompt: `Du bist Studierende:r im ersten Semester Informatik und beantwortest Tutorfragen zu einem Arduino-Sketch. ${style} Antworte auf Deutsch in höchstens drei Sätzen. Gib ausschließlich JSON der Form {"answer": "..."} zurück.`,
    userPrompt: `Sketch:\n${input.code}\n\nFrage des Tutors:\n${input.question}`,
  }, credential);
  const answer = (result as { answer?: unknown } | null)?.answer;
  if (typeof answer !== "string" || answer.trim() === "") throw new Error("student returned no answer");
  return answer.trim();
}

interface ExampleReport {
  readonly id: string;
  readonly turns: readonly (CatalogTurn & { readonly answer?: string; readonly rating?: number })[];
  readonly issues: readonly CatalogIssue[];
}

function metadata(result: TutorContentResult) {
  const { topicId, conceptId, questionId, indicatorId, questionKind } = result;
  return { topicId, conceptId, questionId, indicatorId, questionKind };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const credential = process.env[options.credentialEnv];
  if (!credential) throw new Error(`Environment variable ${options.credentialEnv} is not set`);

  const loaded = await new CourseContentLoader({ fetchText: async (url) => readLocal(options.examples, url) }).load(REPOSITORY, REVISION);
  if (loaded.tutor.status !== "valid") throw new Error("Course Content Tutor bundle is not valid");

  const provider = new CountingProvider(new KiconnectProvider(), options.maxCalls);
  const reports: ExampleReport[] = [];
  const examples = loaded.examples.filter(({ id }) => options.only.length === 0 || options.only.includes(id));

  for (const example of examples) {
    const main = example.files.find(({ name }) => name === example.main);
    if (!main) continue;
    const annotation = example.tutorAnnotation;
    const context = {
      revision: REVISION,
      tutor: loaded.tutor,
      exampleId: example.id,
      ...(annotation ? { exampleTutorAnnotation: annotation } : {}),
      progressionState: createTutorProgressionState(REVISION),
    };
    const service = new TutorService(provider, new CurriculumTutorAdapter());
    const turns: ExampleReport["turns"][number][] = [];
    const history: TutorDialogTurn[] = [];
    try {
      const first = await service.generateQuestion(main.content, credential, options.model, undefined, context);
      turns.push({ question: first.result.question ?? "", followUpSource: first.followUpSource });
      let current = { question: first.result.question ?? "", meta: metadata(first.result) };
      for (let turn = 0; turn < options.turns; turn += 1) {
        const persona = PERSONAS[turn % PERSONAS.length] ?? "strong";
        const answer = await studentAnswer(provider, options, credential, { code: main.content, question: current.question, persona });
        const response = await service.generateDialogResponse(main.content, history, current.question, answer, credential, options.model, undefined, context);
        const result = response.result;
        history.push({
          question: current.question,
          answer,
          ...(result.feedback ? { feedback: result.feedback } : {}),
          ...(result.answerRating !== undefined ? { answerRating: result.answerRating } : {}),
          responseStyle: "normal",
          ...Object.fromEntries(Object.entries(current.meta).filter(([, value]) => value !== undefined)),
        } as TutorDialogTurn);
        turns.push({
          question: result.question ?? "",
          ...(result.feedback ? { feedback: result.feedback } : {}),
          followUpSource: response.followUpSource,
          answer,
          ...(result.answerRating !== undefined ? { rating: result.answerRating } : {}),
        });
        current = { question: result.question ?? "", meta: metadata(result) };
      }
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        console.error(error.message);
        break;
      }
      const issue: CatalogIssue = { code: "provider-error", turn: turns.length, details: error instanceof Error ? error.message : String(error) };
      reports.push({ id: example.id, turns, issues: [issue] });
      continue;
    }
    // Areas are asked in order; within an area the strategy picks the question by kind.
    const focusQuestions = annotation?.focus?.[0]?.questions.map(({ text }) => text) ?? [];
    reports.push({
      id: example.id,
      turns,
      issues: analyzeCatalogSession({ code: main.content, turns, focusQuestions }),
    });
    console.error(`${example.id}: ${turns.length} turns, ${reports.at(-1)?.issues.length ?? 0} issues (calls ${provider.calls})`);
  }

  await mkdir(options.out, { recursive: true });
  await writeFile(path.join(options.out, "report.json"), JSON.stringify({ model: options.model, calls: provider.calls, reports }, null, 2));
  const lines = reports.map((report) => `${report.id}: ${report.issues.length === 0 ? "ok" : report.issues.map(({ code, turn }) => `${code}@${turn}`).join(", ")}`);
  await writeFile(path.join(options.out, "summary.txt"), `${lines.join("\n")}\ncalls: ${provider.calls}\n`);
  console.log(lines.join("\n"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
