import "@/lib/tutor-diagnostic-runtime";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useDebugConsole } from "@/hooks/use-debug-console";

afterEach(() => localStorage.clear());
const id = "11111111-1111-4111-8111-111111111111";
const details = { version: 1, traceId: id, requestId: id, sequence: 1, timestamp: "2026-11-11T10:00:00.000Z", origin: "renderer", operation: "question", stage: "renderer", outcome: "rendered" };

it("collects validated Tutor events only while Debug is enabled", () => {
  localStorage.setItem("unoDebugMode", "1");
  const { result } = renderHook(() => useDebugConsole("debug"));
  act(() => document.dispatchEvent(new CustomEvent("tutor-diagnostic", { detail: details })));
  expect(result.current.debugMessages).toHaveLength(1);
  expect(result.current.debugMessages[0]).toMatchObject({ category: "tutor", sender: "frontend", details });
  act(() => document.dispatchEvent(new CustomEvent("debugModeChange", { detail: { value: false } })));
  act(() => document.dispatchEvent(new CustomEvent("tutor-diagnostic", { detail: { ...details, sequence: 2 } })));
  expect(result.current.debugMessages).toHaveLength(1);
});

it("reports buffer losses and resets the loss counter on manual Clear", () => {
  localStorage.setItem("unoDebugMode", "1");
  const { result } = renderHook(() => useDebugConsole("debug"));
  act(() => { for (let index = 0; index < 600; index++) document.dispatchEvent(new CustomEvent("tutor-diagnostic", { detail: { ...details, sequence: index + 1 } })); });
  expect(result.current.debugMessages).toHaveLength(500);
  expect(result.current.debugDroppedCount).toBe(100);
  act(() => result.current.setDebugMessages([]));
  expect(result.current.debugMessages).toHaveLength(0);
  expect(result.current.debugDroppedCount).toBe(0);
});

it("clears simulation traffic while preserving Tutor traces for Compile/Upload", () => {
  localStorage.setItem("unoDebugMode", "1");
  const { result } = renderHook(() => useDebugConsole("debug"));
  act(() => {
    document.dispatchEvent(new CustomEvent("tutor-diagnostic", { detail: details }));
    result.current.addDebugMessage("frontend", "compile", "Compiling", "http");
  });
  expect(result.current.debugMessages).toHaveLength(2);
  act(() => result.current.resetSimulationDebugMessages());
  expect(result.current.debugMessages).toHaveLength(1);
  expect(result.current.debugMessages[0].category).toBe("tutor");
});
