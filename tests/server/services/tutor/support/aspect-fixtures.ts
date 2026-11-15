import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { aspectDefinitionSchema, validateAspectDefinition, type AspectDefinition } from "../../../../../server/services/tutor/curriculum/aspect-schema";

export function fixtureText(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../fixtures/${path}`, import.meta.url)), "utf8");
}

/** The aspect files as UnoSim-Examples ships them; the copies under tests/fixtures keep the tests self-contained. */
export function aspectFixtures(): AspectDefinition[] {
  return ["branching", "loops", "variables"].map((id) =>
    validateAspectDefinition(aspectDefinitionSchema.parse(parseYaml(fixtureText(`tutor-aspects/${id}.yaml`)))));
}

export const TEMPERATURE_CONTROLLER = fixtureText("tutor-quality/TQ-REG-003-temperature-controller.ino");
