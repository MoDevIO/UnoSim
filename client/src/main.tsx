import "./lib/monaco-error-suppressor"; // Geändert von @/lib/...
// Monaco worker wiring to avoid fallback-to-main-thread warning
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { getCurrentFontScale, increaseFontScale, decreaseFontScale } from "./lib/font-scale-utils";
import { isMac } from "./lib/platform";
import { Logger } from "@shared/logger";

// Extend global interfaces for optional test hooks and Monaco worker wiring
declare global {
  interface Window {
    MonacoEnvironment?: { getWorker: () => Worker };
    setEditorContent?: (code: string, maxRetries?: number) => Promise<boolean>;
    __MONACO_EDITOR__?: {
      setValue: (code: string) => void;
      getModel?: () => { setValue?: (code: string) => void };
      getDomNode?: () => HTMLElement | null;
      focus?: () => void;
    };
  }

  interface WorkerGlobalScope {
    MonacoEnvironment?: { getWorker: () => Worker };
  }
}

const logger = new Logger("Main");

// Provide MonacoEnvironment.getWorker to load editor workers off the main thread
if (typeof self !== "undefined") {
  // Monaco expects a global MonacoEnvironment.getWorker factory.
  // Cast to a constructor type to satisfy TS inference.
  const MonacoWorkerConstructor = editorWorker as unknown as new () => Worker;
  self.MonacoEnvironment = {
    getWorker() {
      return new MonacoWorkerConstructor();
    },
  };
}

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
        logger.debug("Font scale increased");
      }
      return;
    }
    
    // Handle - key (decrease font size)
    if (e.key === "-" || e.key === "_") {
      e.preventDefault(); // Prevent browser zoom
      if (decreaseFontScale()) {
        logger.debug("Font scale decreased");
      }
      return;
    }
  };
  
  globalThis.addEventListener("keydown", handleKeyDown);
  
  // Cleanup function for HMR
  return () => {
    globalThis.removeEventListener("keydown", handleKeyDown);
  };
}

// Setup shortcuts
setupFontScaleShortcuts();


// E2E TEST HOOK: Add a global setEditorContent function for Playwright
if (typeof window !== "undefined") {
  window.setEditorContent = async function (code: string, maxRetries: number = 50) {
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
    let lastErr: unknown;
    for (let i = 0; i < maxRetries; ++i) {
      try {
        const editor = window.__MONACO_EDITOR__;
        if (editor && typeof editor.setValue === "function") {
          editor.focus?.();
          editor.setValue(code);
          // Trigger change event if needed
          const model = editor.getModel?.();
          if (model && typeof model.setValue === "function") {
            model.setValue(code);
          }
          // Optionally trigger input event for React
          const domNode = editor.getDomNode?.();
          if (domNode) {
            domNode.dispatchEvent(new Event("input", { bubbles: true }));
          }
          return true;
        }
      } catch (err) {
        lastErr = err;
      }
      await sleep(200);
    }
    if (lastErr) {
      console.warn("setEditorContent failed (editor not ready):", lastErr);
    }
    return false;
  };
}

createRoot(document.getElementById("root")!).render(<App />);
