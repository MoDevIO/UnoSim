import { describe, expect, it } from "vitest";
import { originalFileName, withOriginalFileNames } from "@/lib/opened-file-names";

describe("names of opened files", () => {
  it.each([
    ["sketch(1).ino", "sketch.ino"],
    ["sketch(1)(1)(1).ino", "sketch.ino"],
    ["sketch (2).ino", "sketch.ino"],
    ["pins (12).h", "pins.h"],
    ["sketch.ino", "sketch.ino"],
    ["(1).ino", "(1).ino"],
    ["sketch(a).ino", "sketch(a).ino"],
    ["sketch().ino", "sketch().ino"],
    ["sketch(1)x.ino", "sketch(1)x.ino"],
    ["README", "README"],
  ])("opens %s as %s", (name, original) => {
    expect(originalFileName(name)).toBe(original);
  });

  it("keeps a numbered name when the original is taken", () => {
    const files = [{ name: "a(1).h" }, { name: "a(2).h" }, { name: "b(1).h" }, { name: "b.h" }, { name: "c(1).h" }];
    expect(withOriginalFileNames(files, ["c.h"]).map(({ name }) => name)).toEqual(["a(1).h", "a(2).h", "b(1).h", "b.h", "c(1).h"]);
  });
});
