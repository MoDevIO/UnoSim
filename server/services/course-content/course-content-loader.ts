import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { config } from "../../config";
import { ExamplesError } from "../examples/examples-error";
import { ExamplesLoadController, mapWithConcurrency } from "../examples/examples-load-controller";
import type { TextFetcher } from "../examples/http-provider";
import {
  courseContentTutorManifestSchema,
  parseCourseContentManifest,
  type CourseContentTutorManifest,
  type ExampleTutorBinding,
} from "./course-content-schema";
import {
  curriculumTopicSchema,
  validateCurriculumTopic,
  type CurriculumTopic,
} from "../tutor/curriculum/curriculum-schema";
import {
  effectiveTutorStrategySchema,
  type EffectiveTutorStrategy,
} from "../tutor/strategy/effective-tutor-strategy";
import type { ExampleRecord } from "../examples/examples-schema";
import type { FullCommitSha, RepositorySlug } from "@shared/examples";

export type TutorCapability =
  | { readonly status: "absent" }
  | { readonly status: "invalid"; readonly reason: string }
  | {
    readonly status: "valid";
    readonly manifest: CourseContentTutorManifest;
    readonly topics: readonly CurriculumTopic[];
    readonly strategies: readonly EffectiveTutorStrategy[];
    readonly bindings: ReadonlyMap<string, ExampleTutorBinding>;
  };

export interface LoadedCourseContentSnapshot {
  readonly examples: ExampleRecord[];
  readonly tutor: TutorCapability;
  readonly contentBytes: number;
}

export class CourseContentLoader {
  constructor(
    private readonly fetcher: TextFetcher,
    private readonly maxFileFetchConcurrency = config.examples.maxFileFetchConcurrency,
    private readonly loads?: ExamplesLoadController,
  ) {}

  async load(
    repository: RepositorySlug,
    revision: FullCommitSha,
    signal?: AbortSignal,
  ): Promise<LoadedCourseContentSnapshot> {
    const base = new URL(`${revision}/`, `https://raw.githubusercontent.com/${repository}/`);
    const manifestText = await this.fetcher.fetchText(new URL("manifest.json", base), config.examples.maxManifestBytes, signal);
    let decoded: unknown;
    try {
      decoded = JSON.parse(manifestText) as unknown;
    } catch {
      throw new ExamplesError("INVALID_SNAPSHOT", "External examples manifest is invalid");
    }
    const validation = parseCourseContentManifest(decoded);
    if (validation.examples.status !== "valid") {
      throw new ExamplesError("INVALID_SNAPSHOT", validation.examples.reason);
    }
    const manifest = validation.examples.manifest;
    const filesToLoad = manifest.examples.flatMap((exampleIndex, index) =>
      exampleIndex.files.map((file) => ({ exampleIndex: index, file })),
    );
    if (filesToLoad.length > config.examples.maxFiles) {
      throw new ExamplesError("INVALID_SNAPSHOT", "External examples exceed the file count limit");
    }
    const loaded = await this.map(filesToLoad, async ({ file }) => ({
      ...file,
      content: await this.fetcher.fetchText(relativeUrl(base, file.path), config.examples.maxFileBytes, signal),
    }));
    const examples = manifest.examples.map((example, exampleIndex) => ({
      ...example,
      files: filesToLoad
        .map((item, index) => ({ item, file: loaded[index] }))
        .filter(({ item }) => item.exampleIndex === exampleIndex)
        .map(({ file }) => file),
      source: "external" as const,
    }));
    const exampleBytes = examples.reduce(
      (total, example) => total + example.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0),
      0,
    );
    if (exampleBytes > config.examples.maxTotalBytes) {
      throw new ExamplesError("INVALID_SNAPSHOT", "External examples exceed the total size limit");
    }

