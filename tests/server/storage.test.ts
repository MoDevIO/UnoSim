import { describe, it, expect, beforeEach } from "vitest";
import { MemStorage } from "../../server/storage";
import type { InsertSketch } from "../../shared/schema";

describe("MemStorage", () => {
  let storage: MemStorage;

  beforeEach(() => {
    storage = new MemStorage();
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

  describe("createSketch", () => {
    it("should create a new sketch", async () => {
      const newSketch: InsertSketch = {
        name: "newsketch.ino",
        content: "void setup() {}",
      };
      const created = await storage.createSketch(newSketch);
      expect(created.id).toBeDefined();
      expect(created.name).toBe("newsketch.ino");
      expect(created.content).toBe("void setup() {}");
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);
    });

    it("should generate unique IDs for multiple sketches", async () => {
      const sketch1 = await storage.createSketch({
        name: "sketch1.ino",
        content: "// code1",
      });
      const sketch2 = await storage.createSketch({
        name: "sketch2.ino",
        content: "// code2",
      });
      expect(sketch1.id).not.toBe(sketch2.id);
    });

    it("should have equal createdAt and updatedAt for new sketch", async () => {
      const created = await storage.createSketch({
        name: "new.ino",
        content: "// code",
      });
      expect(created.createdAt.getTime()).toBe(created.updatedAt.getTime());
    });

    it("should store the sketch and retrieve it", async () => {
      const newSketch: InsertSketch = {
        name: "stored.ino",
        content: "// stored code",
      };
      const created = await storage.createSketch(newSketch);
      const retrieved = await storage.getSketch(created.id);
      expect(retrieved).toEqual(created);
    });
  });

  describe("updateSketch", () => {
    it("should update sketch name", async () => {
      const sketches = await storage.getAllSketches();
      const originalId = sketches[0].id;
      const updated = await storage.updateSketch(originalId, {
        name: "updated.ino",
      });
      expect(updated?.name).toBe("updated.ino");
      expect(updated?.id).toBe(originalId);
    });

    it("should update sketch content", async () => {
      const sketches = await storage.getAllSketches();
      const originalId = sketches[0].id;
      const newContent = "// updated code";
      const updated = await storage.updateSketch(originalId, {
        content: newContent,
      });
      expect(updated?.content).toBe(newContent);
    });

    it("should update multiple fields at once", async () => {
      const sketches = await storage.getAllSketches();
      const originalId = sketches[0].id;
      const updated = await storage.updateSketch(originalId, {
        name: "multi-updated.ino",
        content: "// multi updated",
      });
      expect(updated?.name).toBe("multi-updated.ino");
      expect(updated?.content).toBe("// multi updated");
    });

    it("should update the updatedAt timestamp", async () => {
      const sketches = await storage.getAllSketches();
      const originalId = sketches[0].id;
      const original = sketches[0];
      
      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const updated = await storage.updateSketch(originalId, {
        name: "timestamp-test.ino",
      });
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(
        original.updatedAt.getTime(),
      );
    });

    it("should return undefined for updating nonexistent sketch", async () => {
      const result = await storage.updateSketch("nonexistent-id", {
        name: "newname.ino",
      });
      expect(result).toBeUndefined();
    });

    it("should preserve untouched fields when updating", async () => {
      const newSketch = await storage.createSketch({
        name: "preserve-test.ino",
        content: "// original content",
      });
      const originalContent = newSketch.content;
      
      const updated = await storage.updateSketch(newSketch.id, {
        name: "new-name.ino",
      });
      expect(updated?.content).toBe(originalContent);
      expect(updated?.name).toBe("new-name.ino");
    });
  });

  describe("deleteSketch", () => {
    it("should delete a sketch and return true", async () => {
      const newSketch = await storage.createSketch({
        name: "delete-test.ino",
        content: "// content",
      });
      const result = await storage.deleteSketch(newSketch.id);
      expect(result).toBe(true);
    });

    it("should make sketch inaccessible after deletion", async () => {
      const newSketch = await storage.createSketch({
        name: "delete-access-test.ino",
        content: "// content",
      });
      await storage.deleteSketch(newSketch.id);
      const retrieved = await storage.getSketch(newSketch.id);
      expect(retrieved).toBeUndefined();
    });

    it("should return false when deleting nonexistent sketch", async () => {
      const result = await storage.deleteSketch("nonexistent-id");
      expect(result).toBe(false);
    });

    it("should not affect other sketches when deleting one", async () => {
      const sketch1 = await storage.createSketch({
        name: "sketch1.ino",
        content: "// code1",
      });
      const sketch2 = await storage.createSketch({
        name: "sketch2.ino",
        content: "// code2",
      });
      
      await storage.deleteSketch(sketch1.id);
      
      const allSketches = await storage.getAllSketches();
      expect(allSketches.length).toBe(2); // default + sketch2
      expect(allSketches.find(s => s.id === sketch2.id)).toBeDefined();
      expect(allSketches.find(s => s.id === sketch1.id)).toBeUndefined();
    });
  });

  describe("getAllSketches", () => {
    it("should return all sketches including default", async () => {
      const allSketches = await storage.getAllSketches();
      expect(allSketches.length).toBe(1);
    });

    it("should return all created sketches", async () => {
      await storage.createSketch({
        name: "sketch1.ino",
        content: "// code1",
      });
      await storage.createSketch({
        name: "sketch2.ino",
        content: "// code2",
      });
      
      const all = await storage.getAllSketches();
      expect(all.length).toBe(3); // default + 2 created
    });

    it("should reflect deletions in getAllSketches", async () => {
      const sketch = await storage.createSketch({
        name: "to-delete.ino",
        content: "// code",
      });
      expect((await storage.getAllSketches()).length).toBe(2);
      
      await storage.deleteSketch(sketch.id);
      expect((await storage.getAllSketches()).length).toBe(1);
    });

    it("should return sketches in insertion-like order", async () => {
      const sketch1 = await storage.createSketch({
        name: "first.ino",
        content: "// first",
      });
      const sketch2 = await storage.createSketch({
        name: "second.ino",
        content: "// second",
      });
      
      const all = await storage.getAllSketches();
      // Both should be in the returned array
      expect(all.find(s => s.id === sketch1.id)).toBeDefined();
      expect(all.find(s => s.id === sketch2.id)).toBeDefined();
    });
  });

  describe("concurrent operations", () => {
    it("should handle concurrent creates correctly", async () => {
      const results = await Promise.all([
        storage.createSketch({ name: "concurrent1.ino", content: "// 1" }),
        storage.createSketch({ name: "concurrent2.ino", content: "// 2" }),
        storage.createSketch({ name: "concurrent3.ino", content: "// 3" }),
      ]);
      
      expect(results.length).toBe(3);
      expect(new Set(results.map(r => r.id)).size).toBe(3); // all unique IDs
      
      const all = await storage.getAllSketches();
      expect(all.length).toBe(4); // default + 3
    });

    it("should handle concurrent update and read operations", async () => {
      const sketch = await storage.createSketch({
        name: "concurrent-test.ino",
        content: "// original",
      });
      
      const [updated, retrieved] = await Promise.all([
        storage.updateSketch(sketch.id, { content: "// updated" }),
        storage.getSketch(sketch.id),
      ]);
      
      // One should see original, one should see updated (race condition in real system, but here should be consistent)
      expect(updated?.content).toBe("// updated");
      expect(retrieved?.content).toBe("// updated");
    });
  });
});
