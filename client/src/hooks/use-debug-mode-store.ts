import { useSyncExternalStore } from "react";

const subscribers = new Set<() => void>();

let debugModeState = false;

const notify = () => {
  subscribers.forEach((fn) => fn());
};

const subscribe = (callback: () => void) => {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
};

const getSnapshot = (): boolean => debugModeState;

const debugModeStore = {
  subscribe,
  getSnapshot,
  setDebugMode: (value: boolean) => {
    debugModeState = value;
    try {
      if (typeof globalThis.window !== "undefined") {
        globalThis.localStorage.setItem("unoDebugMode", value ? "1" : "0");
      }
    } catch {
      // Ignore localStorage errors
    }
    notify();
  },
  getDebugMode: () => debugModeState,
  // Initialize from localStorage on first access
  initFromStorage: () => {
    try {
      if (typeof globalThis.window !== "undefined") {
        debugModeState = globalThis.localStorage.getItem("unoDebugMode") === "1";
      }
    } catch {
      debugModeState = false;
    }
  },
};

// Initialize when module first loads (in browser)
if (typeof globalThis.window !== "undefined") {
  debugModeStore.initFromStorage();

  // Listen for external events (used by Playwright tests) so that
  // dispatching a CustomEvent("debugModeChange") immediately updates
  // the store. Without this, tests would toggle localStorage directly but
  // React components wouldn't re-render until a manual setDebugMode call.
  globalThis.addEventListener("debugModeChange", (ev) => {
    const detail = (ev as CustomEvent).detail;
    if (detail && typeof detail.value === "boolean") {
      debugModeStore.setDebugMode(detail.value);
    }
  });
}

export const useDebugMode = () => {
  const debugMode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    debugMode,
    setDebugMode: debugModeStore.setDebugMode,
  };
};
