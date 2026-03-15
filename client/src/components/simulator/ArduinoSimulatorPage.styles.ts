/**
 * ArduinoSimulatorPage Styles & Constants
 *
 * Houses all styling, animation keyframes, and helper utility functions
 * extracted from the main ArduinoSimulatorPage component.
 */

/**
 * Animation keyframes for the page-level visual effects.
 * Injected into <style> tag at page root.
 */
export const ANIMATION_KEYFRAMES = `
  @keyframes border-flash {
    0% { opacity: 0; transform: scale(1); }
    10% { opacity: 1; }
    60% { opacity: 0.7; }
    100% { opacity: 0; }
  }
  .animate-border-flash { animation: border-flash 0.6s ease-out both; }
  
  @keyframes breathe-blue {
    0% { box-shadow: 0 0 0 0 rgba(37,99,235,0.06); opacity: 0.6; }
    25% { box-shadow: 0 0 18px 6px rgba(37,99,235,0.10); opacity: 0.85; }
    50% { box-shadow: 0 0 36px 12px rgba(37,99,235,0.16); opacity: 1; }
    75% { box-shadow: 0 0 18px 6px rgba(37,99,235,0.10); opacity: 0.85; }
    100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.06); opacity: 0.6; }
  }
  .animate-breathe-blue { animation: breathe-blue 6s ease-in-out infinite; }
`;

/**
 * CSS class name constants (to minimize typos and ensure consistency)
 */
export const CSS_CLASSES = {
  // Buttons
  BUTTON_HOVER: "hover:bg-green-600 hover:text-white transition-colors",

  // Containers
  MAIN_CONTAINER: "h-screen flex flex-col bg-background text-foreground relative",
  FLEX_CONTAINER: "flex-1 min-h-0 w-full",
  
  // Overlays (glitch & breathing border effects)
  OVERLAY_ROOT: "pointer-events-none absolute inset-0",
  OVERLAY_Z_HIGH: "z-50",
  OVERLAY_Z_MEDIUM: "z-40",
  INNER_FLEX: "absolute inset-0 flex items-stretch justify-stretch",
  INNER_ABS: "absolute inset-0",
  BORDER_CONTAINER: "absolute inset-0 border-0 pointer-events-none",
  
  // Glitch border (red flash)
  GLITCH_BORDER: "absolute inset-0 rounded-none border-4 border-red-500 opacity-0 animate-border-flash",
  
  // Backend unreachable border (blue breathing)
  UNREACHABLE_BORDER: "absolute inset-0 rounded-none border-2 border-blue-400 opacity-80 animate-breathe-blue",

  // Panel groups (horizontal & vertical layouts)
  PANEL_LAYOUT: "h-full",
  OUTPUT_LAYOUT: "hidden",
};

/**
 * Status message info and styling helper
 */
type CompilationStatusType = "compiling" | "success" | "error" | "ready";

interface StatusInfo {
  text: string;
  className: string;
}

/**
 * Get status info object based on compilation/modification state
 */
export function getStatusInfo(
  compilationStatus: CompilationStatusType,
  isModified: boolean,
): StatusInfo {
  switch (compilationStatus) {
    case "compiling":
      return { text: "Compiling...", className: "status-compiling" };
    case "success":
      return {
        text: isModified ? "Code Changed" : "Compilation with Arduino-CLI complete",
        className: isModified ? "status-modified" : "status-success",
      };
    case "error":
      return { text: "Compilation Error", className: "status-error" };
    default:
      return { text: "Ready", className: "status-ready" };
  }
}

export const DIGITAL_PIN_COUNT = 14; // Pins 0–13
export const ANALOG_PIN_COUNT = 6;   // Pins A0–A5
