import { type Sketch, type InsertSketch } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getSketch(id: string): Promise<Sketch | undefined>;
  getSketchByName(name: string): Promise<Sketch | undefined>;
  createSketch(sketch: InsertSketch): Promise<Sketch>;
  updateSketch(id: string, sketch: Partial<InsertSketch>): Promise<Sketch | undefined>;
  deleteSketch(id: string): Promise<boolean>;
  getAllSketches(): Promise<Sketch[]>;
}

export class MemStorage implements IStorage {
  private sketches: Map<string, Sketch>;

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

  async getSketchByName(name: string): Promise<Sketch | undefined> {
    return Array.from(this.sketches.values()).find(
      (sketch) => sketch.name === name,
    );
  }

  async createSketch(insertSketch: InsertSketch): Promise<Sketch> {
    const id = randomUUID();
    const now = new Date();
    const sketch: Sketch = { 
      ...insertSketch, 
      id, 
      createdAt: now,
      updatedAt: now
    };
    this.sketches.set(id, sketch);
    return sketch;
  }

  async updateSketch(id: string, updateData: Partial<InsertSketch>): Promise<Sketch | undefined> {
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
