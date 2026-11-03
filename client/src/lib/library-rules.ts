import { describeResolutionProblem, findLibraryIncludeHints, insertIncludes, resolveLibraryGraph } from "@shared/libraries";
import { addRequirement, startBlockReason } from "@/lib/project-libraries";

/** The library rules of the Libraries dialog, loaded with the catalog: they are not part of the initial load path. */
export const libraryRules = {
  shared: { describeResolutionProblem, findLibraryIncludeHints, insertIncludes, resolveLibraryGraph },
  local: { addRequirement, startBlockReason },
};

export type LibraryRules = typeof libraryRules;
