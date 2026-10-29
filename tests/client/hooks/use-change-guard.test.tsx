import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChangeGuard } from "@/hooks/use-change-guard";

describe("useChangeGuard", () => {
  it("stays unchanged while the watched values keep their identity", () => {
    const tabs = [{ id: "a" }];
    const { result, rerender } = renderHook(({ values }) => useChangeGuard(values), { initialProps: { values: ["code", tabs] as unknown[] } });

    const unchanged = result.current();
    rerender({ values: ["code", tabs] });

    expect(unchanged()).toBe(true);
  });

  it("reports a change of any watched value after the mark", () => {
    const { result, rerender } = renderHook(({ values }) => useChangeGuard(values), { initialProps: { values: ["code", 1] as unknown[] } });

    const unchanged = result.current();
    rerender({ values: ["code typed while loading", 1] });

    expect(unchanged()).toBe(false);
    expect(result.current()()).toBe(true);
  });
});
