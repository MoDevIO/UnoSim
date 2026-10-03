import type { Express, Response } from "express";
import { insertSketchSchema } from "@shared/schema";
import type { RequestIdentity } from "../security/access-control";
import type { OwnedSketchStore } from "../storage";

function subjectOf(res: Response): string | undefined {
  return (res.locals.unosimIdentity as RequestIdentity | undefined)?.subject;
}

export function registerSketchRoutes(app: Express, sketches: OwnedSketchStore): void {
  app.get("/api/sketches", async (_req, res) => {
    try {
      res.json(await sketches.list(subjectOf(res)));
    } catch {
      res.status(500).json({ error: "Failed to fetch sketches" });
    }
  });

  app.get("/api/sketches/:id", async (req, res) => {
    try {
      const sketch = await sketches.get(subjectOf(res), req.params.id);
      if (!sketch) return res.status(404).json({ error: "Sketch not found" });
      res.json(sketch);
    } catch {
      res.status(500).json({ error: "Failed to fetch sketch" });
    }
  });

  app.post("/api/sketches", async (req, res) => {
    try {
      const validatedData = insertSketchSchema.parse(req.body);
      const sketch = await sketches.create(subjectOf(res), validatedData);
      res.status(201).json(sketch);
    } catch {
      res.status(400).json({ error: "Invalid sketch data" });
    }
  });

  app.put("/api/sketches/:id", async (req, res) => {
    try {
      const validatedData = insertSketchSchema.partial().parse(req.body);
      const sketch = await sketches.update(subjectOf(res), req.params.id, validatedData);
      if (!sketch) return res.status(404).json({ error: "Sketch not found" });
      res.json(sketch);
    } catch {
      res.status(400).json({ error: "Invalid sketch data" });
    }
  });

  app.delete("/api/sketches/:id", async (req, res) => {
    try {
      const deleted = await sketches.delete(subjectOf(res), req.params.id);
      if (!deleted) return res.status(404).json({ error: "Sketch not found" });
      res.status(204).send();
    } catch {
      res.status(500).json({ error: "Failed to delete sketch" });
    }
  });
}
