import { useRef, useCallback, useState } from "react";

export type FileEntry = { name: string; content: string };

export interface UseFileManagerOptions {
  tabs?: Array<{ name: string; content: string }>;
  onFilesLoaded?: (files: FileEntry[], replaceAll: boolean) => void;
  toast?: (params: { title: string; description?: string; variant?: string }) => void;
}

export function useFileManager({ tabs = [], onFilesLoaded, toast }: UseFileManagerOptions = {}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [lastLoadedFiles, setLastLoadedFiles] = useState<FileEntry[] | null>(null);

  const onLoadFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const downloadAllFiles = useCallback(async (providedTabs?: Array<{ name: string; content: string }>) => {
    const which = providedTabs ?? tabs ?? [];
    if (!which || which.length === 0) {
      try {
        toast?.({ title: "Nothing to download", description: "There are no open files to download" });
      } catch {}
      return;
    }

    which.forEach((tab, index) => {
      setTimeout(() => {
        const element = document.createElement("a");
        element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(tab.content));
        element.setAttribute("download", tab.name);
        (element as any).style.display = "none";
        document.body.appendChild(element);
        (element as any).click();
        document.body.removeChild(element);
      }, index * 200);
    });

    setTimeout(() => {
      try {
        toast?.({ title: "Download started", description: `${which.length} file(s) will be downloaded` });
      } catch {}
    }, which.length * 200 + 100);
  }, [tabs, toast]);

  const handleHiddenFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files;
    if (!fl || fl.length === 0) return;
    const files: FileEntry[] = [];
    for (const f of Array.from(fl)) {
      if (!f.name.endsWith(".ino") && !f.name.endsWith(".h")) continue;
      try {
        const txt = await f.text();
        files.push({ name: f.name, content: txt });
      } catch {}
    }
    if (files.length > 0) {
      setLastLoadedFiles(files);
      onFilesLoaded?.(files, false);
    }
    // clear input value to allow re-upload of same file
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onFilesLoaded]);

  return {
    fileInputRef,
    onLoadFiles,
    downloadAllFiles,
    handleHiddenFileInput,
    lastLoadedFiles,
  } as const;
}
