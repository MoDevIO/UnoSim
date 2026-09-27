import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { FullCommitSha, RepositorySlug } from "@shared/examples";
import { CourseContentLoader } from "./course-content-loader";
import { tutorQualityCasesSchema } from "./tutor-quality-schema";
import type { LoadedCourseContentSnapshot } from "./course-content-loader";
import { BUILT_IN_TUTOR_STRATEGY, type EffectiveTutorStrategy } from "../tutor/strategy/effective-tutor-strategy";
import {
  validateTutorContentQuality,
  type ResolvedTutorQualityCase,
  type TutorContentQualityIssue,
} from "./tutor-quality-validator";

const LOCAL_REVISION = "0".repeat(40) as FullCommitSha;
const LOCAL_REPOSITORY = "local/course-content" as RepositorySlug;

export async function validateTutorCourseContentDirectory(directory: string): Promise<TutorContentQualityIssue[]> {
  const root = path.resolve(directory);
  let loaded: Awaited<ReturnType<CourseContentLoader["load"]>>;
  try {
    const loader = new CourseContentLoader({
      fetchText: async (url, maxBytes) => readBoundedLocalFile(root, url, maxBytes),
    });
    loaded = await loader.load(LOCAL_REPOSITORY, LOCAL_REVISION);
  } catch {
    return [directoryIssue("invalid-course-content-bundle", "Course Content bundle could not be loaded")];
  }
  if (loaded.tutor.status !== "valid") {
    return [directoryIssue("invalid-course-content-bundle", "Course Content Tutor bundle is absent or invalid")];
  }
  try {
    const qualitySource = await readFile(path.join(root, "tutor/quality-cases.yaml"), "utf8");
    const parsed = tutorQualityCasesSchema.safeParse(parseYaml(qualitySource));
    if (!parsed.success) {
      return [directoryIssue("invalid-quality-cases", "Tutor quality case manifest is invalid")];
    }
    const resolution = resolveCases(parsed.data.cases, loaded);
    if (resolution.issues.length > 0) return resolution.issues;
    return validateTutorContentQuality(loaded.tutor.topics, resolution.cases);
  } catch {
    return [directoryIssue("invalid-quality-cases", "Tutor quality case manifest could not be loaded")];
  }
}

async function readBoundedLocalFile(root: string, url: URL, maxBytes: number): Promise<string> {
  const revisionMarker = `/${LOCAL_REVISION}/`;
  const markerIndex = url.pathname.indexOf(revisionMarker);
  if (markerIndex < 0) throw new Error("Invalid local Course Content URL");
  const relativePath = decodeURIComponent(url.pathname.slice(markerIndex + revisionMarker.length));
  const filePath = path.resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) throw new Error("Path escapes Course Content root");
  const source = await readFile(filePath, "utf8");
  if (Buffer.byteLength(source, "utf8") > maxBytes) throw new Error("Course Content file exceeds size limit");
  return source;
}

function resolveCases(
  cases: readonly { id: string; example: string; expectedTopics: readonly string[]; forbiddenTopics: readonly string[] }[],
  loaded: LoadedCourseContentSnapshot,
): { cases: ResolvedTutorQualityCase[]; issues: TutorContentQualityIssue[] } {
  const resolved: ResolvedTutorQualityCase[] = [];
  const issues: TutorContentQualityIssue[] = [];
  for (const qualityCase of cases) {
    const example = loaded.examples.find(({ id }) => id === qualityCase.example);
    const main = example?.files.find(({ name }) => name === example.main);
    if (!example || !main) {
      issues.push({
        code: "quality-case-example-not-found",
        message: `Quality case ${qualityCase.id} references missing Example ${qualityCase.example}`,
        caseId: qualityCase.id,
      });
      continue;
    }
    resolved.push({
      id: qualityCase.id,
      exampleId: qualityCase.example,
      code: main.content,
      expectedTopics: qualityCase.expectedTopics,
      forbiddenTopics: qualityCase.forbiddenTopics,
      learnStrategy: resolveCaseStrategy(loaded, example.tutorAnnotation?.strategy, "LEARN"),
      deepenStrategy: resolveCaseStrategy(loaded, example.tutorAnnotation?.strategy, "DEEPEN"),
    });
  }
  return { cases: resolved, issues };
}

function resolveCaseStrategy(
  loaded: LoadedCourseContentSnapshot,
  exampleStrategyId: string | undefined,
  phase: "LEARN" | "DEEPEN",
): EffectiveTutorStrategy {
  if (loaded.tutor.status !== "valid") return BUILT_IN_TUTOR_STRATEGY;
  const perExample = loaded.tutor.strategies.find(({ id }) => id === exampleStrategyId);
  if (perExample) return perExample;
  const manifest = loaded.tutor.manifest;
  const phaseStrategyId = phase === "DEEPEN" && manifest.schemaVersion === 2
    ? manifest.phaseStrategies?.deepen
    : undefined;
  const strategyId = phaseStrategyId ?? manifest.defaultStrategy;
  return loaded.tutor.strategies.find(({ id }) => id === strategyId) ?? BUILT_IN_TUTOR_STRATEGY;
}

function directoryIssue(
  code: "invalid-course-content-bundle" | "invalid-quality-cases",
  message: string,
): TutorContentQualityIssue {
  return { code, message };
}
