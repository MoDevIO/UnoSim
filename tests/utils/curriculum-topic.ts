import { parse as parseYaml } from "yaml";
import {
  curriculumTopicSchema,
  validateCurriculumTopic,
  type CurriculumTopic,
} from "../../server/services/tutor/curriculum/curriculum-schema";

/**
 * Parses a topic fixture (curriculum/topics) with the schema and checks of the
 * Course Content loader; the loader's own YAML safety rules are tested there.
 */
export function parseTopic(source: string): CurriculumTopic {
  return validateCurriculumTopic(curriculumTopicSchema.parse(parseYaml(source, { schema: "core", uniqueKeys: true })));
}
