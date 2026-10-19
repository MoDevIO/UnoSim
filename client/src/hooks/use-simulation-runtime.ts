import { useEffect, useState } from "react";
import type { BoardId, RuntimeKind } from "@shared/boards";
import { FALLBACK_RUNTIME_CONFIG, loadRuntimeConfig, type RuntimeConfig } from "@/lib/runtime/runtime-config";
import {
  ENGINE_PREFERENCE_EVENT,
  isRuntimeKind,
  readEnginePreference,
  selectRuntime,
  storeEnginePreference,
  usableRuntimes,
} from "@/lib/runtime/runtime-selection";

export interface SimulationRuntimeSelection {
  /** The runtime of the next run; undefined while nothing is usable. */
  readonly runtimeKind: RuntimeKind | undefined;
  /** Runtimes the server offers and the board supports. */
  readonly usable: readonly RuntimeKind[];
  readonly config: RuntimeConfig;
  readonly userChoice: RuntimeKind | undefined;
  readonly setUserChoice: (kind: RuntimeKind | undefined) => void;
}

/**
 * Which runtime the next run uses (plan P3.1): the user's choice if usable,
 * else the server default, else the first usable runtime. The choice comes from
 * File → Settings → "Simulation engine" and applies at the next start; a
 * running simulation keeps its runtime.
 */
export function useSimulationRuntimeSelection(boardId?: BoardId): SimulationRuntimeSelection {
  const [config, setConfig] = useState<RuntimeConfig>(FALLBACK_RUNTIME_CONFIG);
  const [userChoice, setUserChoice] = useState<RuntimeKind | undefined>(() => readEnginePreference());

  useEffect(() => {
    let cancelled = false;
    void loadRuntimeConfig().then((loaded) => {
      if (!cancelled) setConfig(loaded);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onChange = (event: Event) => {
      const value = (event as CustomEvent<{ value: unknown }>).detail?.value;
      setUserChoice(isRuntimeKind(value) ? value : undefined);
    };
    document.addEventListener(ENGINE_PREFERENCE_EVENT, onChange);
    return () => document.removeEventListener(ENGINE_PREFERENCE_EVENT, onChange);
  }, []);

  const board = config.boards.find((entry) => entry.id === (boardId ?? config.defaultBoard));
  const selection = {
    offered: config.backends,
    boardRuntimes: board?.runtimes ?? [],
    serverDefault: config.defaultRuntime,
    ...(userChoice ? { userChoice } : {}),
  };
  return {
    runtimeKind: selectRuntime(selection),
    usable: usableRuntimes(selection),
    config,
    userChoice,
    setUserChoice: storeEnginePreference,
  };
}
