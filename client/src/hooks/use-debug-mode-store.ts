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

export const debugModeStore = {
  subscribe,
  getSnapshot,
  setDebugMode: (value: boolean) => {
    debugModeState = value;
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("unoDebugMode", value ? "1" : "0");
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
      if (typeof window !== "undefined") {
        debugModeState = window.localStorage.getItem("unoDebugMode") === "1";
      }
    } catch {
      debugModeState = false;
    }
  },
};

// Initialize when module first loads (in browser)
if (typeof window !== "undefined") {
  debugModeStore.initFromStorage();
}

export const useDebugMode = () => {
  const debugMode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    debugMode,
    setDebugMode: debugModeStore.setDebugMode,
  };
};
