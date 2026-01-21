import "./lib/monaco-error-suppressor"; // Geändert von @/lib/...
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply persisted UI font-scale before first render
try {
  const stored = window.localStorage.getItem("unoFontScale");
  const scale = stored ? parseFloat(stored) : 1.0;
  if (!Number.isNaN(scale) && scale > 0) {
    document.documentElement.style.setProperty(
      "--ui-font-scale",
      String(scale),
    );
  }
} catch {}

createRoot(document.getElementById("root")!).render(<App />);