    const tutor = validation.tutor.status === "valid"
      ? await this.loadTutor(base, validation.tutor.descriptor.manifest, validation.tutor.bindings, signal)
      : validation.tutor;
    const tutorBytes = tutor.status === "valid"
      ? tutor.topics.reduce((sum, topic) => sum + JSON.stringify(topic).length, 0)
        + tutor.strategies.reduce((sum, strategy) => sum + JSON.stringify(strategy).length, 0)
      : 0;
    if (exampleBytes + tutorBytes > config.examples.maxTotalBytes) {
      throw new ExamplesError("INVALID_SNAPSHOT", "Course Content exceeds the total size limit");
    }
    return { examples, tutor, contentBytes: exampleBytes + tutorBytes };
  }

  private async loadTutor(
    base: URL,
    descriptorPath: string,
    bindings: ReadonlyMap<string, ExampleTutorBinding>,
    signal?: AbortSignal,
  ): Promise<TutorCapability> {
    try {
      const manifestText = await this.fetcher.fetchText(relativeUrl(base, descriptorPath), config.examples.maxManifestBytes, signal);
      const manifestParsed = courseContentTutorManifestSchema.safeParse(parseSafeYaml(manifestText));
      if (!manifestParsed.success) throw new Error("Tutor manifest is invalid");
      const manifest = validateTutorManifest(manifestParsed.data);
      const topicEntries = await this.map(manifest.topics, async (entry) => {
        const source = await this.fetcher.fetchText(relativeUrl(base, entry.path), config.examples.maxFileBytes, signal);
        verifyDigest(source, entry.sha256, entry.id);
        const parsed = curriculumTopicSchema.safeParse(parseSafeYaml(source));
        if (!parsed.success || parsed.data.id !== entry.id) throw new Error(`Tutor topic is invalid: ${entry.id}`);
        return validateCurriculumTopic(parsed.data);
      });
      const strategies = await this.map(manifest.strategies, async (entry) => {
        const source = await this.fetcher.fetchText(relativeUrl(base, entry.path), config.examples.maxFileBytes, signal);
        verifyDigest(source, entry.sha256, entry.id);
        const parsed = effectiveTutorStrategySchema.safeParse(parseSafeYaml(source));
        if (!parsed.success || parsed.data.id !== entry.id) throw new Error(`Tutor strategy is invalid: ${entry.id}`);
        return parsed.data;
      });
      if (manifest.defaultStrategy !== undefined && !strategies.some(({ id }) => id === manifest.defaultStrategy)) {
        throw new Error("Tutor default strategy is not enumerated");
      }
      return { status: "valid", manifest, topics: topicEntries, strategies, bindings };
    } catch {
      return { status: "invalid", reason: "Tutor capability is invalid" };
    }
  }

  private map<T, R>(values: readonly T[], mapper: (value: T) => Promise<R>): Promise<R[]> {
    return mapWithConcurrency(values, this.maxFileFetchConcurrency, async (value) => {
      if (!this.loads) return mapper(value);
      return this.loads.runOutbound(() => mapper(value));
    });
  }
}

function validateTutorManifest(manifest: CourseContentTutorManifest): CourseContentTutorManifest {
  assertUnique(manifest.topics.map(({ id }) => id), "Tutor topic");
  assertUnique(manifest.strategies.map(({ id }) => id), "Tutor strategy");
  return manifest;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} id`);
}

function verifyDigest(source: string, expected: string, id: string): void {
  const actual = createHash("sha256").update(source, "utf8").digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Tutor hash mismatch: ${id}`);
}

function relativeUrl(base: URL, path: string): URL {
  const url = new URL(path.split("/").map(encodeURIComponent).join("/"), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new Error("Course Content path escaped revision root");
  return url;
}

function parseSafeYaml(source: string): unknown {
  if (containsYamlTag(source)) throw new Error("YAML tags are not allowed");
  return parseYaml(source, { schema: "core", uniqueKeys: true });
}

function containsYamlTag(source: string): boolean {
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "!") continue;
    const previous = source[index - 1];
    if (previous !== undefined && !/\s|,|:|\{|\}|\[|\]/.test(previous)) continue;
    const next = source[index + 1];
    if (next === "!" || next === "<" || (next !== undefined && /[A-Za-z]/.test(next))) return true;
  }
  return false;
}
