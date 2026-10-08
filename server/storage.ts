import type { Sketch } from "@shared/schema";
import { randomUUID } from "node:crypto";

/**
 * Read-only source behind GET /api/sketches. It holds only the seeded default
 * sketch the editor starts from; the API offers no sketch mutations, so nothing
 * a client sends can grow this state.
 */
export class DefaultSketchStore {
  private readonly sketches: ReadonlyMap<string, Sketch>;

  constructor() {
    const now = new Date();
    const defaultSketch: Sketch = {
      id: randomUUID(),
      name: "sketch.ino",
      content: `
void setup() {
  // put your setup code here, to run once
}

void loop() {
  // put your main code here, to run repeatedly
}`,
      createdAt: now,
      updatedAt: now,
    };
    this.sketches = new Map([[defaultSketch.id, defaultSketch]]);
  }

  async getSketch(id: string): Promise<Sketch | undefined> {
    return this.sketches.get(id);
  }

  async getAllSketches(): Promise<Sketch[]> {
    return Array.from(this.sketches.values());
  }
}

export const storage = new DefaultSketchStore();
