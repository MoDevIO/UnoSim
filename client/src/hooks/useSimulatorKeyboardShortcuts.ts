import { useEffect } from "react";
import type { ToastFn } from "@/hooks/use-toast";

export type UseSimulatorKeyboardShortcutsOptions = {
  isMac: boolean;
  simulationStatus: "running" | "stopped" | "paused";
  compilePending: boolean;
  startPending: boolean;
  handleCompile: () => void;
  handleCompileAndStart: () => void;
  handleStop: () => void;
  handleFormatCode: () => void;
  handleNewFile: () => void;
  setDebugMode: (value: boolean) => void;
  toast: ToastFn;
};

export function useSimulatorKeyboardShortcuts({
  isMac,
  simulationStatus,
  compilePending,
  startPending,
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
      if (e.key === "F5") {
        e.preventDefault();
        if (!compilePending) {
          handleCompile();
        }
        return;
      }

      // Escape: Stop simulation
      if (e.key === "Escape" && simulationStatus === "running") {
        e.preventDefault();
        handleStop();
        return;
      }

      // Meta/Ctrl + U: Compile and start
      if (isModifierPressed && e.key.toLowerCase() === "u") {
        e.preventDefault();
        if (!compilePending && !startPending) {
          handleCompileAndStart();
        }
        return;
      }

      // Meta/Ctrl + Shift + F: Format code
      if (isModifierPressed && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        handleFormatCode();
        return;
      }

      // Meta/Ctrl + Alt + Shift + N: New file (less likely to be caught by browser menu shortcuts)
      if (
        isModifierPressed &&
        e.altKey &&
        e.shiftKey &&
        (e.key === "n" || e.key === "N" || e.code === "KeyN")
      ) {
        e.preventDefault();
        handleNewFile();
        return;
      }

      const tgt = e.target as HTMLElement | null;
      const ignoreTarget =
        tgt &&
        (tgt.tagName === "INPUT" ||
          tgt.tagName === "TEXTAREA" ||
          tgt.isContentEditable);
      if (ignoreTarget) return;
    };

    globalThis.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => globalThis.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    compilePending,
    startPending,
    simulationStatus,
    isMac,
    handleCompile,
    handleCompileAndStart,
    handleStop,
    handleFormatCode,
    handleNewFile,
  ]);
}
