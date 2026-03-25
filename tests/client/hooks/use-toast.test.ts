/**
 * Tests for use-toast hook
 *
 * Covers: toast(), dismiss(), update(), reducer logic, useToast() hook,
 * genId(), addToRemoveQueue(), localStorage duration override.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock toast UI component types
vi.mock("@/components/ui/toast", () => ({
  // Provide enough to satisfy the type imports
}));

const createLocalStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() { return Object.keys(store).length; },
  } as Storage;
};

let storageMock: Storage;
let useToast: () => any;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  storageMock = createLocalStorageMock();
  vi.stubGlobal("localStorage", storageMock);
  const mod = await import("@/hooks/use-toast");
  useToast = mod.useToast;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("use-toast", () => {
  it("useToast returns initial empty toasts array", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });

  it("toast() adds a toast and returns control object", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      const t = result.current.toast({ title: "Hello" });
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("dismiss");
      expect(t).toHaveProperty("update");
    });

    expect(result.current.toasts.length).toBe(1);
    expect(result.current.toasts[0].title).toBe("Hello");
    expect(result.current.toasts[0].open).toBe(true);
  });

  it("toast() generates unique IDs", () => {
    const { result } = renderHook(() => useToast());
    let id1: string, id2: string;

    act(() => {
      id1 = result.current.toast({ title: "First" }).id;
    });
    act(() => {
      id2 = result.current.toast({ title: "Second" }).id;
    });

    expect(id1!).not.toBe(id2!);
  });

  it("enforces TOAST_LIMIT (only 1 toast visible)", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "First" });
    });
    act(() => {
      result.current.toast({ title: "Second" });
    });

    // TOAST_LIMIT = 1, so only the newest toast should be present
    expect(result.current.toasts.length).toBe(1);
    expect(result.current.toasts[0].title).toBe("Second");
  });

  it("dismiss() sets open to false", () => {
    const { result } = renderHook(() => useToast());
    let control: any;

    act(() => {
      control = result.current.toast({ title: "Dismissable" });
    });

    act(() => {
      control.dismiss();
    });

    expect(result.current.toasts[0].open).toBe(false);
  });

  it("update() modifies an existing toast", () => {
    const { result } = renderHook(() => useToast());
    let control: any;

    act(() => {
      control = result.current.toast({ title: "Original" });
    });

    act(() => {
      control.update({ title: "Updated" });
    });

    expect(result.current.toasts[0].title).toBe("Updated");
  });

  it("removes toast after TOAST_REMOVE_DELAY on dismiss", () => {
    const { result } = renderHook(() => useToast());
    let control: any;

    act(() => {
      control = result.current.toast({ title: "Will be removed" });
    });

    act(() => {
      control.dismiss();
    });

    // After TOAST_REMOVE_DELAY (3500ms), toast should be removed
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(result.current.toasts.length).toBe(0);
  });

  it("dismiss without toastId dismisses all toasts", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Toast 1" });
    });

    // The dismiss function from the return of toast() targets a specific ID,
    // but the underlying dispatch with toastId=undefined dismisses all
    act(() => {
      result.current.dismiss();
    });

    expect(result.current.toasts.every((t: any) => t.open === false)).toBe(true);
  });

  it("REMOVE_TOAST without id clears all toasts", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "One" });
    });

    // Trigger a remove-all by dismiss + wait
    act(() => {
      result.current.dismiss();
    });

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(result.current.toasts.length).toBe(0);
  });

  it("onOpenChange(false) triggers dismiss", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Auto-close" });
    });

    // Simulate onOpenChange(false) which is set on each toast
    act(() => {
      const t = result.current.toasts[0];
      if (t.onOpenChange) t.onOpenChange(false);
    });

    expect(result.current.toasts[0].open).toBe(false);
  });

  it("reads toast duration from localStorage", () => {
    storageMock.setItem("unoToastDuration", "5000");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Custom duration" });
    });

    expect(result.current.toasts[0].duration).toBe(5000);

    storageMock.removeItem("unoToastDuration");
  });

  it("handles infinite toast duration from localStorage", () => {
    storageMock.setItem("unoToastDuration", "infinite");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Infinite" });
    });

    expect(result.current.toasts[0].duration).toBe(Infinity);

    storageMock.removeItem("unoToastDuration");
  });

  it("handles invalid localStorage duration gracefully", () => {
    storageMock.setItem("unoToastDuration", "notanumber");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Default fallback" });
    });

    // NaN parsed → should keep default duration (1000)
    expect(result.current.toasts[0].duration).toBe(1000);

    storageMock.removeItem("unoToastDuration");
  });

  it("prevents duplicate addToRemoveQueue calls", () => {
    const { result } = renderHook(() => useToast());
    let control: any;

    act(() => {
      control = result.current.toast({ title: "Double dismiss" });
    });

    // Dismiss twice - should not create duplicate timeouts
    act(() => {
      control.dismiss();
    });
    act(() => {
      control.dismiss();
    });

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(result.current.toasts.length).toBe(0);
  });
});
