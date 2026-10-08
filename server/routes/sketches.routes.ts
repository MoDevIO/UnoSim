import type { Express } from "express";
import type { DefaultSketchStore } from "../storage";

/** Read-only: the client only loads the default sketch, so the API exposes no sketch mutations. */
export function registerSketchRoutes(app: Express, sketches: DefaultSketchStore): void {
  app.get("/api/sketches", async (_req, res) => {
    try {
      res.json(await sketches.getAllSketches());
    } catch {
      res.status(500).json({ error: "Failed to fetch sketches" });
    }
  });

  app.get("/api/sketches/:id", async (req, res) => {
    try {
      const sketch = await sketches.getSketch(req.params.id);
      if (!sketch) return res.status(404).json({ error: "Sketch not found" });
      res.json(sketch);
    } catch {
      res.status(500).json({ error: "Failed to fetch sketch" });
    }
  });
}
