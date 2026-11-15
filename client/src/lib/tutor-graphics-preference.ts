import { TUTOR_GRAPHICS_STORAGE_KEY, type TutorGraphicsMode } from "@shared/tutor-graphics";

let memoryMode: TutorGraphicsMode = "auto";

export function readTutorGraphicsMode(): TutorGraphicsMode {
  try { return localStorage.getItem(TUTOR_GRAPHICS_STORAGE_KEY) === "always" ? "always" : "auto"; }
  catch { return memoryMode; }
}
export function writeTutorGraphicsMode(mode: TutorGraphicsMode): void {
  memoryMode = mode;
  try { localStorage.setItem(TUTOR_GRAPHICS_STORAGE_KEY, mode); } catch { /* Storage may be disabled. */ }
}
