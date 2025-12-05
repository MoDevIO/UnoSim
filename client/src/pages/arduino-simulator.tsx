//arduino-simulator.tsx

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu, Play, Square, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/features/code-editor';
import { SerialMonitor } from '@/components/features/serial-monitor';
import { CompilationOutput } from '@/components/features/compilation-output';
import { useWebSocket } from '@/hooks/use-websocket';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import type { Sketch } from '@shared/schema';

// Logger import
import { Logger } from '@shared/logger';
const logger = new Logger("ArduinoSimulator");

// NEW: Interface for output lines to track completion status
interface OutputLine {
  text: string;
  complete: boolean;
}

export default function ArduinoSimulator() {
  const [currentSketch, setCurrentSketch] = useState<Sketch | null>(null);
  const [code, setCode] = useState('');
  const [cliOutput, setCliOutput] = useState('');
  const editorRef = useRef<{ getValue: () => string } | null>(null);
  // CHANGED: Store OutputLine objects instead of plain strings
  const [serialOutput, setSerialOutput] = useState<OutputLine[]>([]);
  const [compilationStatus, setCompilationStatus] = useState<'ready' | 'compiling' | 'success' | 'error'>('ready');
  const [arduinoCliStatus, setArduinoCliStatus] = useState<'idle' | 'compiling' | 'success' | 'error'>('idle');
  const [gccStatus, setGccStatus] = useState<'idle' | 'compiling' | 'success' | 'error'>('idle');
  const [simulationStatus, setSimulationStatus] = useState<'running' | 'stopped'>('stopped');
  const [hasCompiledOnce, setHasCompiledOnce] = useState(false);
  const [isModified, setIsModified] = useState(false);


  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isConnected, lastMessage, sendMessage } = useWebSocket();

  // Fetch default sketch
  const { data: sketches } = useQuery<Sketch[]>({
    queryKey: ['/api/sketches'],
  });

  // Compilation mutation
  const compileMutation = useMutation({
    mutationFn: async (code: string) => {
      const response = await apiRequest('POST', '/api/compile', { code });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setCliOutput((prev) => prev + (data.output || '✓ GCC-Compilation succeeded without output.') + '\n');
      } else {
        setCliOutput((prev) => prev + (data.errors || '✗ GCC-Compilation failed without error message.') + '\n');
      }

      toast({
        title: data.success ? "GCC-Compilation succeeded" : "GCC-Compilation failed",
        description: data.success ? "Your sketch has been compiled successfully" : "There were errors in your sketch",
        variant: data.success ? undefined : "destructive",
      });
    },
    onError: () => {
      toast({
        title: "Compilation with Arduino-CLI Failed",
        description: "There were errors in your sketch",
        variant: "destructive",
      });
    },
  });

  // Stop simulation mutation
  const stopMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/stop-simulation');
      return response.json();
    },
    onSuccess: () => {
      setSimulationStatus('stopped');
    },
  });

  // Start simulation mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/start-simulation');
      return response.json();
    },
    onSuccess: () => {
      setSimulationStatus('running');
      toast({
        title: "Simulation Started",
        description: "Arduino simulation is now running",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Start Failed",
        description: error.message || "Could not start simulation",
        variant: "destructive",
      });
      if (isModified && hasCompiledOnce) {
        toast({
          title: "Code Modified",
          description: "Compile to apply your latest changes",
        });
      }
    },
  });

  useEffect(() => {
    // Nur runtersetzen, falls Status aktuell nicht 'idle' sind, um unnötige Rerenders zu vermeiden
    if (arduinoCliStatus !== 'idle') setArduinoCliStatus('idle');
    if (gccStatus !== 'idle') setGccStatus('idle');
    if (compilationStatus !== 'ready') setCompilationStatus('ready');

    // Simulation stoppen, wenn Code geändert wird
    if (simulationStatus === 'running') {
      stopMutation.mutate();
    }
  }, [code]);

  useEffect(() => {
    if (serialOutput.length === 0) {
      //logger.debug("serialOutput is empty!");
    }
  }, [serialOutput]);

  // Load default sketch on mount
  useEffect(() => {
    if (sketches && sketches.length > 0 && !currentSketch) {
      const defaultSketch = sketches[0];
      setCurrentSketch(defaultSketch);
      setCode(defaultSketch.content);
    }
  }, [sketches, currentSketch]);

  // NEW: Keyboard shortcuts (only for non-editor actions)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F5: Compile only (Verify)
      if (e.key === 'F5') {
        e.preventDefault();
        if (!compileMutation.isPending) {
          handleCompile();
        }
      }

      // Escape: Stop simulation
      if (e.key === 'Escape' && simulationStatus === 'running') {
        e.preventDefault();
        handleStop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [compileMutation.isPending, startMutation.isPending, simulationStatus]);

  // NEW: Auto format function
  const formatCode = () => {
    let formatted = code;

    // Basic C++ formatting rules
    // 1. Normalize line endings
    formatted = formatted.replace(/\r\n/g, '\n');

    // 2. Add newlines after opening braces
    formatted = formatted.replace(/\{\s*/g, '{\n');

    // 3. Add newlines before closing braces
    formatted = formatted.replace(/\s*\}/g, '\n}');

    // 4. Indent blocks (simple 2-space indentation)
    const lines = formatted.split('\n');
    let indentLevel = 0;
    const indentedLines = lines.map(line => {
      const trimmed = line.trim();
      
      // Decrease indent for closing braces
      if (trimmed.startsWith('}')) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      const indented = '  '.repeat(indentLevel) + trimmed;

      // Increase indent after opening braces
      if (trimmed.endsWith('{')) {
        indentLevel++;
      }

      return indented;
    });

    formatted = indentedLines.join('\n');

    // 5. Remove multiple consecutive blank lines
    formatted = formatted.replace(/\n{3,}/g, '\n\n');

    // 6. Ensure newline at end of file
    if (!formatted.endsWith('\n')) {
      formatted += '\n';
    }

    setCode(formatted);
    
    toast({
      title: "Code formatiert",
      description: "Der Code wurde automatisch formatiert",
    });
  };

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case 'serial_output': {
        // NEW: Handle isComplete flag for Serial.print() vs Serial.println()
        const text = lastMessage.data;
        const isComplete = lastMessage.isComplete ?? true; // Default to true for backwards compatibility

        setSerialOutput(prev => {
          const newLines = [...prev];

          if (isComplete) {
            // Check if last line is incomplete - if so, complete it
            if (newLines.length > 0 && !newLines[newLines.length - 1].complete) {
              // Complete the existing incomplete line
              newLines[newLines.length - 1] = {
                text: newLines[newLines.length - 1].text + text,
                complete: true
              };
            } else {
              // Complete line without pending incomplete - add as new line
              newLines.push({ text, complete: true });
            }
          } else {
            // Incomplete line (from Serial.print) - append to last line or create new
            if (newLines.length === 0 || newLines[newLines.length - 1].complete) {
              // Last line is complete or no lines exist - start new incomplete line
              newLines.push({ text, complete: false });
            } else {
              // Last line is incomplete - append to it WITHOUT changing complete status
              newLines[newLines.length - 1] = {
                text: newLines[newLines.length - 1].text + text,
                complete: false // Keep it incomplete
              };
            }
          }

          return newLines;
        });
        break;
      }
      case 'compilation_status':
        setArduinoCliStatus(lastMessage.arduinoCliStatus ?? 'idle');
        setGccStatus(lastMessage.gccStatus ?? 'idle');
        if (lastMessage.message) {
          setCliOutput(lastMessage.message);
        }
        break;
      case 'simulation_status':
        setSimulationStatus(lastMessage.status);
        break;
    }
  }, [lastMessage]);

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    setIsModified(true);
  };

  const handleCompile = () => {
    setCliOutput('');
    setSerialOutput([]);
    compileMutation.mutate(code);
  };

  const handleStop = () => {
    stopMutation.mutate();
  };

  const handleStart = () => {
    startMutation.mutate();
  };

  const handleCompileAndStart = () => {
    // Get code from editor ref (always use the latest from editor)
    const codeToCompile = editorRef.current?.getValue() || code;
    setCliOutput('');
    setSerialOutput([]);
    setCompilationStatus('compiling');

    compileMutation.mutate(codeToCompile, {
      onSuccess: (data) => {
        // Simulation nur starten, wenn Compilation Erfolgsmeldung (je nach API-Response prüfen)
        if (data?.success) {
          startMutation.mutate();
          setCompilationStatus('success');
          setHasCompiledOnce(true);
          setIsModified(false);
        } else {
          // Optional Fehlerhandling, falls API nicht klar success meldet
          setCompilationStatus('error');
          toast({
            title: "Compilation Completed with Errors",
            description: "Simulation will not start due to compilation errors.",
            variant: "destructive",
          });
        }
      },
      onError: () => {
        setCompilationStatus('error');
        toast({
          title: "Compilation Failed",
          description: "Simulation will not start due to compilation errors.",
          variant: "destructive",
        });
      },
    });
  };

  const handleSerialSend = (message: string) => {
    sendMessage({
      type: 'serial_input',
      data: message,
    });
  };

  const handleClearCompilationOutput = () => {
    setCliOutput('');
  };

  const handleClearSerialOutput = () => {
    setSerialOutput([]);
  };

  const getStatusInfo = () => {
    switch (compilationStatus) {
      case 'compiling':
        return { text: 'Compiling...', className: 'status-compiling' };
      case 'success':
        return { text: isModified ? 'Code Changed' : 'Compilation with Arduino-CLI complete', className: isModified ? 'status-modified' : 'status-success' };
      case 'error':
        return { text: 'Compilation Error', className: 'status-error' };
      default:
        return { text: 'Ready', className: 'status-ready' };
    }
  };

  function getStatusClass(status: 'idle' | 'compiling' | 'success' | 'error' | 'ready' | 'running' | 'stopped'): string {
    switch (status) {
      case 'compiling':
        return 'text-yellow-500';
      case 'success':
        return 'text-green-500';
      case 'error':
        return 'text-red-500';
      case 'idle':
        return 'text-gray-500 italic';
      case 'ready':
        return 'text-gray-700';
      case 'running':
        return 'text-green-600';
      case 'stopped':
        return 'text-gray-600';
      default:
        return '';
    }
  }

  function compilationStatusLabel(status: string): string {
    switch (status) {
      case 'compiling':
        return 'Compiling...';
      case 'success':
        return 'Compilation Successful';
      case 'error':
        return 'Compilation Failed';
      case 'idle':
        return 'Idle';
      case 'ready':
        return 'Ready';
      case 'running':
        return 'Running';
      case 'stopped':
        return 'Stopped';
      default:
        return status;
    }
  }

  const statusInfo = getStatusInfo();
  const simulateDisabled = simulationStatus === 'running' || compileMutation.isPending || startMutation.isPending;
  const stopDisabled = simulationStatus !== 'running' || stopMutation.isPending;
  const buttonsClassName = "hover:bg-green-600 hover:text-white transition-colors";

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header/Toolbar */}
      <div className="bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Cpu className="text-accent h-5 w-5" />
            <h1 className="text-lg font-semibold">Arduino UNO Simulator</h1>
          </div>
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <span className="bg-muted px-2 py-1 rounded text-xs">Board: Arduino UNO</span>
            <span className="bg-muted px-2 py-1 rounded text-xs">Baud: 115200</span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 text-sm">
            <div className={`w-6 h-6 rounded-full ${compilationStatus === 'compiling' ? 'bg-yellow-500 animate-pulse' :
              compilationStatus === 'success' ? 'bg-green-500' :
                compilationStatus === 'error' ? 'bg-red-500' :
                  compilationStatus === 'ready' ? 'bg-gray-500' :
                    'bg-blue-500'
              }`} />

          </div>

          <div className="flex flex-col space-y-1 text-sm w-64">
            <span className="block whitespace-nowrap overflow-hidden text-ellipsis text-left ">
              {`CLI: ${compilationStatusLabel(arduinoCliStatus)}`}
            </span>
            <span className="block whitespace-nowrap overflow-hidden text-ellipsis text-left ">
              {`GCC: ${compilationStatusLabel(gccStatus)}`}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <Button
              onClick={simulationStatus === 'running' ? handleStop : handleCompileAndStart}
              disabled={compileMutation.isPending || startMutation.isPending || stopMutation.isPending}
              className={clsx(
                'w-64',
                '!text-white',
                'transition-colors',
                {
                  // Klassen für den Zustand 'running' (rot für Stop)
                  '!bg-orange-600 hover:!bg-orange-700': simulationStatus === 'running' && !(compileMutation.isPending || startMutation.isPending || stopMutation.isPending),

                  // Klassen für den Zustand 'stopped' (grün für Start)
                  '!bg-green-600 hover:!bg-green-700': simulationStatus !== 'running' && !(compileMutation.isPending || startMutation.isPending || stopMutation.isPending),

                  // Klassen für den 'disabled' Zustand (unabhängig von simulationStatus)
                  'opacity-50 cursor-not-allowed': compileMutation.isPending || startMutation.isPending || stopMutation.isPending,
                }
              )}
              data-testid="button-simulate-toggle"
            >
              {(compileMutation.isPending || startMutation.isPending || stopMutation.isPending) ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : simulationStatus === 'running' ? (
                <>
                  <Square className="h-4 w-4 mr-2" />
                  Stop Simulation
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Simulation
                </>
              )}
            </Button>

          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full" id="main-layout">
          {/* Code Editor Panel */}
          <ResizablePanel defaultSize={50} minSize={20} id="code-panel">
            <div className="h-full flex flex-col">
              <div className="bg-muted px-4 py-2 border-b border-border">
                <div className="flex items-center space-x-2">
                  <i className="fas fa-file-code text-accent text-sm"></i>
                  <span className="text-sm font-medium" data-testid="sketch-name">
                    {currentSketch?.name || 'sketch.ino'}
                  </span>
                  {isModified && (
                    <span className="text-xs text-muted-foreground">• Modified</span>
                  )}
                </div>
              </div>

              <div className="flex-1">
                <CodeEditor
                  value={code}
                  onChange={handleCodeChange}
                  onCompileAndRun={handleCompileAndStart}
                  onFormat={formatCode}
                  editorRef={editorRef}
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle data-testid="horizontal-resizer" />

          {/* Right Panel - Output & Serial Monitor */}
          <ResizablePanel defaultSize={50} minSize={20} id="output-panel">
            <ResizablePanelGroup direction="vertical" id="output-layout">
              <ResizablePanel defaultSize={50} minSize={20} id="compilation-panel">
                <CompilationOutput
                  output={cliOutput}
                  onClear={handleClearCompilationOutput}
                />
              </ResizablePanel>

              <ResizableHandle withHandle data-testid="vertical-resizer" />

              <ResizablePanel defaultSize={50} minSize={20} id="serial-panel">
                <SerialMonitor
                  output={serialOutput}
                  isConnected={isConnected}
                  isSimulationRunning={simulationStatus === 'running'}
                  onSendMessage={handleSerialSend}
                  onClear={handleClearSerialOutput}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}