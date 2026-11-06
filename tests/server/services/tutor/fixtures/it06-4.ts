import { IT064_SKETCH } from "../../../../../server/services/tutor/evaluation/learning-support-fixtures";

/** The IT06.4 regression data of the learning-support cycle; shared with the live HTTP evaluation. */
export * from "../../../../../server/services/tutor/evaluation/learning-support-fixtures";

/** The learner's experiment from the Example: `a` set to 200 in the editor. */
export const IT064_SKETCH_A200 = IT064_SKETCH.replace("byte a = 37;", "byte a = 200;");
