import { tutorUmlRenderer } from "../services/tutor/uml/service";
import { TUTOR_UML_PROFILE } from "@shared/tutor-uml-profile";
import type { Express } from "express";
import { getClientConfig } from "../config";

export function registerConfigRoutes(app: Express): void {
  app.get("/api/config", async (_req, res) => {
    const available = await tutorUmlRenderer.available().catch(() => false);
    res.json({ ...getClientConfig(), tutorGraphics: { profiles: [TUTOR_UML_PROFILE], available } });
  });
}
