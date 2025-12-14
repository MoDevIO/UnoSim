import { useState, useEffect } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { BookOpen, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Example {
  name: string;
  filename: string;
  content: string;
}

interface ExamplesMenuProps {
  onLoadExample: (filename: string, content: string) => void;
}

export function ExamplesMenu({ onLoadExample }: ExamplesMenuProps) {
  const [examples, setExamples] = useState<Example[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const loadExamples = async () => {
      try {
        setIsLoading(true);
        
        // Fetch the list of examples from the server
        const response = await fetch('/api/examples');
        if (!response.ok) {
          throw new Error('Failed to fetch examples list');
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
              const displayName = filename
                .split('/')
                .pop()
                ?.replace(/^\d+-/, '') || filename;
              
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
        console.error('Failed to load examples:', error);
        toast({
          title: 'Failed to Load Examples',
          description: 'Could not load example files',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadExamples();
  }, [toast]);

  const handleLoadExample = (example: Example) => {
    onLoadExample(example.filename, example.content);
    toast({
      title: 'Example Loaded',
      description: `${example.filename} has been loaded into the editor`,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 h-8"
          disabled={isLoading}
        >
          <BookOpen className="h-4 w-4" />
          Examples
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto p-0">
        <div className="px-2 py-1.5">
          <div className="text-xs font-semibold mb-1">Load Example</div>
        </div>
        <div className="border-t" />
        
        {examples.length === 0 && !isLoading && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No examples available
          </div>
        )}

        {isLoading && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
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
    new Set()
  );

  function groupExamplesByFolder(items: Example[]): Record<string, Example[]> {
    const grouped: Record<string, Example[]> = {};
    items.forEach((item) => {
      const parts = item.filename.split('/');
      const folder = parts.length > 1 ? parts[0] : 'Other';
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
          const cleanFolderName = folder.replace(/^\d+-/, '');

          return (
            <div key={folder}>
              <button
                onClick={() => toggleFolder(folder)}
                className="w-full px-2 py-1.5 text-sm flex items-center gap-1 hover:bg-accent hover:text-accent-foreground text-left"
              >
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${
                    isExpanded ? 'rotate-90' : ''
                  }`}
                />
                <span className="font-medium text-xs">{cleanFolderName}</span>
              </button>

              {isExpanded && (
                <div className="bg-muted/30">
                  {items
                    .sort((a, b) => a.filename.localeCompare(b.filename))
                    .map((example) => (
                      <button
                        key={example.filename}
                        onClick={() => onLoadExample(example)}
                        className="w-full px-4 py-1 text-xs flex items-center gap-2 hover:bg-accent hover:text-accent-foreground text-left"
                      >
                        <span className="text-muted-foreground">•</span>
                        <span>{example.name}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
