import "./lib/monaco-error-suppressor"; // Geändert von @/lib/...
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { getCurrentFontScale, setFontScale, increaseFontScale, decreaseFontScale } from "./lib/font-scale-utils";
import { isMac } from "./lib/platform";

// Apply persisted UI font-scale before first render
try {
  const scale = getCurrentFontScale();
  document.documentElement.style.setProperty(
    "--ui-font-scale",
    String(scale),
  );
} catch {}

// Global keyboard shortcuts for font scale (CMD/CTRL + + and -)
function setupFontScaleShortcuts() {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Check if it's the modifier key (CMD on Mac, CTRL on others) plus + or -
    const isModifierPressed = isMac ? e.metaKey : e.ctrlKey;
    
    if (!isModifierPressed) return;
    
    // Handle + or = key (both increase font size)
    if (e.key === "+" || e.key === "=") {
      e.preventDefault(); // Prevent browser zoom
      if (increaseFontScale()) {
        console.log("Font scale increased");
      }
      return;
    }
    
    // Handle - key (decrease font size)
    if (e.key === "-" || e.key === "_") {
      e.preventDefault(); // Prevent browser zoom
      if (decreaseFontScale()) {
        console.log("Font scale decreased");
      }
      return;
    }
  };
  
  window.addEventListener("keydown", handleKeyDown);
  
  // Cleanup function for HMR
  return () => {
    window.removeEventListener("keydown", handleKeyDown);
  };
}

// Setup shortcuts
setupFontScaleShortcuts();

createRoot(document.getElementById("root")!).render(<App />);
