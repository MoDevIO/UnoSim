import type { Express } from "express";
import { ExamplesRepository } from "../services/examples/examples-repository";

export function registerExamplesRoutes(app: Express, repository: ExamplesRepository): void {
  app.get("/api/examples", async (_req, res) => {
    try {
      res.json(await repository.getCatalog());
    } catch {
      res.status(500).json({ error: "Failed to fetch examples" });
    }
  });

  app.get("/api/examples/:id", async (req, res) => {
    try {
      const example = await repository.getExample(req.params.id);
      if (!example) return res.status(404).json({ error: "Example not found" });
      res.json(example);
    } catch {
      res.status(500).json({ error: "Failed to fetch example" });
    }
  });
}

