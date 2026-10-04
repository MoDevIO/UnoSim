import { parse as parseYaml } from "yaml";
import {
  curriculumManifestSchema,
  curriculumTopicSchema,
  validateCurriculumManifest,
  validateCurriculumTopic,
  type CurriculumManifest,
  type CurriculumTopic,
} from "./curriculum-schema";

/**
 * YAML parsing for curriculum manifests and topics with the same safety rules
 * as Course Content (no YAML tags, unique keys). Production loads Course
 * Content through CourseContentLoader; tests and fixtures use these helpers.
 */
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
