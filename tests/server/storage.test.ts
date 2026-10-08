import { describe, it, expect, beforeEach } from "vitest";
import { DefaultSketchStore } from "../../server/storage";

describe("DefaultSketchStore", () => {
  let storage: DefaultSketchStore;

  beforeEach(() => {
    storage = new DefaultSketchStore();
  });

  describe("constructor", () => {
    it("should initialize with a default sketch", async () => {
      const sketches = await storage.getAllSketches();
      expect(sketches.length).toBe(1);
      expect(sketches[0].name).toBe("sketch.ino");
      expect(sketches[0].content).toContain("void setup()");
      expect(sketches[0].content).toContain("void loop()");
    });

    it("should set createdAt and updatedAt for default sketch", async () => {
      const sketches = await storage.getAllSketches();
      const defaultSketch = sketches[0];
      expect(defaultSketch.createdAt).toBeInstanceOf(Date);
      expect(defaultSketch.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("getSketch", () => {
    it("should return the default sketch by its ID", async () => {
      const sketches = await storage.getAllSketches();
      const defaultSketch = sketches[0];
      const retrieved = await storage.getSketch(defaultSketch.id);
      expect(retrieved).toEqual(defaultSketch);
    });

    it("should return undefined for invalid ID", async () => {
      const result = await storage.getSketch("nonexistent-id");
      expect(result).toBeUndefined();
    });
  });

  it("offers no mutation methods", () => {
    for (const method of ["createSketch", "updateSketch", "deleteSketch"]) {
      expect(storage).not.toHaveProperty(method);
    }
  });
});
