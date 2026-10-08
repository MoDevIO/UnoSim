import type { NextFunction, Request, Response } from "express";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Fetch metadata values a page of this origin or the user itself produces. */
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

/**
 * Cross-site request guard for the JSON API. Browsers send a form or text/plain
 * POST cross-site without a CORS preflight, so a foreign page could otherwise drive
 * the API with the victim's network position or identity (in IP gateway mode the
 * network is the access boundary). Mutating requests with a body must be JSON,
 * which a foreign page cannot send without a preflight this server never grants,
 * and browsers that report a cross-site or same-site sender are refused outright.
 */
export function guardApiMutations(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite !== undefined && !ALLOWED_FETCH_SITES.has(fetchSite)) {
    res.status(403).json({ error: "Cross-site API requests are not allowed" });
    return;
  }
  // `req.is` is null without a body and false for any other media type; an empty body carries no data.
  if (!hasEmptyBody(req) && req.is("application/json") === false) {
    res.status(415).json({ error: "API requests must be sent as application/json" });
    return;
  }
  next();
}

function hasEmptyBody(req: Request): boolean {
  return req.headers["transfer-encoding"] === undefined && req.headers["content-length"] === "0";
}
