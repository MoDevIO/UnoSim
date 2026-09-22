import { useEffect } from "react";
import type { ToastFn } from "@/hooks/use-toast";
import type { ServerCapabilities } from "@/lib/server-capabilities";

type UseSimulatorKeyboardShortcutsOptions = {
  isMac: boolean;
  simulationStatus: "idle" | "running" | "compiling" | "queued" | "paused";
  compilePending: boolean;
  startPending: boolean;
  capabilities: ServerCapabilities;
  handleCompile: () => void;
  handleCompileAndStart: () => void;
  handleStop: () => void;
  handleFormatCode: () => void;
  handleNewFile: () => void;
  setDebugMode: (value: boolean) => void;
  toast: ToastFn;
};

function runShortcut(
  event: KeyboardEvent,
  matches: boolean,
  shouldRun: boolean,
  action: () => void,
): boolean {
  if (!matches) return false;
  event.preventDefault();
  if (shouldRun) action();
  return true;
}

export function useSimulatorKeyboardShortcuts({
  isMac,
  simulationStatus,
  compilePending,
  startPending,
  capabilities,
  handleCompile,
  handleCompileAndStart,
  handleStop,
  handleFormatCode,
  handleNewFile,
  setDebugMode,
  toast,
}: UseSimulatorKeyboardShortcutsOptions) {
  // Debug mode toggle (⌘+D / Ctrl+D)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifierPressed = e.metaKey || e.ctrlKey;
      if (isModifierPressed && !e.altKey && !e.shiftKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        e.stopImmediatePropagation();

        const currentValue = globalThis.localStorage.getItem("unoDebugMode") === "1";
        const newValue = !currentValue;

        try {
          globalThis.localStorage.setItem("unoDebugMode", newValue ? "1" : "0");
          setDebugMode(newValue);

          const ev = new CustomEvent("debugModeChange", { detail: { value: newValue } });
          document.dispatchEvent(ev);

          toast({
            title: newValue ? "Debug Mode Enabled" : "Debug Mode Disabled",
            description: newValue
              ? "Telemetry displays are now visible"
              : "Telemetry displays are now hidden",
          });
        } catch (err) {
          console.error("Failed to toggle debug mode:", err);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isMac, setDebugMode, toast]);

  // Application-level hotkeys (F5, Escape, ⌘/Ctrl+U)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Always allow global shortcuts, even when focus is inside an editor/input.
      // (Avoid blocking them for the main editor textarea etc.)
      const isModifierPressed = isMac ? e.metaKey : e.ctrlKey;

      // F5: Compile only
      if (runShortcut(e, e.key === "F5", capabilities.canCompile && !compilePending, handleCompile)) return;

      // Escape: Stop simulation
      if (runShortcut(
        e,
        e.key === "Escape" && simulationStatus === "running" && capabilities.canSimulate,
        true,
        handleStop,
      )) return;

      // Meta/Ctrl + U: Compile and start
      if (runShortcut(
        e,
        isModifierPressed && e.key.toLowerCase() === "u",
        capabilities.canCompile && capabilities.canSimulate && !compilePending && !startPending,
        handleCompileAndStart,
      )) return;

      // Meta/Ctrl + Shift + F: Format code
      if (runShortcut(
        e,
        isModifierPressed && e.shiftKey && e.key.toLowerCase() === "f",
        true,
        handleFormatCode,
      )) return;

      // Meta/Ctrl + Alt + Shift + N: New file (less likely to be caught by browser menu shortcuts)
      runShortcut(
        e,
        isModifierPressed && e.altKey && e.shiftKey &&
          (e.key === "n" || e.key === "N" || e.code === "KeyN"),
        true,
        handleNewFile,
      );
    };

    globalThis.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => globalThis.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    compilePending,
    startPending,
    capabilities,
    simulationStatus,
    isMac,
    handleCompile,
    handleCompileAndStart,
    handleStop,
    handleFormatCode,
    handleNewFile,
  ]);
}
