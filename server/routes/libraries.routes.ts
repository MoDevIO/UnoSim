import type { Express } from "express";
import { libraryCatalogResponse, type ProvidedLibrary } from "../services/libraries/library-service";

type LibraryRouteDeps = {
  /** The library packages this deployment provides. */
  providedLibraries: () => Promise<readonly ProvidedLibrary[]>;
  /** Main file path under public/examples → id of the built-in example. */
  builtInExampleIds: () => Promise<ReadonlyMap<string, string>>;
};

/**
 * `GET /api/libraries` (SSOT Libraries §5): the curated catalog with this
 * deployment's availability, and for each package example the id under
 * which the examples API loads it. The browser never extends the catalog.
 */
export function registerLibraryRoutes(app: Express, deps: LibraryRouteDeps): void {
  app.get("/api/libraries", async (_req, res) => {
    try {
      const [provided, exampleIds] = await Promise.all([deps.providedLibraries(), deps.builtInExampleIds()]);
      const response = libraryCatalogResponse(provided);
      res.json({
        ...response,
        packages: response.packages.map((entry) => ({
          ...entry,
          examples: entry.examples.map((example) => {
            const exampleId = exampleIds.get(example.path);
            return exampleId ? { ...example, exampleId } : example;
          }),
        })),
      });
    } catch {
      res.status(500).json({ error: "Library catalog is not available" });
    }
  });
}
