import { useState, useRef, useEffect } from "react";
import {
  X,
  MoreVertical,
  Wand2,
  Pen,
  Trash2,
  Plus,
  Download,
  Upload,
  FileCode2,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { TabBar } from "@/components/ui/tab-bar";
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
import { UnifiedScrollArea } from "@/components/ui/unified-scroll-area";

interface Tab {
  id: string;
  name: string;
  content: string;
}

interface SketchTabsProps {
  readonly tabs: Tab[];
  readonly activeTabId: string | null;
  readonly modifiedTabId: string | null;
  readonly onTabClick: (tabId: string) => void;
  readonly onTabClose: (tabId: string) => void;
  readonly onTabRename: (tabId: string, newName: string) => void;
  readonly onTabAdd: () => void;
  readonly onFilesLoaded?: (
    files: Array<{ name: string; content: string }>,
    replaceAll: boolean,
  ) => void;
  readonly onFormatCode?: () => void;
  readonly examplesMenu?: React.ReactNode;
}

function getDisplayFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus and select text in input when renaming starts
    if (renamingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingTabId]);

  const handleRenameStart = (tabId: string, currentName: string) => {
    setRenamingTabId(tabId);
    // Remove file extension for display
    const nameWithoutExtension = currentName.slice(
      0,
      Math.max(0, currentName.lastIndexOf(".")),
    );
    setNewName(nameWithoutExtension);
  };

  const handleRenameStartDialog = (tabId: string, currentName: string) => {
    setRenamingTabId(tabId);
    // Remove file extension for display
    const nameWithoutExtension = currentName.slice(
      0,
      Math.max(0, currentName.lastIndexOf(".")),
    );
    setNewName(nameWithoutExtension);
    setIsRenameDialogOpen(true);
  };

  const handleRenameSave = () => {
    if (newName.trim() && renamingTabId) {
      const currentTab = tabs.find((t) => t.id === renamingTabId);
      if (currentTab) {
        // Extract the file extension
        const extension = currentTab.name.slice(
          Math.max(0, currentTab.name.lastIndexOf(".")),
        );
        // Remove extension from new name if user included it
        let baseName = newName.trim();
        if (baseName.endsWith(extension)) {
          baseName = baseName.slice(0, Math.max(0, baseName.length - extension.length));
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
      for (const file of files) {
        const extension = file.name.slice(Math.max(0, file.name.lastIndexOf(".")));

        // Only allow .ino and .h files
        if (![".ino", ".h"].includes(extension)) {
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
        const content = await file.text();

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
          element.remove();
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
    <TabBar
      className="relative flex items-center bg-[#181818] border-b border-[#2b2b2b] px-0"
      style={{ height: "var(--ui-header-height)" }}
    >
      {/* Tabs container with overflow */}
      <UnifiedScrollArea
        orientation="horizontal"
        className="flex-1 h-full"
        viewportClassName="flex items-center overflow-y-hidden"
        viewportProps={{ style: { scrollBehavior: "smooth", touchAction: "pan-x" } }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={clsx(
              "relative flex items-center flex-shrink-0 group mr-0 border-r border-[#2b2b2b]",
              activeTabId === tab.id
                ? "bg-[#121212] tabs-active"
                : "bg-[#181818]",
            )}
            style={{
              height: "var(--ui-button-height)",
              display: "flex",
              alignItems: "center",
              fontSize: "var(--ui-control-font-size)",
              maxWidth: "200px",
            }}
          >
            {activeTabId === tab.id && (
              <span
                aria-hidden="true"
                className="absolute top-0 left-0 right-0 h-0.5 bg-[#007acc] z-10 pointer-events-none"
              />
            )}
            {renamingTabId === tab.id ? (
              <div className="px-3 flex items-center" style={{ height: "var(--ui-button-height)" }}>
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
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className={clsx(
                    "flex items-center gap-2 px-3 cursor-pointer transition-colors min-w-0",
                    activeTabId === tab.id
                      ? "text-[#f3f3f3]"
                      : "hover:bg-[#252526] text-[#9d9d9d]",
                  )}
                  style={{
                    height: "var(--ui-button-height)",
                    lineHeight: "var(--ui-button-height)",
                    display: "flex",
                    alignItems: "center",
                    fontSize: "var(--ui-control-font-size)",
                    background: "transparent",
                    border: "none",
                    flex: "1",
                    minWidth: "0",
                  }}
                  onClick={() => onTabClick(tab.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onTabClick(tab.id);
                    } else if (e.key === "F2") {
                      e.preventDefault();
                      handleRenameStart(tab.id, tab.name);
                    }
                  }}
                  onDoubleClick={() => handleRenameStart(tab.id, tab.name)}
                  title={getDisplayFileName(tab.name)}
                >
                  {getDisplayFileName(tab.name).toLowerCase().endsWith(".ino") ? (
                    <Code2 className="h-3 w-3 flex-shrink-0 text-[#2aa198]" strokeWidth={2} />
                  ) : (
                    <FileCode2 className="h-3 w-3 flex-shrink-0 text-[#c586c0]" strokeWidth={2} />
                  )}
                  <span
                    className="text-ui-sm whitespace-nowrap overflow-hidden text-ellipsis"
                    style={{
                      fontSize: "var(--ui-control-font-size)",
                      lineHeight: "var(--ui-button-height)",
                      height: "var(--ui-button-height)",
                      display: "flex",
                      alignItems: "center",
                      minWidth: "0",
                      flex: "1",
                    }}
                  >
                    {getDisplayFileName(tab.name)}
                    {modifiedTabId === tab.id && <span className="ml-1 flex-shrink-0">•</span>}
                  </span>
                </button>
                {tabs[0]?.id !== tab.id && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-[var(--ui-button-height)] w-[var(--ui-button-height)] p-0 flex-shrink-0 opacity-0 group-hover:opacity-100 data-[active=true]:opacity-100 transition-opacity text-[#cccccc] hover:bg-[#333333]"
                    data-active={activeTabId === tab.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirmTabId(tab.id);
                    }}
                    title="Close file"
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
                Save All Files
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
      </UnifiedScrollArea>

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
            <AlertDialogCancel onClick={handleReplaceConfirmNo}>Nein (nur .h Dateien)</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReplaceConfirmYes}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Ja (Sketch ersetzen)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TabBar>
  );
}
