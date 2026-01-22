// font-scale-utils.ts - Utility functions for global font scale management

export const FONT_SCALES = [
  { label: "S", value: 0.875, px: 12 },
  { label: "M", value: 1.0, px: 14 },
  { label: "L", value: 1.125, px: 16 },
  { label: "XL", value: 1.25, px: 18 },
  { label: "XXL", value: 1.5, px: 20 },
] as const;

export const FONT_SCALE_KEY = "unoFontScale";
export const DEFAULT_FONT_SCALE = 1.0;

export function getCurrentFontScale(): number {
  try {
    const stored = window.localStorage.getItem(FONT_SCALE_KEY);
    if (!stored) return DEFAULT_FONT_SCALE;
    const parsed = parseFloat(stored);
    return isNaN(parsed) ? DEFAULT_FONT_SCALE : parsed;
  } catch {
    return DEFAULT_FONT_SCALE;
  }
}

export function setFontScale(scale: number): void {
  try {
    window.localStorage.setItem(FONT_SCALE_KEY, String(scale));
    document.documentElement.style.setProperty("--ui-font-scale", String(scale));
    document.dispatchEvent(
      new CustomEvent("uiFontScaleChange", { detail: { value: scale } })
    );
  } catch (e) {
    console.error("Failed to set font scale:", e);
  }
}

export function increaseFontScale(): boolean {
  const current = getCurrentFontScale();
  const currentIndex = FONT_SCALES.findIndex((s) => Math.abs(s.value - current) < 0.01);
  
  if (currentIndex === -1) {
    // If current scale is not in the list, find the next larger one
    const next = FONT_SCALES.find((s) => s.value > current);
    if (next) {
      setFontScale(next.value);
      return true;
    }
    return false;
  }
  
  if (currentIndex >= FONT_SCALES.length - 1) {
    // Already at maximum
    return false;
  }
  
  setFontScale(FONT_SCALES[currentIndex + 1].value);
  return true;
}

export function decreaseFontScale(): boolean {
  const current = getCurrentFontScale();
  const currentIndex = FONT_SCALES.findIndex((s) => Math.abs(s.value - current) < 0.01);
  
  if (currentIndex === -1) {
    // If current scale is not in the list, find the next smaller one
    const prev = [...FONT_SCALES].reverse().find((s) => s.value < current);
    if (prev) {
      setFontScale(prev.value);
      return true;
    }
    return false;
  }
  
  if (currentIndex <= 0) {
    // Already at minimum
    return false;
  }
  
  setFontScale(FONT_SCALES[currentIndex - 1].value);
  return true;
}
