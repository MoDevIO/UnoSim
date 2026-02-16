import type { Express } from "express";

// Placeholder for Session & Auth route registrations. Currently there are no
// explicit authentication endpoints in the monolithic `routes.ts`. This
// module centralizes future session/auth logic so the main `registerRoutes`
// can remain concise and focused.

export function registerAuthRoutes(_app: Express) {
  // Example health endpoint could live here in future; keep as no-op for now.
  // If/when session endpoints (login/logout) are added, register them here.
}
