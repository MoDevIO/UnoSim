import { describe, expect, it } from "vitest";
import {
  TUTOR_PROMPT_REVISION,
  digestTutorPromptTemplates,
  type TutorPromptTemplateSources,
} from "../../../../../server/services/tutor/tutor-service";

describe("Tutor prompt revision metadata", () => {
  it("exposes versioned system and user template sources", () => {
    expect(TUTOR_PROMPT_REVISION.id).toMatch(/^tutor-prompts-v\d+$/);
    expect(TUTOR_PROMPT_REVISION.templateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(TUTOR_PROMPT_REVISION.sources.system).toContain("didaktischer Tutor");
    expect(TUTOR_PROMPT_REVISION.sources.initialUser).toContain("Sketch:");
    expect(TUTOR_PROMPT_REVISION.sources.dialogUser).toContain("Nutzerantwort");
    expect(TUTOR_PROMPT_REVISION.templateDigest).toBe(digestTutorPromptTemplates(TUTOR_PROMPT_REVISION.sources));
  });

  it("changes the digest when an effective template source changes", () => {
    const changed: TutorPromptTemplateSources = {
      ...TUTOR_PROMPT_REVISION.sources,
      system: `${TUTOR_PROMPT_REVISION.sources.system}\nchanged`,
    };
    expect(digestTutorPromptTemplates(changed)).not.toBe(TUTOR_PROMPT_REVISION.templateDigest);
  });
});
