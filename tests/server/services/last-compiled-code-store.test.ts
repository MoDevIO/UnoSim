import { describe, expect, it } from "vitest";
import { LastCompiledCodeStore } from "../../../server/services/last-compiled-code-store";

describe("LastCompiledCodeStore", () => {
  it("keeps the last compiled code per subject", () => {
    const store = new LastCompiledCodeStore(10);
    store.set("alice", "a1");
    store.set("bob", "b1");
    store.set("alice", "a2");

    expect(store.get("alice")).toBe("a2");
    expect(store.get("bob")).toBe("b1");
    expect(store.get("carol")).toBeNull();
  });

  it("evicts the least recently compiled subject beyond its bound", () => {
    const store = new LastCompiledCodeStore(2);
    store.set("alice", "a");
    store.set("bob", "b");
    store.set("alice", "a");
    store.set("carol", "c");

    expect(store.get("bob")).toBeNull();
    expect(store.get("alice")).toBe("a");
    expect(store.get("carol")).toBe("c");
  });
});
