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
} from "./course-content-schema";
import {
  extractEmbeddedTutorAnnotation,
  type ExampleTutorAnnotation,
} from "./embedded-tutor-annotation";
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
  };

export interface LoadedCourseContentSnapshot {
  readonly examples: ExampleRecord[];
  readonly tutor: TutorCapability;
  readonly exampleTutorAnnotations: ReadonlyMap<string, ExampleTutorAnnotation>;
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
    const exampleTutorAnnotations = new Map<string, ExampleTutorAnnotation>();
    let invalidEmbeddedAnnotation = false;
    const examples = manifest.examples.map((example, exampleIndex) => {
      const files = filesToLoad
        .map((item, index) => ({ item, file: loaded[index] }))
        .filter(({ item }) => item.exampleIndex === exampleIndex)
        .map(({ file }) => {
          const annotation = extractEmbeddedTutorAnnotation(file.content, file.name, { isMainFile: file.name === example.main });
          if (annotation.status === "invalid") invalidEmbeddedAnnotation = true;
          if (annotation.status === "valid" && file.name === example.main) {
            exampleTutorAnnotations.set(example.id, annotation.annotation);
          }
          return annotation.status === "absent" ? file : { ...file, content: annotation.cleanedSource };
        });
      const tutorAnnotation = exampleTutorAnnotations.get(example.id);
      return {
        ...example,
        files,
        source: "external" as const,
        ...(tutorAnnotation ? { tutorAnnotation } : {}),
      };
    });
    const exampleBytes = examples.reduce(
      (total, example) => total + example.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0),
      0,
    );
    if (exampleBytes > config.examples.maxTotalBytes) {
      throw new ExamplesError("INVALID_SNAPSHOT", "External examples exceed the total size limit");
    }

    const tutor = invalidEmbeddedAnnotation
      ? { status: "invalid" as const, reason: "Tutor capability is invalid" }
      : validation.tutor.status === "valid"
        ? await this.loadTutor(base, validation.tutor.descriptor.manifest, exampleTutorAnnotations, signal)
        : validation.tutor;
    const activeAnnotations = tutor.status === "invalid" ? new Map<string, ExampleTutorAnnotation>() : exampleTutorAnnotations;
    const tutorBytes = tutor.status === "valid"
      ? tutor.topics.reduce((sum, topic) => sum + JSON.stringify(topic).length, 0)
        + tutor.strategies.reduce((sum, strategy) => sum + JSON.stringify(strategy).length, 0)
      : 0;
    if (exampleBytes + tutorBytes > config.examples.maxTotalBytes) {
      throw new ExamplesError("INVALID_SNAPSHOT", "Course Content exceeds the total size limit");
    }
    return { examples, tutor, exampleTutorAnnotations: activeAnnotations, contentBytes: exampleBytes + tutorBytes };
  }

  private async loadTutor(
    base: URL,
    descriptorPath: string,
    annotations: ReadonlyMap<string, ExampleTutorAnnotation>,
    signal?: AbortSignal,
  ): Promise<TutorCapability> {
    try {
      const manifestText = await this.fetcher.fetchText(relativeUrl(base, descriptorPath), config.examples.maxManifestBytes, signal);
      const manifestParsed = courseContentTutorManifestSchema.safeParse(parseSafeYaml(manifestText));
      if (!manifestParsed.success) throw new Error("Tutor manifest is invalid");
      const manifest = validateTutorManifest(manifestParsed.data);
      const topicEntries = await this.loadTopics(base, manifest, signal);
      const strategies = await this.loadStrategies(base, manifest, signal);
      validateTutorReferences(manifest, topicEntries, strategies, annotations);
      return { status: "valid", manifest, topics: topicEntries, strategies };
    } catch {
      return { status: "invalid", reason: "Tutor capability is invalid" };
    }
  }

  private loadTopics(
    base: URL,
    manifest: CourseContentTutorManifest,
    signal?: AbortSignal,
  ): Promise<CurriculumTopic[]> {
    return this.map(manifest.topics, async (entry) => {
      const source = await this.fetcher.fetchText(relativeUrl(base, entry.path), config.examples.maxFileBytes, signal);
      verifyDigest(source, entry.sha256, entry.id);
      const parsed = curriculumTopicSchema.safeParse(parseSafeYaml(source));
      if (!parsed.success || parsed.data.id !== entry.id) throw new Error(`Tutor topic is invalid: ${entry.id}`);
      return validateCurriculumTopic(parsed.data);
    });
  }

  private loadStrategies(
    base: URL,
    manifest: CourseContentTutorManifest,
    signal?: AbortSignal,
  ): Promise<EffectiveTutorStrategy[]> {
    return this.map(manifest.strategies, async (entry) => {
      const source = await this.fetcher.fetchText(relativeUrl(base, entry.path), config.examples.maxFileBytes, signal);
      verifyDigest(source, entry.sha256, entry.id);
      const parsed = effectiveTutorStrategySchema.safeParse(parseSafeYaml(source));
      if (!parsed.success || parsed.data.id !== entry.id) throw new Error(`Tutor strategy is invalid: ${entry.id}`);
      return parsed.data;
    });
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

function validateTutorReferences(
  manifest: CourseContentTutorManifest,
  topics: readonly CurriculumTopic[],
  strategies: readonly EffectiveTutorStrategy[],
  annotations: ReadonlyMap<string, ExampleTutorAnnotation>,
): void {
  if (manifest.defaultStrategy !== undefined && !strategies.some(({ id }) => id === manifest.defaultStrategy)) {
    throw new Error("Tutor default strategy is not enumerated");
  }
  const topicIds = new Set(topics.map(({ id }) => id));
  const strategyIds = new Set(strategies.map(({ id }) => id));
  for (const annotation of annotations.values()) {
    validateAnnotationTopics(annotation, topicIds);
    if (annotation.strategy !== undefined && !strategyIds.has(annotation.strategy)) {
      throw new Error(`Tutor annotation references unknown strategy: ${annotation.strategy}`);
    }
  }
}

function validateAnnotationTopics(annotation: ExampleTutorAnnotation, topicIds: ReadonlySet<string>): void {
  for (const topicId of annotation.topics ?? []) {
    if (!topicIds.has(topicId)) throw new Error(`Tutor annotation references unknown topic: ${topicId}`);
  }
  if (annotation.primaryTopic !== undefined && !topicIds.has(annotation.primaryTopic)) {
    throw new Error(`Tutor annotation references unknown primary topic: ${annotation.primaryTopic}`);
  }
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
