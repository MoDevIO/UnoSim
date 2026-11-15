import { TutorService } from "./tutor-service";
import { CurriculumTutorAdapter } from "./curriculum-tutor-adapter";
import type { LLMProvider } from "./llm-provider";
import { config } from "../../config";

/** Composition root: concrete optional planning extensions stay outside TutorService. */
export function createTutorService(provider: LLMProvider): TutorService {
  return new TutorService(provider, new CurriculumTutorAdapter({ aspectPlanning: config.tutor.aspectPlanning }));
}
