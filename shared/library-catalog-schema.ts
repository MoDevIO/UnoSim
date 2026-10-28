import { z } from "zod";
import { boundedArray } from "./bounded-array";
import { boardIdSchema, RUNTIME_KINDS } from "./boards";
import { INPUT_LIMITS } from "./input-limits";
import { COMPATIBILITY_STATUSES, libraryNameSchema, libraryRequirementSchema, libraryVersionSchema } from "./libraries";

/**
 * Schemas of the curated library packages and of `GET /api/libraries`
 * (ssot/ssot_function_definition_Libraries.md §3, §5). Apart from
 * shared/libraries.ts so the client loads them only with the catalog.
 */

const HEADER_NAME = /^[A-Za-z0-9_][A-Za-z0-9_./+-]*\.(?:h|hpp)$/;
const HEX_64 = /^[0-9a-f]{64}$/;

const statementFields = { status: z.enum(COMPATIBILITY_STATUSES), reason: z.string().min(1).max(300).optional() };

export const libraryPackageSchema = z.object({
  name: libraryNameSchema,
  version: libraryVersionSchema,
  description: z.string().min(1).max(500),
  author: z.string().min(1).max(200),
  license: z.string().min(1).max(100),
  documentationUrl: z.string().url().max(500),
  /** Public headers: a written `#include` of one of them belongs to this package. */
  headers: boundedArray(z.string().regex(HEADER_NAME), 50, 1),
  /** The includes "Einbinden" inserts. */
  includes: boundedArray(z.string().regex(HEADER_NAME), 10, 1),
  dependencies: boundedArray(libraryRequirementSchema, INPUT_LIMITS.compile.maxLibraries),
  /** SHA-256 of the immutable package archive. */
  sha256: z.string().regex(HEX_64),
  examples: boundedArray(z.object({
    title: z.string().min(1).max(160),
    path: z.string().min(1).max(512),
    /** The id of the built-in example at `path`, filled in by the server. */
    exampleId: z.string().min(1).max(128).optional(),
  }).strict(), 20),
  compatibility: z.object({
    compile: z.array(z.object({ board: boardIdSchema, ...statementFields }).strict()),
    runtime: z.array(z.object({ board: boardIdSchema, runtime: z.enum(RUNTIME_KINDS), ...statementFields }).strict()),
  }).strict(),
}).strict();
export type LibraryPackage = z.infer<typeof libraryPackageSchema>;

/** `GET /api/libraries`: the offered packages and whether this deployment provides each one. */
export const libraryCatalogResponseSchema = z.object({
  schemaVersion: z.literal(1),
  packages: z.array(libraryPackageSchema.extend({
    available: z.boolean(),
    unavailableReason: z.string().max(300).optional(),
  }).strict()),
}).strict();
export type LibraryCatalogResponse = z.infer<typeof libraryCatalogResponseSchema>;
export type OfferedLibraryPackage = LibraryCatalogResponse["packages"][number];
