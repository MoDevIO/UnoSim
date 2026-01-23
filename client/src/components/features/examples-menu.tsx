import { useState, useEffect, useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { BookOpen, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Example {
  name: string;
  filename: string;
  content: string;
}

interface ExamplesMenuProps {
  onLoadExample: (filename: string, content: string) => void;
  backendReachable?: boolean;
}

const KEEP_EXAMPLES_MENU_OPEN_KEY = "unoKeepExamplesMenuOpen";

export function ExamplesMenu({
  onLoadExample,
  backendReachable = true,
}: ExamplesMenuProps) {
  const [examples, setExamples] = useState<Example[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const focusedIndexRef = useRef<number>(-1);
  const { toast } = useToast();

  useEffect(() => {
    const loadExamples = async () => {
      try {
        setIsLoading(true);

        // Fetch the list of examples from the server
        const response = await fetch("/api/examples");
        if (!response.ok) {
          throw new Error("Failed to fetch examples list");
        }

        const fileList: string[] = await response.json();
        const loadedExamples: Example[] = [];

        // Load each example file
        for (const filename of fileList) {
          try {
            const fileResponse = await fetch(`/examples/${filename}`);
            if (fileResponse.ok) {
              const content = await fileResponse.text();
              // Extract display name: remove leading numbers and hyphens
              const displayName =
                filename.split("/").pop()?.replace(/^\d+-/, "") || filename;

              loadedExamples.push({
                name: displayName,
                filename: filename,
                content: content,
              });
            }
          } catch (error) {
            console.error(`Failed to load example ${filename}:`, error);
          }
        }

        // Sort examples by filename
        loadedExamples.sort((a, b) => a.filename.localeCompare(b.filename));
        setExamples(loadedExamples);
      } catch (error) {
        console.error("Failed to load examples:", error);
        toast({
          title: "Failed to Load Examples",
          description: "Could not load example files",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    // Only load if backend is reachable
    if (backendReachable) {
      loadExamples();
    } else {
      // Clear examples if backend is unreachable
      setExamples([]);
      setIsLoading(false);
    }
  }, [backendReachable, toast]);

  // Global shortcut Meta+E to toggle examples menu
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
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
      return;
    }

    const getVisibleItems = () => {
      const all = Array.from(
        document.querySelectorAll(
          '[data-role="example-folder"], [data-role="example-item"]',
        ),
      ) as HTMLElement[];
      return all.filter(
        (el) =>
          !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      );
    };

    const clearHighlight = () => {
      const items = getVisibleItems();
      items.forEach((it) => {
        it.classList.remove(
          "bg-accent",
          "text-accent-foreground",
          "rounded-sm",
        );
        it.setAttribute("data-keyboard-focused", "false");
      });
    };

    const highlightItem = (items: HTMLElement[], idx: number) => {
      clearHighlight();
      if (items[idx]) {
        items[idx].classList.add(
          "bg-accent",
          "text-accent-foreground",
          "rounded-sm",
        );
        items[idx].setAttribute("data-keyboard-focused", "true");
        items[idx].focus();
      }
    };

    // Handle mouse movement - clear keyboard highlight
    const onMouseMove = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest(
        '[data-role="example-folder"], [data-role="example-item"]',
      ) as HTMLElement;
      if (target && target.getAttribute("data-keyboard-focused") === "true") {
        clearHighlight();
        focusedIndexRef.current = -1;
      }
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
        const next = i + 1 >= items.length ? 0 : Math.max(0, i + 1);
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
        const idx = focusedIndexRef.current >= 0 ? focusedIndexRef.current : 0;
        items[idx]?.click();
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };

    // Add mouse move listener
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("keydown", onKey, { capture: true });
      clearHighlight();
    };
  }, [open]);

  const handleLoadExample = (example: Example) => {
    onLoadExample(example.filename, example.content);
    toast({
      title: "Example Loaded",
      description: `${example.filename} has been loaded into the editor`,
    });

    // Close menu after loading example unless "keep open" setting is enabled
    try {
      const keepOpen =
        window.localStorage.getItem(KEEP_EXAMPLES_MENU_OPEN_KEY) === "1";
      if (!keepOpen) {
        setOpen(false);
      }
    } catch {
      // If storage fails, default to closing the menu
      setOpen(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={(v) => setOpen(!!v)}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex items-center justify-center"
          disabled={isLoading}
          aria-label="Examples"
          title="Examples (Cmd/Ctrl+E)"
        >
          <BookOpen className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 max-h-96 overflow-y-auto p-0"
      >
        <div className="px-2 py-1.5">
          <div className="text-ui-xs font-semibold mb-1">Load Example</div>
        </div>
        <div className="border-t" />

        {examples.length === 0 && !isLoading && (
          <div className="px-2 py-1.5 text-ui-xs text-muted-foreground">
            No examples available
          </div>
        )}

        {isLoading && (
          <div className="px-2 py-1.5 text-ui-xs text-muted-foreground">
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
  examples: Example[];
  onLoadExample: (example: Example) => void;
}

function ExamplesTree({ examples, onLoadExample }: ExamplesTreeProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );

  function groupExamplesByFolder(items: Example[]): Record<string, Example[]> {
    const grouped: Record<string, Example[]> = {};
    items.forEach((item) => {
      const parts = item.filename.split("/");
      const folder = parts.length > 1 ? parts[0] : "Other";
      if (!grouped[folder]) grouped[folder] = [];
      grouped[folder].push(item);
    });
    return grouped;
  }

  function toggleFolder(folder: string) {
    const newSet = new Set(expandedFolders);
    if (newSet.has(folder)) {
      newSet.delete(folder);
    } else {
      newSet.add(folder);
    }
    setExpandedFolders(newSet);
  }

  const grouped = groupExamplesByFolder(examples);

  return (
    <div className="py-1">
      {Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([folder, items]) => {
          const isExpanded = expandedFolders.has(folder);
          const cleanFolderName = folder.replace(/^\d+-/, "");

          return (
            <div key={folder}>
              <Button
                variant="ghost"
                size="small"
                onClick={() => toggleFolder(folder)}
                data-role="example-folder"
                data-folder={folder}
                tabIndex={0}
                className="w-full px-2 py-1.5 text-ui-sm flex items-center justify-start gap-1 text-left focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                style={{ justifyContent: 'flex-start' }}
              >
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                />
                <span className="font-medium text-ui-xs text-left w-full">
                  {cleanFolderName}
                </span>
              </Button>

              {isExpanded && (
                <div className="bg-muted/30">
                  {items
                    .sort((a, b) => a.filename.localeCompare(b.filename))
                    .map((example, idx) => (
                      <Button
                        key={example.filename}
                        variant="ghost"
                        size="small"
                        onClick={() => onLoadExample(example)}
                        data-role="example-item"
                        data-example-index={idx}
                        tabIndex={0}
                        className="w-full px-4 py-1 text-ui-xs flex items-center justify-start gap-2 text-left focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                        style={{ justifyContent: 'flex-start' }}
                      >
                        <span className="text-muted-foreground">•</span>
                        <span className="text-left w-full">{example.name}</span>
                      </Button>
                    ))}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
