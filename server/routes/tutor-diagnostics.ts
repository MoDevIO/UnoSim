import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { config } from "../config";
import { tutorDiagnosticOperation } from "@shared/tutor-diagnostics";
import { getTutorDiagnostics, getTutorReview, reportTutorDiagnostic, withTutorDiagnostics } from "../services/tutor/tutor-diagnostics";
import { TUTOR_PROMPT_REVISION } from "../services/tutor/tutor-service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestId = (value: string | undefined) => value && UUID.test(value) ? value : randomUUID();

/** Decorates only the outbound copy: Support's cached learning result never contains diagnostics or review data. */
export const tutorDiagnosticMiddleware: RequestHandler = (req, res, next) => {
  if (!config.tutor.diagnosticsEnabled || req.header("x-unosim-tutor-debug") !== "1" || !res.locals.unosimIdentity) { next(); return; }
  const operation = tutorDiagnosticOperation(req.path);
  const traceId = requestId(req.header("x-unosim-tutor-trace-id"));
  const id = requestId(req.header("x-request-id"));
  const started = Date.now();
  withTutorDiagnostics({ traceId, requestId: id, operation, credential: typeof req.body?.credential === "string" ? req.body.credential : undefined }, () => {
    reportTutorDiagnostic({ origin: "service", stage: "request", outcome: "started" });
    const json = res.json.bind(res);
    res.setHeader("Cache-Control", "no-store");
    res.json = (body: unknown) => {
      reportTutorDiagnostic({ origin: "service", stage: "request", outcome: res.statusCode < 400 ? "completed" : "failed", statusCode: res.statusCode, durationMs: Math.min(Date.now() - started, 1_000_000_000) });
      const diagnostics = getTutorDiagnostics();
      // Only the two allowed revision fields; the revision object also holds the full prompt sources.
      const review = getTutorReview({ id: TUTOR_PROMPT_REVISION.id, templateDigest: TUTOR_PROMPT_REVISION.templateDigest });
      return json(typeof body === "object" && body !== null && !Array.isArray(body) ? { ...body, diagnostics, review } : body);
    };
    next();
  });
};
