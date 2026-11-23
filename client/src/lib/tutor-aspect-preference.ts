/** The learner's choice whether the Tutor plans by the aspects of the sketch; on until switched off. */
const STORAGE_KEY = "unoTutorAspectPlanning";

let memoryValue = true;

export function readTutorAspectPlanning(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== "off"; }
  catch { return memoryValue; }
}

export function writeTutorAspectPlanning(enabled: boolean): void {
  memoryValue = enabled;
  try { localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off"); } catch { /* Storage may be disabled. */ }
}

/** The request field: only a learner who switched planning by aspects off sends it. */
export function aspectPlanningRequestField(): { aspectPlanning?: false } {
  return readTutorAspectPlanning() ? {} : { aspectPlanning: false };
}
