import { parse as parseYaml } from "yaml";
import {
  curriculumManifestSchema,
  curriculumTopicSchema,
  validateCurriculumManifest,
  validateCurriculumTopic,
  type CurriculumManifest,
  type CurriculumTopic,
} from "./curriculum-schema";

/** Test-only compatibility port for the pre-unified curriculum fixtures. */
export interface DidacticContentSnapshot {
  readonly revision: string;
  readonly manifest: CurriculumManifest;
  readonly topics: readonly CurriculumTopic[];
  readonly stale: boolean;
}

export interface DidacticContentRepository {
  getSnapshot(): Promise<DidacticContentSnapshot | null>;
}

/** Static data is retained for deterministic unit tests; production uses CourseContentLoader. */
export class StaticDidacticContentRepository implements DidacticContentRepository {
  constructor(private readonly snapshot: DidacticContentSnapshot | null) {}

  async getSnapshot(): Promise<DidacticContentSnapshot | null> {
    return this.snapshot;
  }
}

export function parseManifest(source: string): CurriculumManifest {
  const parsed = curriculumManifestSchema.safeParse(parseSafeYaml(source));
  if (!parsed.success) throw new Error("Invalid curriculum manifest");
  return validateCurriculumManifest(parsed.data);
}

export function parseTopic(source: string): CurriculumTopic {
  const parsed = curriculumTopicSchema.safeParse(parseSafeYaml(source));
  if (!parsed.success) throw new Error("Invalid curriculum topic");
  return validateCurriculumTopic(parsed.data);
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
