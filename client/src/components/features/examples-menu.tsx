import { useState, useEffect, useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { BookOpen, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  ExternalExamplesError,
  refreshExternalExamplesCatalog,
  useExternalExamples,
} from "@/lib/external-examples";

interface Example {
  id: string;
  title: string;
  category: string;
  source: "builtin" | "external";
  files: Array<{ name: string; path: string }>;
  repository?: string;
  revision?: string;
}

interface ExampleDetail {
  files: Array<{ name: string; content: string }>;
}

interface ExamplesMenuProps {
  readonly onLoadExample: (
    files: Array<{ name: string; content: string }>,
    title: string,
  ) => void;
  readonly backendReachable?: boolean;
}

const KEEP_EXAMPLES_MENU_OPEN_KEY = "unoKeepExamplesMenuOpen";

export function ExamplesMenu({
  onLoadExample,
  backendReachable = true,
}: ExamplesMenuProps) {
  const [examples, setExamples] = useState<Example[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingExampleId, setLoadingExampleId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [keyboardNavActive, setKeyboardNavActive] = useState(false);
  const focusedIndexRef = useRef<number>(-1);
  const { toast } = useToast();
  const { override } = useExternalExamples();
  const loadGeneration = useRef(0);

  useEffect(() => {
    if (!open) return;
    const generation = ++loadGeneration.current;
    let cancelled = false;
    const loadExamples = async () => {
      try {
        setIsLoading(true);
        const payload = await refreshExternalExamplesCatalog();
        if (cancelled || generation !== loadGeneration.current) return;
        const loadedExamples = payload.examples
          .map((example) => ({
            ...example,
            ...(example.source === "external" &&
            payload.source.mode === "repository-ref"
              ? {
                  repository: payload.source.repository!,
                  revision: payload.source.revision!,
                }
              : {}),
          }))
          .toSorted((a, b) =>
            `${a.source}/${a.category}/${a.title}`.localeCompare(
              `${b.source}/${b.category}/${b.title}`,
            ),
          );
        setExamples(loadedExamples);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        console.error("Failed to load examples:", error);
        toast({
          title: "Failed to Load Examples",
          description:
            error instanceof ExternalExamplesError
              ? error.message
              : "Could not load example files",
          variant: "destructive",
        });
      } finally {
        if (!cancelled && generation === loadGeneration.current)
          setIsLoading(false);
      }
    };

    if (backendReachable) {
      loadExamples();
    } else {
      // Clear examples if backend is unreachable
      setExamples([]);
      setIsLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [backendReachable, open, override, toast]);

  // Global shortcut Meta+E to toggle examples menu
  useEffect(() => {
    const isMac = /Mac|Macintosh/.test(navigator.userAgent);
    const onKey = (e: KeyboardEvent) => {
      const isExamplesKey =
        (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && e.code === "KeyE";
      if (isExamplesKey) {
        // Prevent other handlers (Monaco, browser) from acting on this shortcut
        e.preventDefault();
        e.stopPropagation();
        try {
          e.stopImmediatePropagation();
        } catch {}
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  // Keyboard navigation when menu open: arrow keys + enter
  useEffect(() => {
    if (!open) {
      focusedIndexRef.current = -1;
      setKeyboardNavActive(false);
      return;
    }

    const getVisibleItems = () => {
      const all = Array.from<HTMLElement>(
        document.querySelectorAll<HTMLElement>(
          '[data-role="example-source"], [data-role="example-folder"], [data-role="example-item"]',
        ),
      );
      return all.filter(
        (el) =>
          !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      );
    };

    const clearHighlight = () => {
      // Clear from all items including those not currently visible
      const allItems = document.querySelectorAll<HTMLElement>(
        '[data-role="example-source"], [data-role="example-folder"], [data-role="example-item"]',
      );
      allItems.forEach((it) => {
        it.classList.remove(
          "bg-accent",
          "text-accent-foreground",
          "rounded-sm",
        );
        it.dataset.keyboardFocused = "false";
      });
    };

    const highlightItem = (items: HTMLElement[], idx: number) => {
      clearHighlight();
      setKeyboardNavActive(true);
      if (items[idx]) {
        items[idx].classList.add(
          "bg-accent",
          "text-accent-foreground",
          "rounded-sm",
        );
        items[idx].dataset.keyboardFocused = "true";
        items[idx].focus();
      }
    };

    // Handle mouse movement - clear keyboard highlight and re-enable hover
    const onMouseMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-role="example-source"], [data-role="example-folder"], [data-role="example-item"]',
      );
      if (target?.dataset.keyboardFocused === "true") {
        clearHighlight();
        focusedIndexRef.current = -1;
      }
      // Re-enable hover effects when mouse moves
      setKeyboardNavActive(false);
    };

    // Auto-focus the first visible item when menu opens — defer until the
    // DropdownMenuContent has mounted and laid out (RAF).
    const focusFirstVisible = () => {
      const visible = getVisibleItems();
      if (visible.length > 0) {
        focusedIndexRef.current = 0;
        highlightItem(visible, 0);
        return true;
      }
      return false;
    };

    // Try twice with RAF to allow Radix to mount content into the portal.
    requestAnimationFrame(() => {
      if (!focusFirstVisible()) {
        requestAnimationFrame(() => focusFirstVisible());
      }
    });

    const onKey = (e: KeyboardEvent) => {
      const items = getVisibleItems();
      if (items.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        const i = focusedIndexRef.current;
        const next = i + 1 >= items.length ? 0 : i + 1;
        focusedIndexRef.current = next;
        highlightItem(items, next);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const i = focusedIndexRef.current;
        const next = i - 1 < 0 ? items.length - 1 : i - 1;
        focusedIndexRef.current = next;
        highlightItem(items, next);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const idx = Math.max(0, focusedIndexRef.current);
        items[idx]?.click();
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };

    // Add mouse move listener
    globalThis.addEventListener("mousemove", onMouseMove);
    globalThis.addEventListener("keydown", onKey, { capture: true });
    return () => {
      globalThis.removeEventListener("mousemove", onMouseMove);
      globalThis.removeEventListener("keydown", onKey, { capture: true });
      clearHighlight();
    };
  }, [open]);

  const handleLoadExample = async (example: Example) => {
    if (loadingExampleId) return;
    setLoadingExampleId(example.id);
    try {
      let query = "";
      if (example.source === "external") {
        if (!example.repository || !example.revision) {
          throw new Error("Example catalog has no revision context");
        }
        query = `?repository=${encodeURIComponent(example.repository)}&revision=${encodeURIComponent(example.revision)}`;
      }
      const response = await fetch(
        `/api/examples/${encodeURIComponent(example.id)}${query}`,
      );
      if (!response.ok) throw new Error("Failed to fetch example");
      const detail = (await response.json()) as ExampleDetail;
      if (!Array.isArray(detail.files) || detail.files.length === 0) {
        throw new Error("Example contains no files");
      }
      const displayName = getExampleDisplayName(example);
      onLoadExample(detail.files, displayName);
      toast({
        title: "Example Loaded",
        description: `${displayName} has been loaded into the editor`,
      });

      // Close menu after loading example unless "keep open" setting is enabled
      try {
        if (
          globalThis.localStorage.getItem(KEEP_EXAMPLES_MENU_OPEN_KEY) !== "1"
        ) {
          setOpen(false);
        }
      } catch {
        setOpen(false);
      }
    } catch (error) {
      console.error(`Failed to load example ${example.id}:`, error);
      toast({
        title: "Failed to Load Example",
        description: "Could not load the selected example",
        variant: "destructive",
      });
    } finally {
      setLoadingExampleId(null);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={(v) => setOpen(!!v)}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
          aria-label="Examples"
          title="Examples (Cmd/Ctrl+E)"
        >
          <BookOpen className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72 max-w-[calc(100vw-1rem)] overflow-y-auto p-0"
        style={{
          maxHeight:
            "calc(var(--radix-dropdown-menu-content-available-height) - 10px)",
        }}
        data-keyboard-nav={keyboardNavActive}
      >
        <div className="px-2 py-1.5">
          <div className="ui-type-menu-title font-semibold mb-1">
            Load Example
          </div>
        </div>
        <div className="border-t" />

        {examples.length === 0 && !isLoading && (
          <div className="px-2 py-1.5 ui-type-menu-item text-muted-foreground">
            No examples available
          </div>
        )}

        {isLoading && (
          <div className="px-2 py-1.5 ui-type-menu-item text-muted-foreground">
            Loading examples...
          </div>
        )}

        {!isLoading && examples.length > 0 && (
          <ExamplesTree examples={examples} onLoadExample={handleLoadExample} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ExamplesTreeProps {
  readonly examples: Example[];
  readonly onLoadExample: (example: Example) => void;
}

type ExampleSource = Example["source"];

function groupExamplesBySource(
  items: Example[],
): Record<ExampleSource, Example[]> {
  const grouped: Record<ExampleSource, Example[]> = {
    builtin: [],
    external: [],
  };
  items.forEach((item) => {
    grouped[item.source].push(item);
  });
  return grouped;
}

function groupExamplesByCategory(items: Example[]): Record<string, Example[]> {
  const grouped: Record<string, Example[]> = {};
  items.forEach((item) => {
    const category = item.category || "Other";
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  });
  return grouped;
}

function getExampleDisplayName(example: Example): string {
  if (example.source !== "builtin") return example.title;
  return (
    example.files.find((file) => file.name.toLowerCase().endsWith(".ino"))
      ?.name ?? example.title
  );
}

interface ExampleItemProps {
  readonly example: Example;
  readonly onLoadExample: (example: Example) => void;
  readonly compact?: boolean;
}

function ExampleItem({
  example,
  onLoadExample,
  compact = false,
}: ExampleItemProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onLoadExample(example)}
      data-role="example-item"
      tabIndex={0}
      className={
        compact
          ? "ui-type-menu-item w-full h-7 min-h-7 px-4 py-1 text-left flex items-center justify-start gap-2 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 [*[data-keyboard-nav='true']_&]:hover:bg-transparent [*[data-keyboard-nav='true']_&]:hover:text-current"
          : "ui-type-menu-item w-full px-8 py-1 text-left flex items-center justify-start gap-2 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 [*[data-keyboard-nav='true']_&]:hover:bg-transparent [*[data-keyboard-nav='true']_&]:hover:text-current"
      }
      title={getExampleDisplayName(example)}
    >
      <span
        className={
          compact
            ? "flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
            : "text-muted-foreground"
        }
      >
        •
      </span>
      <span
        className={
          compact ? "min-w-0 flex-1 truncate whitespace-nowrap" : "w-full"
        }
      >
        {getExampleDisplayName(example)}
      </span>
    </Button>
  );
}

function ExamplesTree({ examples, onLoadExample }: ExamplesTreeProps) {
  const [expandedSource, setExpandedSource] = useState<ExampleSource | null>(
    null,
  );
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  function toggleSource(source: ExampleSource) {
    if (expandedSource === source) {
      setExpandedSource(null);
      setExpandedCategory(null);
    } else {
      setExpandedSource(source);
      setExpandedCategory(null);
    }
  }

  function toggleCategory(source: ExampleSource, category: string) {
    const categoryKey = `${source}:${category}`;
    setExpandedCategory((current) =>
      current === categoryKey ? null : categoryKey,
    );
  }

  const sourceLabels: Record<ExampleSource, string> = {
    builtin: "Built-in",
    external: "External",
  };
  const groupedBySource = groupExamplesBySource(examples);

  return (
    <div className="py-1">
      {(["builtin", "external"] as const)
        .filter((source) => groupedBySource[source].length > 0)
        .map((source) => {
          const isSourceExpanded = expandedSource === source;
          const groupedByCategory = groupExamplesByCategory(
            groupedBySource[source],
          );

          return (
            <div key={source}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleSource(source)}
                data-role="example-source"
                data-source={source}
                tabIndex={0}
                className="w-full px-2 py-1.5 ui-type-section-header text-left flex items-center justify-start gap-1 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 [*[data-keyboard-nav='true']_&]:hover:bg-transparent [*[data-keyboard-nav='true']_&]:hover:text-current"
              >
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${isSourceExpanded ? "rotate-90" : ""}`}
                />
                <span className="font-medium w-full">
                  {sourceLabels[source]}
                </span>
              </Button>

              {isSourceExpanded && (
                <div className="bg-muted/10">
                  {source === "builtin"
                    ? groupedBySource[source]
                        .toSorted((a, b) =>
                          getExampleDisplayName(a).localeCompare(
                            getExampleDisplayName(b),
                          ),
                        )
                        .map((example) => (
                          <ExampleItem
                            key={example.id}
                            example={example}
                            onLoadExample={onLoadExample}
                            compact
                          />
                        ))
                    : Object.entries(groupedByCategory)
                        .toSorted(([a], [b]) => a.localeCompare(b))
                        .map(([category, items]) => {
                          const categoryKey = `${source}:${category}`;
                          const isCategoryExpanded =
                            expandedCategory === categoryKey;
                          const cleanCategoryName = category.replace(
                            /^\d+-/,
                            "",
                          );

                          return (
                            <div key={categoryKey}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleCategory(source, category)}
                                data-role="example-folder"
                                data-folder={categoryKey}
                                tabIndex={0}
                                className="w-full px-4 py-1.5 ui-type-section-header text-left flex items-center justify-start gap-1 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 [*[data-keyboard-nav='true']_&]:hover:bg-transparent [*[data-keyboard-nav='true']_&]:hover:text-current"
                              >
                                <ChevronRight
                                  className={`h-4 w-4 transition-transform ${isCategoryExpanded ? "rotate-90" : ""}`}
                                />
                                <span className="font-normal w-full">
                                  {cleanCategoryName}
                                </span>
                              </Button>

                              {isCategoryExpanded && (
                                <div className="bg-muted/30">
                                  {items
                                    .toSorted((a, b) =>
                                      a.title.localeCompare(b.title),
                                    )
                                    .map((example) => (
                                      <ExampleItem
                                        key={example.id}
                                        example={example}
                                        onLoadExample={onLoadExample}
                                      />
                                    ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
