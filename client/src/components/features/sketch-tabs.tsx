import { useState, useRef, useEffect } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Wand2,
  Pen,
  Trash2,
  Plus,
  Download,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { clsx } from "clsx";

interface Tab {
  id: string;
  name: string;
  content: string;
}

interface SketchTabsProps {
  tabs: Tab[];
  activeTabId: string | null;
  modifiedTabId: string | null;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabRename: (tabId: string, newName: string) => void;
  onTabAdd: () => void;
  onFilesLoaded?: (
    files: Array<{ name: string; content: string }>,
    replaceAll: boolean,
  ) => void;
  onFormatCode?: () => void;
  examplesMenu?: React.ReactNode;
}

export function SketchTabs({
  tabs,
  activeTabId,
  modifiedTabId,
  onTabClick,
  onTabClose,
  onTabRename,
  onTabAdd,
  onFilesLoaded,
  onFormatCode,
  examplesMenu,
}: SketchTabsProps) {
  const { toast } = useToast();
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [deleteConfirmTabId, setDeleteConfirmTabId] = useState<string | null>(
    null,
  );
  const [isReplaceConfirmOpen, setIsReplaceConfirmOpen] = useState(false);
  const [pendingFilesToLoad, setPendingFilesToLoad] = useState<Array<{
    name: string;
    content: string;
  }> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const container = tabsContainerRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth,
      );
    }
  };

  useEffect(() => {
    checkScroll();
    const container = tabsContainerRef.current;
    container?.addEventListener("scroll", checkScroll);
    window.addEventListener("resize", checkScroll);
    return () => {
      container?.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [tabs]);

  useEffect(() => {
    // Focus and select text in input when renaming starts
    if (renamingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingTabId]);

  const scroll = (direction: "left" | "right") => {
    const container = tabsContainerRef.current;
    if (container) {
      const scrollAmount = 200;
      container.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  const handleRenameStart = (tabId: string, currentName: string) => {
    setRenamingTabId(tabId);
    // Remove file extension for display
    const nameWithoutExtension = currentName.substring(
      0,
      currentName.lastIndexOf("."),
    );
    setNewName(nameWithoutExtension);
  };

  const handleRenameStartDialog = (tabId: string, currentName: string) => {
    setRenamingTabId(tabId);
    // Remove file extension for display
    const nameWithoutExtension = currentName.substring(
      0,
      currentName.lastIndexOf("."),
    );
    setNewName(nameWithoutExtension);
    setIsRenameDialogOpen(true);
  };

  const handleRenameSave = () => {
    if (newName.trim() && renamingTabId) {
      const currentTab = tabs.find((t) => t.id === renamingTabId);
      if (currentTab) {
        // Extract the file extension
        const extension = currentTab.name.substring(
          currentTab.name.lastIndexOf("."),
        );
        // Remove extension from new name if user included it
        let baseName = newName.trim();
        if (baseName.endsWith(extension)) {
          baseName = baseName.substring(0, baseName.length - extension.length);
        }
        // Combine base name with original extension
        const finalName = baseName + extension;
        onTabRename(renamingTabId, finalName);
      }
      setIsRenameDialogOpen(false);
    }
    setRenamingTabId(null);
    setNewName("");
  };

  const handleRenameCancel = () => {
    setIsRenameDialogOpen(false);
    setRenamingTabId(null);
    setNewName("");
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirmTabId) {
      onTabClose(deleteConfirmTabId);
      setDeleteConfirmTabId(null);
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    try {
      const loadedFiles: Array<{ name: string; content: string }> = [];
      let inoCount = 0;

      // Read all files
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const extension = file.name.substring(file.name.lastIndexOf("."));

        // Only allow .ino and .h files
        if (extension !== ".ino" && extension !== ".h") {
          toast({
            title: "Unsupported File Type",
            description: `"${file.name}" is not supported. Please only upload .ino and .h files.`,
            variant: "destructive",
          });
          return;
        }

        if (extension === ".ino") {
          inoCount++;
        }

        // Read file content
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve(e.target?.result as string);
          };
          reader.onerror = () => {
            reject(new Error(`Error reading ${file.name}`));
          };
          reader.readAsText(file);
        });

        loadedFiles.push({
          name: file.name,
          content: content,
        });
      }

      // Multiple .ino files not allowed
      if (inoCount > 1) {
        toast({
          title: "Too many .ino files",
          description: "Only one .ino file can be loaded.",
          variant: "destructive",
        });
        return;
      }

      // If .ino file is present, show confirmation dialog
      if (inoCount === 1) {
        setPendingFilesToLoad(loadedFiles);
        setIsReplaceConfirmOpen(true);
      } else {
        // Only .h files: add them directly
        if (onFilesLoaded) {
          onFilesLoaded(loadedFiles, false); // false = don't replace all
        }

        toast({
          title: "Header files loaded",
          description: `${loadedFiles.length} header file(s) added`,
        });
      }
    } catch (error) {
      toast({
        title: "Error Loading",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleReplaceConfirmYes = () => {
    if (pendingFilesToLoad && onFilesLoaded) {
      onFilesLoaded(pendingFilesToLoad, true); // true = replace all
      toast({
        title: "Sketch replaced",
        description: `${pendingFilesToLoad.length} file(s) loaded`,
      });
    }
    setIsReplaceConfirmOpen(false);
    setPendingFilesToLoad(null);
  };

  const handleReplaceConfirmNo = () => {
    // Only add .h files, skip the .ino
    if (pendingFilesToLoad && onFilesLoaded) {
      const hFiles = pendingFilesToLoad.filter((f) => f.name.endsWith(".h"));
      if (hFiles.length > 0) {
        onFilesLoaded(hFiles, false); // false = don't replace all
        toast({
          title: "Header files loaded",
          description: `${hFiles.length} header file(s) added`,
        });
      } else {
        toast({
          title: "No header files",
          description: "Only .ino files were present.",
        });
      }
    }
    setIsReplaceConfirmOpen(false);
    setPendingFilesToLoad(null);
  };

  // mark handler as intentionally present to satisfy TS noUnusedLocals
  void handleReplaceConfirmNo;

  const downloadAllTabs = async () => {
    try {
      // Download each file individually
      tabs.forEach((tab, index) => {
        setTimeout(() => {
          const element = document.createElement("a");
          element.setAttribute(
            "href",
            "data:text/plain;charset=utf-8," + encodeURIComponent(tab.content),
          );
          element.setAttribute("download", tab.name);
          element.style.display = "none";
          document.body.appendChild(element);
          element.click();
          document.body.removeChild(element);
        }, index * 200); // Stagger downloads to avoid browser throttling
      });

      // Show success toast after all downloads are initiated
      setTimeout(
        () => {
          toast({
            title: "Download started",
            description: `${tabs.length} file(s) downloading`,
          });
        },
        tabs.length * 200 + 100,
      );
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div
      className="flex items-center bg-muted border-b border-border px-2"
      style={{ minHeight: "var(--ui-header-height)" }}
    >
      {/* Scroll left button */}
      {canScrollLeft && (
        <Button
          variant="outline"
          size="sm"
          className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex-shrink-0"
          onClick={() => scroll("left")}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Tabs container with overflow */}
      <div
        ref={tabsContainerRef}
        className="flex items-center overflow-x-auto flex-1 scrollbar-hide"
        style={{
          scrollBehavior: "smooth",
          minHeight: "var(--ui-header-height)",
        }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={clsx(
              "flex items-center space-x-2 px-4 mr-2 cursor-pointer transition-colors flex-shrink-0 group rounded-md",
              activeTabId === tab.id
                ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                : "hover:bg-muted/80 text-muted-foreground",
            )}
            style={{
              height: "var(--ui-button-height)",
              lineHeight: "var(--ui-button-height)",
              display: "flex",
              alignItems: "center",
              fontSize: "var(--ui-control-font-size)",
            }}
            onClick={() => {
              if (renamingTabId !== tab.id) {
                onTabClick(tab.id);
              }
            }}
          >
            {renamingTabId === tab.id ? (
              <Input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    handleRenameSave();
                  } else if (e.key === "Escape") {
                    handleRenameCancel();
                  }
                }}
                onBlur={handleRenameSave}
                className="w-24 px-2 py-1 text-ui-sm"
                style={{
                  height: "var(--ui-button-height)",
                  fontSize: "var(--ui-control-font-size)",
                  lineHeight: "var(--ui-button-height)",
                }}
              />
            ) : (
              <>
                <span
                  className="text-ui-sm whitespace-nowrap cursor-pointer hover:underline"
                  style={{
                    fontSize: "var(--ui-control-font-size)",
                    lineHeight: "var(--ui-button-height)",
                    height: "var(--ui-button-height)",
                    display: "flex",
                    alignItems: "center",
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    handleRenameStart(tab.id, tab.name);
                  }}
                >
                  {tab.name}
                  {modifiedTabId === tab.id && <span className="ml-1">•</span>}
                </span>
                {tabs[0]?.id !== tab.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 ml-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirmTabId(tab.id);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </>
            )}
          </div>
        ))}

        {/* Context Menu Button */}
        <div className="flex items-center px-2 flex-shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0"
                title="Options"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onTabAdd}>
                <Plus className="h-4 w-4 mr-2" />
                New File
              </DropdownMenuItem>
              {onFormatCode && (
                <DropdownMenuItem onClick={onFormatCode}>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Format Code
                </DropdownMenuItem>
              )}
              {activeTabId && (
                <DropdownMenuItem
                  onClick={() => {
                    const activeTab = tabs.find((t) => t.id === activeTabId);
                    if (activeTab) {
                      handleRenameStartDialog(activeTabId, activeTab.name);
                    }
                  }}
                >
                  <Pen className="h-4 w-4 mr-2" />
                  Rename
                </DropdownMenuItem>
              )}
              {activeTabId && tabs[0]?.id !== activeTabId && (
                <DropdownMenuItem
                  onClick={() => setDeleteConfirmTabId(activeTabId)}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete File
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
                Load Files
              </DropdownMenuItem>
              <DropdownMenuItem onClick={downloadAllTabs}>
                <Download className="h-4 w-4 mr-2" />
                Download All Files
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".ino,.h"
          onChange={handleFileUpload}
          style={{ display: "none" }}
        />

        {/* Examples Menu - Right-aligned */}
        <div className="ml-auto flex items-center px-2 flex-shrink-0">
          {examplesMenu}
        </div>
      </div>

      {/* Scroll right button */}
      {canScrollRight && (
        <Button
          variant="outline"
          size="sm"
          className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex-shrink-0"
          onClick={() => scroll("right")}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteConfirmTabId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmTabId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "
              {tabs.find((t) => t.id === deleteConfirmTabId)?.name}"? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleRenameSave();
              } else if (e.key === "Escape") {
                handleRenameCancel();
              }
            }}
            placeholder="Enter new name..."
          />
          <DialogFooter>
            <Button variant="outline" onClick={handleRenameCancel}>
              Cancel
            </Button>
            <Button onClick={handleRenameSave}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replace Sketch Confirmation Dialog */}
      <AlertDialog
        open={isReplaceConfirmOpen}
        onOpenChange={setIsReplaceConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sketch ersetzen?</AlertDialogTitle>
            <AlertDialogDescription>
              Es wurde eine .ino-Datei zum Laden ausgewählt. Möchtest du den
              aktuellen Sketch ersetzen?
              <br />
              <br />
              <strong>Ja:</strong> Der aktuelle Sketch wird vollständig ersetzt
              <br />
              <strong>Nein:</strong> Nur die Header-Dateien (.h) werden
              hinzugefügt
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Nein (nur .h Dateien)</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReplaceConfirmYes}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Ja (Sketch ersetzen)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
