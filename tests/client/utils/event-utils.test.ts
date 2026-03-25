import { describe, it, expect, vi } from "vitest";
import {
  onCustomEvent,
  offCustomEvent,
  dispatchCustomEvent,
} from "../../../client/src/utils/event-utils";

describe("event-utils", () => {
  it("onCustomEvent attaches listener to target", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    onCustomEvent<string>(target, "test-event", handler);

    target.dispatchEvent(new CustomEvent("test-event", { detail: "hello" }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toBe("hello");
  });

  it("onCustomEvent does nothing when target is null", () => {
    expect(() => onCustomEvent(null, "test", vi.fn())).not.toThrow();
  });

  it("offCustomEvent removes listener", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    target.addEventListener("test-event", handler as EventListener);

    offCustomEvent(target, "test-event", handler);
    target.dispatchEvent(new CustomEvent("test-event"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("offCustomEvent does nothing when target is undefined", () => {
    expect(() => offCustomEvent(undefined, "test", vi.fn())).not.toThrow();
  });

  it("dispatchCustomEvent sends event with detail", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    target.addEventListener("my-event", handler);

    dispatchCustomEvent(target, "my-event", { foo: 42 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ foo: 42 });
  });

  it("dispatchCustomEvent works without detail", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    target.addEventListener("empty-event", handler);

    dispatchCustomEvent(target, "empty-event");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
