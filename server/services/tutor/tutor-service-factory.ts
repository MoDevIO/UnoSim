import { TutorService } from "./tutor-service";
import { CurriculumTutorAdapter } from "./curriculum-tutor-adapter";
import type { LLMProvider } from "./llm-provider";

/** Composition root: concrete optional planning extensions stay outside TutorService. */
export function createTutorService(provider: LLMProvider): TutorService {
  return new TutorService(provider, undefined, new CurriculumTutorAdapter());
}
