import { useState, useRef, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, MoreVertical, Wand2, Pen, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { clsx } from 'clsx';

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
  onFormatCode?: () => void;
}

export function SketchTabs({
  tabs,
  activeTabId,
  modifiedTabId,
  onTabClick,
  onTabClose,
  onTabRename,
  onTabAdd,
  onFormatCode,
}: SketchTabsProps) {
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [deleteConfirmTabId, setDeleteConfirmTabId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const container = tabsContainerRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth
      );
    }
  };

  useEffect(() => {
    checkScroll();
    const container = tabsContainerRef.current;
    container?.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);
    return () => {
      container?.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [tabs]);

  useEffect(() => {
    // Focus and select text in input when renaming starts
    if (renamingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingTabId]);

  const scroll = (direction: 'left' | 'right') => {
    const container = tabsContainerRef.current;
    if (container) {
      const scrollAmount = 200;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  const handleRenameStart = (tabId: string, currentName: string) => {
    setRenamingTabId(tabId);
    // Remove file extension for display
    const nameWithoutExtension = currentName.substring(0, currentName.lastIndexOf('.'));
    setNewName(nameWithoutExtension);
  };

  const handleRenameStartDialog = (tabId: string, currentName: string) => {
    setRenamingTabId(tabId);
    // Remove file extension for display
    const nameWithoutExtension = currentName.substring(0, currentName.lastIndexOf('.'));
    setNewName(nameWithoutExtension);
    setIsRenameDialogOpen(true);
  };

  const handleRenameSave = () => {
    if (newName.trim() && renamingTabId) {
      const currentTab = tabs.find((t) => t.id === renamingTabId);
      if (currentTab) {
        // Extract the file extension
        const extension = currentTab.name.substring(currentTab.name.lastIndexOf('.'));
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
    setNewName('');
  };

  const handleRenameCancel = () => {
    setIsRenameDialogOpen(false);
    setRenamingTabId(null);
    setNewName('');
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirmTabId) {
      onTabClose(deleteConfirmTabId);
      setDeleteConfirmTabId(null);
    }
  };

  return (
    <div className="flex items-center bg-muted border-b border-border">
      {/* Scroll left button */}
      {canScrollLeft && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 flex-shrink-0"
          onClick={() => scroll('left')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Tabs container with overflow */}
      <div
        ref={tabsContainerRef}
        className="flex items-center overflow-x-auto flex-1 scrollbar-hide"
        style={{ scrollBehavior: 'smooth' }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={clsx(
              'flex items-center space-x-2 px-3 py-2 border-r border-border cursor-pointer transition-colors flex-shrink-0 group',
              activeTabId === tab.id
                ? 'bg-background text-foreground'
                : 'hover:bg-muted/80 text-muted-foreground'
            )}
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
                  if (e.key === 'Enter') {
                    handleRenameSave();
                  } else if (e.key === 'Escape') {
                    handleRenameCancel();
                  }
                }}
                onBlur={handleRenameSave}
                className="h-6 w-24 px-2 py-1 text-sm"
              />
            ) : (
              <>
                <span
                  className="text-sm truncate max-w-xs cursor-pointer hover:underline"
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
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0"
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
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Scroll right button */}
      {canScrollRight && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 flex-shrink-0"
          onClick={() => scroll('right')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmTabId !== null} onOpenChange={(open) => {
        if (!open) setDeleteConfirmTabId(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{tabs.find((t) => t.id === deleteConfirmTabId)?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
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
              if (e.key === 'Enter') {
                handleRenameSave();
              } else if (e.key === 'Escape') {
                handleRenameCancel();
              }
            }}
            placeholder="Enter new name..."
          />
          <DialogFooter>
            <Button variant="outline" onClick={handleRenameCancel}>
              Cancel
            </Button>
            <Button onClick={handleRenameSave}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
