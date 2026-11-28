import { Button } from "@/components/ui/button";
import type { LibraryIncludeHint, LibraryRequirement } from "@shared/libraries";

/**
 * Hints for written or pasted includes of known library headers the project
 * does not select (SSOT Libraries §7). Nothing is added without a click.
 */
export function LibraryHintsBar({ hints, onAdd }: { readonly hints: readonly LibraryIncludeHint[]; readonly onAdd: (requirement: LibraryRequirement) => void }) {
  if (hints.length === 0) return null;
  return (
    <output className="flex flex-col gap-1 border-b border-border bg-muted/40 px-3 py-1.5 text-ui-sm">
      {hints.map((hint) => (
        <div key={hint.header} className="flex flex-wrap items-center gap-2">
          <span>
            {hint.candidates.length === 1
              ? `${hint.header} detected. ${hint.candidates[0].name} is not in the project libraries yet.`
              : `${hint.header} detected. Several libraries provide this header:`}
          </span>
          {hint.candidates.map((candidate) => (
            <Button key={`${candidate.name}@${candidate.version}`} size="sm" variant="outline" onClick={() => onAdd(candidate)}>
              Add {candidate.name} {candidate.version}
            </Button>
          ))}
        </div>
      ))}
    </output>
  );
}
