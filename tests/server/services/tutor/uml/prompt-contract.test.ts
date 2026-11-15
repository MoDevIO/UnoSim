import { expect, it } from "vitest";
import {
  TUTOR_UML_PROMPT_DIRECTIVES,
  UML_PROMPT_REVISION,
  UML_QUALITY_RUBRIC,
} from "../../../../../server/services/tutor/uml/prompt";
import {
  tutorUmlProposalSchema,
  tutorUmlDiagramSchema,
  tutorUmlImageSchema,
} from "../../../../../shared/tutor-uml";
import { activity } from "./contract-fixtures";
it("versions selection and evidence rules separately and names the semantic limits honestly", () => {
  expect(UML_PROMPT_REVISION).toBe("tutor-uml1-classic-v1-r3");
  for (const text of [
    "not-useful",
    "arduino-setup-loop",
    "setup:{ref,body",
    "loop:{ref,body",
    "Datentyp",
    "Kommentare",
    "setup",
    "loop",
    "SVG",
    "PlantUML",
    "endgültige Frage",
    "12",
    "24",
    "16 KiB",
  ])
    expect(TUTOR_UML_PROMPT_DIRECTIVES).toContain(text);
  expect(TUTOR_UML_PROMPT_DIRECTIVES).toContain('Modellfeld "diagram"');
  expect(UML_QUALITY_RUBRIC).toHaveLength(6);
  expect(TUTOR_UML_PROMPT_DIRECTIVES).toContain(
    "keine allgemeine fachliche Korrektheit",
  );
  expect(TUTOR_UML_PROMPT_DIRECTIVES).toContain(
    "whenTrue:[Schritte],whenFalse:[Schritte]",
  );
});
it("keeps provider proposals separate from app-owned transport metadata", () => {
  expect(
    tutorUmlProposalSchema.safeParse({ ...activity, image: { svg: "<svg/>" } })
      .success,
  ).toBe(false);
  const image = {
    svg: "<svg/>",
    width: 100,
    height: 100,
    bytes: 6,
    rendererRevision: "pinned",
  };
  expect(tutorUmlImageSchema.safeParse(image).success).toBe(true);
  expect(
    tutorUmlDiagramSchema.safeParse({
      version: 1,
      profile: activity.profile,
      kind: activity.kind,
      purpose: activity.purpose,
      proposal: activity,
      image,
    }).success,
  ).toBe(true);
  expect(
    tutorUmlDiagramSchema.safeParse({
      version: 1,
      profile: activity.profile,
      kind: "class",
      purpose: activity.purpose,
      proposal: activity,
      image,
    }).success,
  ).toBe(false);
});
