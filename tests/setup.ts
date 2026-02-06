import { afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Kompatibilitätsschicht für alten Code, der noch 'jest' statt 'vi' erwartet
(globalThis as any).jest = vi;

// Globale Mocks für die Konsole, um CI-Logs sauber zu halten
// Wir mocken diese einmalig global.
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

afterEach(() => {
  // Stellt sicher, dass Mocks zwischen den Tests zurückgesetzt werden, 
  // falls ein Test spezifische Implementierungen (vi.mock) nutzt.
  vi.clearAllMocks();
});