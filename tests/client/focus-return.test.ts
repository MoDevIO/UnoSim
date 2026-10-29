import { afterEach, describe, expect, it } from "vitest";
import { focusReturnTarget } from "@/lib/focus-return";

afterEach(() => { document.body.innerHTML = ""; });

describe("focusReturnTarget", () => {
  it("returns a plain control itself", () => {
    document.body.innerHTML = `<button id="b">Open</button>`;
    const button = document.getElementById("b");
    expect(focusReturnTarget(button)).toBe(button);
  });

  it("returns the trigger of the menu a menu item belongs to", () => {
    document.body.innerHTML = `<button id="trigger" role="menuitem">Sketch</button>
      <div role="menu" aria-labelledby="trigger"><div id="item" role="menuitem">Libraries…</div></div>`;
    expect(focusReturnTarget(document.getElementById("item"))).toBe(document.getElementById("trigger"));
  });

  it("has no target for the page body or nothing focused", () => {
    expect(focusReturnTarget(document.body)).toBeNull();
    expect(focusReturnTarget(null)).toBeNull();
  });
});
