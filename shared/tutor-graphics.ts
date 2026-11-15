/** Explicit request preference; absence keeps the existing automatic decision. */
export const TUTOR_GRAPHICS_MODES = ["auto", "always"] as const;
export type TutorGraphicsMode = typeof TUTOR_GRAPHICS_MODES[number];
export const TUTOR_GRAPHICS_STORAGE_KEY = "unoTutorGraphicsMode";
export const TUTOR_GRAPHIC_UNAVAILABLE = "Grafik konnte nicht bereitgestellt werden.";
export const TUTOR_GRAPHIC_RENDER_FAILED = "Grafik konnte nicht dargestellt werden.";
