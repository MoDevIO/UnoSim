import { type Sketch, type InsertSketch } from "@shared/schema";
import { randomUUID } from "node:crypto";

interface IStorage {
  getSketch(id: string): Promise<Sketch | undefined>;
  createSketch(sketch: InsertSketch): Promise<Sketch>;
  updateSketch(
    id: string,
    sketch: Partial<InsertSketch>,
  ): Promise<Sketch | undefined>;
  deleteSketch(id: string): Promise<boolean>;
  getAllSketches(): Promise<Sketch[]>;
}

export class MemStorage implements IStorage {
  private readonly sketches: Map<string, Sketch>;

  constructor() {
    this.sketches = new Map();

    // Initialize with default blink sketch
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sketches.set(defaultSketch.id, defaultSketch);
  }

  async getSketch(id: string): Promise<Sketch | undefined> {
    return this.sketches.get(id);
  }

  async createSketch(insertSketch: InsertSketch): Promise<Sketch> {
    const id = randomUUID();
    const now = new Date();
    const sketch: Sketch = {
      ...insertSketch,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.sketches.set(id, sketch);
    return sketch;
  }

  async updateSketch(
    id: string,
    updateData: Partial<InsertSketch>,
  ): Promise<Sketch | undefined> {
    const existing = this.sketches.get(id);
    if (!existing) return undefined;

    const updated: Sketch = {
      ...existing,
      ...updateData,
      updatedAt: new Date(),
    };

    this.sketches.set(id, updated);
    return updated;
  }

  async deleteSketch(id: string): Promise<boolean> {
    return this.sketches.delete(id);
  }

  async getAllSketches(): Promise<Sketch[]> {
    return Array.from(this.sketches.values());
  }
}

export const storage = new MemStorage();

/**
 * Per-identity view of the sketch storage. Sketches created through the API
 * belong to the creating subject and are invisible to everyone else; the
 * seeded default sketch is shared and read-only. Unknown and foreign sketches
 * look the same (`undefined`/`false`), so ids leak no ownership information.
 */
export class OwnedSketchStore {
  private readonly ownerById = new Map<string, string>();

  constructor(private readonly storage: IStorage) {}

  private isVisible(owner: string | undefined, id: string): boolean {
    const sketchOwner = this.ownerById.get(id);
    return sketchOwner === undefined || (owner !== undefined && sketchOwner === owner);
  }

  private isOwned(owner: string | undefined, id: string): boolean {
    return owner !== undefined && this.ownerById.get(id) === owner;
  }

  async list(owner: string | undefined): Promise<Sketch[]> {
    return (await this.storage.getAllSketches()).filter(({ id }) => this.isVisible(owner, id));
  }

  async get(owner: string | undefined, id: string): Promise<Sketch | undefined> {
    const sketch = await this.storage.getSketch(id);
    return sketch && this.isVisible(owner, id) ? sketch : undefined;
  }

  async create(owner: string | undefined, sketch: InsertSketch): Promise<Sketch> {
    if (owner === undefined) throw new Error("Creating a sketch requires an identity");
    const created = await this.storage.createSketch(sketch);
    this.ownerById.set(created.id, owner);
    return created;
  }

  async update(owner: string | undefined, id: string, sketch: Partial<InsertSketch>): Promise<Sketch | undefined> {
    return this.isOwned(owner, id) ? this.storage.updateSketch(id, sketch) : undefined;
  }

  async delete(owner: string | undefined, id: string): Promise<boolean> {
    const existing = await this.storage.getSketch(id);
    if (!existing || !this.isOwned(owner, id)) return false;
    const deleted = await this.storage.deleteSketch(id);
    if (deleted) this.ownerById.delete(id);
    return deleted;
  }
}

export const ownedSketches = new OwnedSketchStore(storage);
