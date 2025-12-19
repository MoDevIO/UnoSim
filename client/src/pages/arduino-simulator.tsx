//arduino-simulator.tsx

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu, Play, Square, Loader2, Terminal, Wrench } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/features/code-editor';
import { SerialMonitor } from '@/components/features/serial-monitor';
import { CompilationOutput } from '@/components/features/compilation-output';
import { SketchTabs } from '@/components/features/sketch-tabs';
import { ExamplesMenu } from '@/components/features/examples-menu';
import { ArduinoBoard } from '@/components/features/arduino-board';
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

// Pin state interface for Arduino board visualization
interface PinState {
  pin: number;
  mode: 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP';
  value: number;
  type: 'digital' | 'analog' | 'pwm';
}

export default function ArduinoSimulator() {
  const [currentSketch, setCurrentSketch] = useState<Sketch | null>(null);
  const [code, setCode] = useState('');
  const [cliOutput, setCliOutput] = useState('');
  const editorRef = useRef<{ getValue: () => string } | null>(null);
  
  // Tab management
  const [tabs, setTabs] = useState<Array<{ id: string; name: string; content: string }>>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  
  // CHANGED: Store OutputLine objects instead of plain strings
  const [serialOutput, setSerialOutput] = useState<OutputLine[]>([]);
  const [compilationStatus, setCompilationStatus] = useState<'ready' | 'compiling' | 'success' | 'error'>('ready');
  const [arduinoCliStatus, setArduinoCliStatus] = useState<'idle' | 'compiling' | 'success' | 'error'>('idle');
  const [gccStatus, setGccStatus] = useState<'idle' | 'compiling' | 'success' | 'error'>('idle');
  const [simulationStatus, setSimulationStatus] = useState<'running' | 'stopped'>('stopped');
  const [hasCompiledOnce, setHasCompiledOnce] = useState(false);
  const [isModified, setIsModified] = useState(false);
  
  // Pin states for Arduino board visualization
  const [pinStates, setPinStates] = useState<PinState[]>([]);
  
  // Simulation timeout setting (in seconds)
  const [simulationTimeout, setSimulationTimeout] = useState<number>(60);
  
  // RX/TX LED activity counters (increment on activity for change detection)
  const [txActivity, setTxActivity] = useState(0);
  const [rxActivity, setRxActivity] = useState(0);

  // Backend availability tracking
  const [backendReachable, setBackendReachable] = useState(true);
  const [backendPingError, setBackendPingError] = useState<string | null>(null);
  
  // Ref to track if backend was ever unreachable (for recovery toast)
  const wasBackendUnreachableRef = useRef(false);
  
  // Ref to track previous backend reachable state for detecting transitions
  const prevBackendReachableRef = useRef(true);


  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isConnected, connectionError, hasEverConnected, lastMessage, messageQueue, consumeMessages, sendMessage } = useWebSocket();

  // Backend / websocket reachability notifications
  useEffect(() => {
    if (connectionError) {
      toast({
        title: "Backend unreachable",
        description: connectionError,
        variant: "destructive",
      });
    } else if (!isConnected && hasEverConnected) {
      toast({
        title: "Connection lost",
        description: "Trying to re-establish backend connection...",
        variant: "destructive",
      });
    }
  }, [connectionError, isConnected, hasEverConnected, toast]);

  // Lightweight backend ping every second
  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);
      try {
        const res = await fetch('/api/health', { method: 'GET', cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!cancelled) {
          setBackendReachable(true);
          setBackendPingError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setBackendReachable(false);
          setBackendPingError((err as Error)?.message || 'Health check failed');
        }
      } finally {
        clearTimeout(timeout);
      }
    };

    const interval = setInterval(ping, 1000);
    ping();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Show toast when HTTP backend becomes unreachable or recovers
  useEffect(() => {
    if (!backendReachable) {
      wasBackendUnreachableRef.current = true;
      toast({
        title: "Backend unreachable",
        description: backendPingError || 'Could not reach API server.',
        variant: "destructive",
      });
    } else if (backendReachable && wasBackendUnreachableRef.current) {
      // Backend recovered after being unreachable
      wasBackendUnreachableRef.current = false;
      toast({
        title: "Backend reachable again",
        description: "Connection restored.",
      });
    }
  }, [backendReachable, backendPingError, toast]);

  const ensureBackendConnected = (actionLabel: string) => {
    if (!backendReachable || !isConnected) {
      toast({
        title: "Backend unreachable",
        description: backendPingError || connectionError || `${actionLabel} failed because the backend is not reachable. Please check the server or retry in a moment.`,
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const isBackendUnreachableError = (error: unknown) => {
    const message = (error as Error | undefined)?.message || '';
    return message.includes('Failed to fetch')
      || message.includes('NetworkError')
      || message.includes('ERR_CONNECTION')
      || message.includes('Network request failed');
  };

  // Fetch default sketch
  const { data: sketches } = useQuery<Sketch[]>({
    queryKey: ['/api/sketches'],
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    enabled: backendReachable, // Only query if backend is reachable
  });

  // Refetch sketches when backend becomes reachable again (false -> true transition)
  useEffect(() => {
    const wasUnreachable = !prevBackendReachableRef.current;
    const isNowReachable = backendReachable;
    
    // Update the ref for next check
    prevBackendReachableRef.current = backendReachable;
    
    if (wasUnreachable && isNowReachable) {
      // Backend just transitioned from unreachable to reachable
      console.log('[Backend] Recovered, refetching queries...');
      queryClient.refetchQueries({ queryKey: ['/api/sketches'] });
    }
  }, [backendReachable, queryClient]);

  // Compilation mutation
  const compileMutation = useMutation({
    mutationFn: async (payload: { code: string; headers?: Array<{ name: string; content: string }> }) => {
      setArduinoCliStatus('compiling');
      const response = await apiRequest('POST', '/api/compile', payload);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setArduinoCliStatus('success');
        // REPLACE output, don't append
        setCliOutput(data.output || '✓ Arduino-CLI Compilation succeeded.');
      } else {
        setArduinoCliStatus('error');
        // REPLACE output, don't append
        setCliOutput(data.errors || '✗ Arduino-CLI Compilation failed.');
      }

      toast({
        title: data.success ? "Arduino-CLI Compilation succeeded" : "Arduino-CLI Compilation failed",
        description: data.success ? "Your sketch has been compiled successfully" : "There were errors in your sketch",
        variant: data.success ? undefined : "destructive",
      });
    },
    onError: (error) => {
      setArduinoCliStatus('error');
      const backendDown = isBackendUnreachableError(error);
      toast({
        title: backendDown ? "Backend unreachable" : "Compilation with Arduino-CLI Failed",
        description: backendDown ? "API server unreachable. Please check the backend or reload." : "There were errors in your sketch",
        variant: "destructive",
      });
    },
  });

  // Stop simulation mutation
  const stopMutation = useMutation({
    mutationFn: async () => {
      sendMessage({ type: 'stop_simulation' });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus('stopped');
    },
  });

  // Start simulation mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      console.log('[Simulation] Starting with timeout:', simulationTimeout);
      sendMessage({ type: 'start_simulation', timeout: simulationTimeout });
      return { success: true };
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
    // Reset status when code actually changes
    // Reset both labels to idle when code changes
    if (arduinoCliStatus !== 'idle') setArduinoCliStatus('idle');
    if (gccStatus !== 'idle') setGccStatus('idle');
    if (compilationStatus !== 'ready') setCompilationStatus('ready');

    // Note: Simulation stopping on code change is now handled in handleCodeChange
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
      
      // Initialize tabs with the default sketch
      const defaultTabId = 'default-sketch';
      setTabs([{
        id: defaultTabId,
        name: 'sketch.ino',
        content: defaultSketch.content,
      }]);
      setActiveTabId(defaultTabId);
    }
  }, [sketches]);

  // Persist code changes to the active tab
  useEffect(() => {
    if (activeTabId && tabs.length > 0) {
      setTabs(prevTabs => 
        prevTabs.map(tab => 
          tab.id === activeTabId ? { ...tab, content: code } : tab
        )
      );
    }
  }, [code, activeTabId]);

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
      title: "Code Formatted",
      description: "Code has been automatically formatted",
    });
  };

  // Handle WebSocket messages - process ALL messages in the queue
  useEffect(() => {
    if (messageQueue.length === 0) return;

    // Consume all messages from the queue
    const messages = consumeMessages();
    
    for (const message of messages) {
      switch (message.type) {
        case 'serial_output': {
          // NEW: Handle isComplete flag for Serial.print() vs Serial.println()
          const text = message.data;
          const isComplete = message.isComplete ?? true; // Default to true for backwards compatibility

          // Trigger TX LED blink (Arduino is transmitting data)
          setTxActivity(prev => prev + 1);

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
          if (message.arduinoCliStatus !== undefined) {
            setArduinoCliStatus(message.arduinoCliStatus);
          }
          if (message.gccStatus !== undefined) {
            setGccStatus(message.gccStatus);
            // Reset GCC status to idle after a short delay (like CLI)
            if (message.gccStatus === 'success' || message.gccStatus === 'error') {
              setTimeout(() => {
                setGccStatus('idle');
              }, 2000);
            }
          }
          if (message.message) {
            setCliOutput(message.message);
          }
          break;
        case 'compilation_error':
          // For GCC errors: REPLACE previous output, do not append
          // Arduino-CLI reported success, but GCC failed
          console.log('[WS] GCC Compilation Error detected:', message.data);
          setCliOutput('❌ GCC Compilation Error:\n\n' + message.data);
          setGccStatus('error');
          setCompilationStatus('error');
          setSimulationStatus('stopped');
          // Reset GCC status to idle after a short delay
          setTimeout(() => {
            setGccStatus('idle');
          }, 2000);
          break;
        case 'simulation_status':
          setSimulationStatus(message.status);
          // Reset pin states and compilation status when simulation stops
          if (message.status === 'stopped') {
            setPinStates([]);
            setCompilationStatus('ready');
          }
          break;
        case 'pin_state': {
          // Update pin state for Arduino board visualization
          const { pin, stateType, value } = message;
          setPinStates(prev => {
            const newStates = [...prev];
            const existingIndex = newStates.findIndex(p => p.pin === pin);
            
            if (existingIndex >= 0) {
              // Update existing pin state
              if (stateType === 'mode') {
                const modeMap: { [key: number]: 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP' } = {
                  0: 'INPUT',
                  1: 'OUTPUT', 
                  2: 'INPUT_PULLUP'
                };
                newStates[existingIndex] = {
                  ...newStates[existingIndex],
                  mode: modeMap[value] || 'INPUT'
                };
              } else if (stateType === 'value') {
                newStates[existingIndex] = {
                  ...newStates[existingIndex],
                  value,
                  type: 'digital'
                };
              } else if (stateType === 'pwm') {
                newStates[existingIndex] = {
                  ...newStates[existingIndex],
                  value,
                  type: 'pwm'
                };
              }
            } else {
              // Add new pin state
              const modeMap: { [key: number]: 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP' } = {
                0: 'INPUT',
                1: 'OUTPUT',
                2: 'INPUT_PULLUP'
              };
              newStates.push({
                pin,
                mode: stateType === 'mode' ? (modeMap[value] || 'INPUT') : 'OUTPUT',
                value: stateType === 'value' || stateType === 'pwm' ? value : 0,
                type: stateType === 'pwm' ? 'pwm' : 'digital'
              });
            }
            
            return newStates;
          });
          break;
        }
      }
    }
  }, [messageQueue, consumeMessages]);

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    setIsModified(true);
    
    // Stop simulation when user edits the code
    if (simulationStatus === 'running') {
      stopMutation.mutate();
    }
    
    // Update the active tab content
    if (activeTabId) {
      setTabs(tabs.map(tab => 
        tab.id === activeTabId ? { ...tab, content: newCode } : tab
      ));
    }
  };

  // Tab management handlers
  const handleTabClick = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      setActiveTabId(tabId);
      setCode(tab.content);
      setIsModified(false);
      
      // Note: Simulation continues running when switching tabs
      // Clear previous outputs only if needed, but keep simulation running
      // setCliOutput(''); // Commented out to preserve outputs
      // setSerialOutput([]); // Commented out to preserve outputs
      // setPinStates([]); // Commented out to preserve pin states
      // setCompilationStatus('ready'); // Commented out
      // setArduinoCliStatus('idle'); // Commented out
      // setGccStatus('idle'); // Commented out
      // setSimulationStatus('stopped'); // Commented out
      // setHasCompiledOnce(false); // Commented out
    }
  };

  const handleTabAdd = () => {
    const newTabId = Math.random().toString(36).substr(2, 9);
    const newTab = {
      id: newTabId,
      name: `header_${tabs.length}.h`,
      content: '',
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTabId);
    setCode('');
    setIsModified(false);
  };

  const handleFilesLoaded = (files: Array<{ name: string; content: string }>, replaceAll: boolean) => {
    if (replaceAll) {
      // Stop simulation if running
      if (simulationStatus === 'running') {
        sendMessage({ type: 'stop_simulation' });
      }
      
      // Replace all tabs with new files
      const inoFiles = files.filter(f => f.name.endsWith('.ino'));
      const hFiles = files.filter(f => f.name.endsWith('.h'));
      
      // Put .ino file first, then all .h files
      const orderedFiles = [...inoFiles, ...hFiles];
      
      const newTabs = orderedFiles.map((file) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        content: file.content,
      }));
      
      setTabs(newTabs);
      
      // Set the main .ino file as active
      const inoTab = newTabs[0]; // Should be at index 0 now
      if (inoTab) {
        setActiveTabId(inoTab.id);
        setCode(inoTab.content);
        setIsModified(false);
      }
      
      // Clear previous outputs and stop simulation
      setCliOutput('');
      setSerialOutput([]);
      setPinStates([]);
      setCompilationStatus('ready');
      setArduinoCliStatus('idle');
      setGccStatus('idle');
      setSimulationStatus('stopped');
      setHasCompiledOnce(false);
    } else {
      // Add only .h files to existing tabs
      const newHeaderFiles = files.map((file) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        content: file.content,
      }));
      
      setTabs([...tabs, ...newHeaderFiles]);
    }
  };

  const handleLoadExample = (filename: string, content: string) => {
    // Stop simulation if running
    if (simulationStatus === 'running') {
      sendMessage({ type: 'stop_simulation' });
    }
    
    // Create a new sketch from the example, using the filename as the tab name
    const newTab = {
      id: Math.random().toString(36).substr(2, 9),
      name: filename,
      content: content,
    };

    setTabs([newTab]);
    setActiveTabId(newTab.id);
    setCode(content);
    setIsModified(false);
    
    // Clear previous outputs
    setCliOutput('');
    setSerialOutput([]);
    setPinStates([]);
    setCompilationStatus('ready');
    setArduinoCliStatus('idle');
    setGccStatus('idle');
    setSimulationStatus('stopped');
    setHasCompiledOnce(false);
  };


  const handleTabClose = (tabId: string) => {
    // Prevent closing the first tab (the .ino file)
    if (tabId === tabs[0]?.id) {
      toast({
        title: "Cannot Delete",
        description: "The main sketch file cannot be deleted",
        variant: "destructive",
      });
      return;
    }

    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);

    if (activeTabId === tabId) {
      // Switch to the previous or next tab
      if (newTabs.length > 0) {
        const newActiveTab = newTabs[newTabs.length - 1];
        setActiveTabId(newActiveTab.id);
        setCode(newActiveTab.content);
      } else {
        setActiveTabId(null);
        setCode('');
      }
    }
  };

  const handleTabRename = (tabId: string, newName: string) => {
    setTabs(tabs.map(tab => 
      tab.id === tabId ? { ...tab, name: newName } : tab
    ));
  };

  const handleCompile = () => {
    setCliOutput('');
    setSerialOutput([]);
    setPinStates([]);
    
    // Get the actual main sketch code - use editor ref if available,
    // otherwise use state
    let mainSketchCode: string;
    if (activeTabId === tabs[0]?.id && editorRef.current) {
      // If the main tab is active, get the latest code from the editor
      mainSketchCode = editorRef.current.getValue();
    } else {
      // Otherwise use the stored content
      mainSketchCode = tabs[0]?.content || code;
    }
    
    // Prepare header files (all tabs except the first)
    const headers = tabs.slice(1).map(tab => ({
      name: tab.name,
      content: tab.content
    }));
    console.log('[CLIENT] Compiling with', headers.length, 'headers');
    compileMutation.mutate({ code: mainSketchCode, headers });
  };

  const handleStop = () => {
    if (!ensureBackendConnected('Simulation stoppen')) return;
    stopMutation.mutate();
  };

  const handleStart = () => {
    if (!ensureBackendConnected('Simulation starten')) return;
    startMutation.mutate();
  };

  // Reset simulation (stop, recompile, and restart - like pressing the physical reset button)
  const handleReset = () => {
    if (!ensureBackendConnected('Simulation zurücksetzen')) return;
    // Stop if running
    if (simulationStatus === 'running') {
      sendMessage({ type: 'stop_simulation' });
      setSimulationStatus('stopped');
    }
    // Clear serial output on reset
    setSerialOutput([]);
    // Reset pin states
    setPinStates([]);
    
    toast({
      title: "Resetting...",
      description: "Recompiling and restarting simulation",
    });
    
    // Small delay then recompile and start
    setTimeout(() => {
      handleCompileAndStart();
    }, 100);
  };

  const handleCompileAndStart = () => {
    if (!ensureBackendConnected('Simulation starten')) return;
    // Get the actual main sketch code - prioritize editor, then tabs, then state
    let mainSketchCode: string = '';
    
    // Try editor first (most up-to-date)
    if (editorRef.current) {
      try {
        mainSketchCode = editorRef.current.getValue();
      } catch (error) {
        console.error('[CLIENT] Error getting code from editor:', error);
        // Fall through to fallbacks
      }
    }
    
    // Fallback to tabs (for header scenario)
    if (!mainSketchCode && tabs.length > 0 && tabs[0]?.content) {
      mainSketchCode = tabs[0].content;
    }
    
    // Last fallback to state
    if (!mainSketchCode && code) {
      mainSketchCode = code;
    }
    
    // Validate we have code
    if (!mainSketchCode || mainSketchCode.trim().length === 0) {
      toast({
        title: "No Code",
        description: "Please write some code before compiling",
        variant: "destructive",
      });
      return;
    }
    
    // Prepare header files (all tabs except the first)
    const headers = tabs.slice(1).map(tab => ({
      name: tab.name,
      content: tab.content
    }));
    console.log('[CLIENT] Compile & Start with', headers.length, 'headers');
    console.log('[CLIENT] Code length:', mainSketchCode.length, 'bytes');
    console.log('[CLIENT] Main code from:', editorRef.current ? 'editor' : (tabs[0]?.content ? 'tabs' : 'state'));
    console.log('[CLIENT] Tabs:', tabs.map(t => `${t.name}(${t.content.length}b)`).join(', '));
    
    setCliOutput('');
    setSerialOutput([]);
    setCompilationStatus('compiling');
    setArduinoCliStatus('compiling'); // Track HTTP compile request

    compileMutation.mutate({ code: mainSketchCode, headers }, {
      onSuccess: (data) => {
        console.log('[CLIENT] Compile response:', JSON.stringify(data, null, 2));
        
        // Update arduinoCliStatus based on compile result
        setArduinoCliStatus(data.success ? 'success' : 'error');
        // Don't set gccStatus here - it will be set by WebSocket when g++ runs
        
        // Display compilation output or errors (REPLACE, don't append)
        if (data.success) {
          console.log('[CLIENT] Compile SUCCESS, output:', data.output);
          setCliOutput(data.output || '✓ Arduino-CLI Compilation succeeded.');
        } else {
          console.log('[CLIENT] Compile FAILED, errors:', data.errors);
          setCliOutput(data.errors || '✗ Arduino-CLI Compilation failed.');
        }
        
        // Only start simulation when compilation succeeded
        if (data?.success) {
          startMutation.mutate();
          setCompilationStatus('success');
          setHasCompiledOnce(true);
          setIsModified(false);
          
          // Reset CLI status to idle after a short delay
          setTimeout(() => {
            setArduinoCliStatus('idle');
          }, 2000);
        } else {
          // Optional error handling if API response is unclear
          setCompilationStatus('error');
          toast({
            title: "Compilation Completed with Errors",
            description: "Simulation will not start due to compilation errors.",
            variant: "destructive",
          });
          
          // Reset CLI status to idle after a short delay
          setTimeout(() => {
            setArduinoCliStatus('idle');
          }, 2000);
        }
      },
      onError: () => {
        setCompilationStatus('error');
        setArduinoCliStatus('error');
        toast({
          title: "Compilation Failed",
          description: "Simulation will not start due to compilation errors.",
          variant: "destructive",
        });
        
        // Reset CLI status to idle after a short delay
        setTimeout(() => {
          setArduinoCliStatus('idle');
        }, 2000);
      },
    });
  };

  const handleSerialSend = (message: string) => {
    if (!ensureBackendConnected('Serial senden')) return;
    // Trigger RX LED blink (Arduino is receiving data)
    setRxActivity(prev => prev + 1);
    
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

  // Replace 'Compilation Successful' with 'Successful' in status label
  function compilationStatusLabel(status: string) {
    switch (status) {
      case 'idle':
        return 'Idle';
      case 'compiling':
        return 'Compiling...';
      case 'success':
        return 'Successful';
      case 'error':
        return 'Error';
      default:
        return status;
    }
  }

  const statusInfo = getStatusInfo();
  const simulateDisabled = (simulationStatus !== 'running' && (!backendReachable || !isConnected))
    || compileMutation.isPending
    || startMutation.isPending
    || stopMutation.isPending;
  const stopDisabled = simulationStatus !== 'running' || stopMutation.isPending;
  const buttonsClassName = "hover:bg-green-600 hover:text-white transition-colors";

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header/Toolbar */}
      <div className="bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Cpu 
              className="h-5 w-5" 
              style={{
                color: simulationStatus === 'running' ? '#22c55e' : '#6b7280',
                filter: simulationStatus === 'running' ? 'drop-shadow(0 0 6px #22c55e)' : 'none',
                transition: 'color 200ms ease-in-out, filter 200ms ease-in-out'
              }}
            />
            <h1 className="text-lg font-semibold">Arduino UNO Simulator</h1>
          </div>
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <span className="bg-muted px-2 py-1 rounded text-xs">Board: Arduino UNO</span>
            <span className="bg-muted px-2 py-1 rounded text-xs">Baud: 115200</span>
            <div className="bg-muted px-2 py-1 rounded text-xs flex items-center cursor-pointer hover:bg-muted/80 transition-colors relative">
              <span className="pointer-events-none">Timeout:</span>
              <select
                value={simulationTimeout}
                onChange={(e) => {
                  const newTimeout = Number(e.target.value);
                  console.log('[Timeout] Changed to:', newTimeout);
                  setSimulationTimeout(newTimeout);
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full"
              >
                <option value={5}>5s</option>
                <option value={10}>10s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
                <option value={120}>2min</option>
                <option value={300}>5min</option>
                <option value={600}>10min</option>
                <option value={0}>∞</option>
              </select>
              <span className="ml-1 pointer-events-none">
                {simulationTimeout === 0 ? '∞' : 
                 simulationTimeout >= 60 ? `${simulationTimeout / 60}min` : `${simulationTimeout}s`}
              </span>
              <svg className="w-3 h-3 ml-1 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 text-sm">
            <div 
              className="w-6 h-6 rounded-full"
              style={{
                backgroundColor: compilationStatus === 'compiling' ? '#eab308' :
                  compilationStatus === 'success' ? '#22c55e' :
                  compilationStatus === 'error' ? '#ef4444' :
                  compilationStatus === 'ready' ? '#6b7280' : '#3b82f6',
                boxShadow: compilationStatus === 'success' ? '0 0 12px 3px rgba(34,197,94,0.6)' : 
                  compilationStatus === 'error' ? '0 0 12px 3px rgba(239,68,68,0.6)' : 'none',
                transition: 'background-color 500ms ease-in-out, box-shadow 500ms ease-in-out',
                animation: (compilationStatus === 'compiling' || compilationStatus === 'success') 
                  ? 'gentle-pulse 3s ease-in-out infinite' 
                  : compilationStatus === 'error' 
                  ? 'error-blink 0.3s ease-in-out 5' 
                  : 'none'
              }}
            />
            <style>{`
              @keyframes gentle-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.7; }
              }
              @keyframes error-blink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
              }
            `}</style>

          </div>

          <div className="flex flex-col space-y-1 text-xs w-32 max-w-full ml-8">
            <div 
              className="flex items-center px-1.5 py-1 rounded border border-border bg-muted transition-colors duration-300 w-full min-w-0"
              style={{
                backgroundColor: arduinoCliStatus === 'compiling' ? 'rgba(234, 179, 8, 0.10)' :
                  arduinoCliStatus === 'success' ? 'rgba(34, 197, 94, 0.10)' :
                  arduinoCliStatus === 'error' ? 'rgba(239, 68, 68, 0.10)' :
                  'rgba(107, 114, 128, 0.10)'
              }}
            >
              <Terminal className="h-3 w-3 mr-1 flex-shrink-0" />
              <span className="whitespace-nowrap overflow-hidden text-ellipsis max-w-full">{`CLI: ${compilationStatusLabel(arduinoCliStatus)}`}</span>
            </div>
            <div 
              className="flex items-center px-1.5 py-1 rounded border border-border bg-muted transition-colors duration-300 w-full min-w-0"
              style={{
                backgroundColor: gccStatus === 'compiling' ? 'rgba(234, 179, 8, 0.10)' :
                  gccStatus === 'success' ? 'rgba(34, 197, 94, 0.10)' :
                  gccStatus === 'error' ? 'rgba(239, 68, 68, 0.10)' :
                  'rgba(107, 114, 128, 0.10)'
              }}
            >
              <Wrench className="h-3 w-3 mr-1 flex-shrink-0" />
              <span className="whitespace-nowrap overflow-hidden text-ellipsis max-w-full">{`GCC: ${compilationStatusLabel(gccStatus)}`}</span>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Button
              onClick={simulationStatus === 'running' ? handleStop : handleCompileAndStart}
              disabled={simulateDisabled}
              className={clsx(
                'w-64',
                '!text-white',
                'transition-colors',
                {
                  // Classes for the 'running' state (orange for Stop)
                  '!bg-orange-600 hover:!bg-orange-700': simulationStatus === 'running' && !simulateDisabled,

                  // Classes for the 'stopped' state (green for Start)
                  '!bg-green-600 hover:!bg-green-700': simulationStatus !== 'running' && !simulateDisabled,

                  // Classes for the disabled state (regardless of simulationStatus)
                  'opacity-50 cursor-not-allowed bg-gray-500 hover:!bg-gray-500': simulateDisabled,
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
              {/* Sketch Tabs */}
              <SketchTabs
                tabs={tabs}
                activeTabId={activeTabId}
                modifiedTabId={null}
                onTabClick={handleTabClick}
                onTabClose={handleTabClose}
                onTabRename={handleTabRename}
                onTabAdd={handleTabAdd}
                onFilesLoaded={handleFilesLoaded}
                onFormatCode={formatCode}
                examplesMenu={<ExamplesMenu onLoadExample={handleLoadExample} backendReachable={backendReachable} />}
              />

              <div className="flex-1 min-h-0">
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
              <ResizablePanel defaultSize={25} minSize={15} id="compilation-panel">
                <CompilationOutput
                  output={cliOutput}
                  onClear={handleClearCompilationOutput}
                />
              </ResizablePanel>

              <ResizableHandle withHandle data-testid="vertical-resizer" />

              <ResizablePanel defaultSize={25} minSize={15} id="serial-panel">
                <SerialMonitor
                  output={serialOutput}
                  isConnected={isConnected}
                  isSimulationRunning={simulationStatus === 'running'}
                  onSendMessage={handleSerialSend}
                  onClear={handleClearSerialOutput}
                />
              </ResizablePanel>

              <ResizableHandle withHandle data-testid="vertical-resizer-board" />

              <ResizablePanel defaultSize={50} minSize={15} id="board-panel">
                <ArduinoBoard
                  pinStates={pinStates}
                  isSimulationRunning={simulationStatus === 'running'}
                  txActive={txActivity}
                  rxActive={rxActivity}
                  onReset={handleReset}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}