import type { Express } from "express";
import { getClientConfig } from "../config";

export function registerConfigRoutes(app: Express): void {
  app.get("/api/config", (_req, res) => {
    res.json(getClientConfig());
  });
}
