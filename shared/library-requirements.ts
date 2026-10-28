import { z } from "zod";
import { boundedArray } from "./bounded-array";
import { INPUT_LIMITS } from "./input-limits";

/**
 * The direct library requirements of a project (ssot/ssot_function_definition_Libraries.md §4).
 * Apart from shared/libraries.ts: the request schemas need only these, and the client loads the
 * library rules with the catalog, not with the page.
 */

/** Package names as the Arduino library format uses them; no path separators. */
const LIBRARY_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.+-]*$/;
/** An exact version: no range, wildcard, branch or `latest`. */
const LIBRARY_VERSION = /^\d+(?:\.\d+){1,2}(?:-[0-9A-Za-z.]+)?$/;

export const libraryNameSchema = z.string().min(1).max(INPUT_LIMITS.compile.maxLibraryNameChars).regex(LIBRARY_NAME);
export const libraryVersionSchema = z.string().min(1).max(64).regex(LIBRARY_VERSION);

export const libraryRequirementSchema = z.object({ name: libraryNameSchema, version: libraryVersionSchema }).strict();
export type LibraryRequirement = z.infer<typeof libraryRequirementSchema>;

/** The direct requirements of a project: each name once, with one exact version. */
export const projectLibrariesSchema = boundedArray(libraryRequirementSchema, INPUT_LIMITS.compile.maxLibraries).superRefine((list, ctx) => {
  const seen = new Set<string>();
  for (const [index, requirement] of list.entries()) {
    if (seen.has(requirement.name)) {
      ctx.addIssue({ code: "custom", path: [index, "name"], message: `Library ${requirement.name} is required more than once` });
    }
    seen.add(requirement.name);
  }
});
