//arduino-simulator.tsx

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Cpu, Play, Square, Loader2, Terminal, Wrench, Zap, Trash2, ChevronsDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/features/code-editor';
import { SerialMonitor } from '@/components/features/serial-monitor';
import { SerialPlotter } from '@/components/features/serial-plotter';
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
// Intentionally reference to satisfy no-unused-locals during type check
void logger;

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
  // Serial view mode (monitor / both / plotter)
  const [serialViewMode, setSerialViewMode] = useState<'monitor' | 'plotter' | 'both'>('monitor');
  const showSerialMonitor = serialViewMode !== 'plotter';
  const showSerialPlotter = serialViewMode !== 'monitor';
  // Autoscroll toggle for serial monitor
  const [autoScrollEnabled, setAutoScrollEnabled] = useState<boolean>(true);

  const cycleSerialViewMode = () => {
    setSerialViewMode((prev) => {
      if (prev === 'monitor') return 'both';
      if (prev === 'both') return 'plotter';
      return 'monitor';
    });
  };
  // Analog pins detected in the code that need sliders (internal pin numbers 14..19)
  const [analogPinsUsed, setAnalogPinsUsed] = useState<number[]>([]);
  // Detected explicit pinMode(...) declarations found during parsing.
  // We store modes for pins so that we can apply them when the simulation starts.
  const [detectedPinModes, setDetectedPinModes] = useState<Record<number, 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP'>>({});
  // Pins that have a detected pinMode(...) declaration which conflicts with analogRead usage
  const [pendingPinConflicts, setPendingPinConflicts] = useState<number[]>([]);

  // Centralized helper to reset UI pin-related state. Pass { keepDetected: true }
  // to preserve detected pinMode declarations and pending conflicts when desired.
  const resetPinUI = useCallback((opts?: { keepDetected?: boolean }) => {
    setPinStates([]);
    // Only clear detected/derived data when keepDetected is not requested.
    if (!opts?.keepDetected) {
      setAnalogPinsUsed([]);
      setDetectedPinModes({});
      setPendingPinConflicts([]);
    }
  }, []);
  
  // Simulation timeout setting (in seconds)
  const [simulationTimeout, setSimulationTimeout] = useState<number>(60);

  // Serial input box state (always visible at bottom of serial frame)
  const [serialInputValue, setSerialInputValue] = useState('');

  const handleSerialInputSend = () => {
    if (!serialInputValue.trim()) return;
    handleSerialSend(serialInputValue);
    setSerialInputValue('');
  };

  const handleSerialInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSerialInputSend();
  };
  
  // RX/TX LED activity counters (increment on activity for change detection)
  const [txActivity, setTxActivity] = useState(0);
  const [rxActivity, setRxActivity] = useState(0);
  // Track the last scheduled display timestamp for serial output (epoch ms)
  const lastSerialDisplayRef = useRef<number>(Date.now());
  // Track wall-clock time when last serial_event was received
  const lastSerialEventAtRef = useRef<number>(0);
  // Queue for incoming serial_events to be processed in order
  const [serialEventQueue, setSerialEventQueue] = useState<Array<{payload: any, receivedAt: number}>>([]);

  // Mobile UI: detect small screens and provide a floating tab full-screen view
  const isClient = typeof window !== 'undefined';
  const mqQuery = '(max-width: 768px)';
  const initialIsMobile = isClient ? window.matchMedia(mqQuery).matches : false;
  const [isMobile, setIsMobile] = useState<boolean>(initialIsMobile);
  // Initialize mobilePanel immediately on mount when on mobile to avoid flicker/delay
  const [mobilePanel, setMobilePanel] = useState<'code' | 'compile' | 'serial' | 'board' | null>(initialIsMobile ? 'code' : null);

  useEffect(() => {
    if (!isClient) return;
    const mq = window.matchMedia(mqQuery);
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const matches = 'matches' in e ? e.matches : mq.matches;
      setIsMobile(matches);
      // If switching into mobile mode, open code panel immediately
      if (matches && !mobilePanel) setMobilePanel('code');
      // If switching out of mobile, close any mobile panel
      if (!matches) setMobilePanel(null);
    };
    // Modern browsers: addEventListener; fallback to addListener
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange as any);
    else mq.addListener(onChange as any);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange as any);
      else mq.removeListener(onChange as any);
    };
  }, [isClient, mobilePanel]);

  // Prevent body scroll when mobile panel is open
  useEffect(() => {
    if (!isClient) return;
    const prev = document.body.style.overflow;
    if (mobilePanel) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = prev || '';
    }
    return () => { document.body.style.overflow = prev || ''; };
  }, [mobilePanel, isClient]);

  // Compute header height so mobile overlay can sit below it (preserve normal header)
  const [headerHeight, setHeaderHeight] = useState<number>(56);
  const [overlayZ, setOverlayZ] = useState<number>(30);
  useEffect(() => {
    if (!isClient) return;
    const measure = () => {
      // First try to find our mobile header by data attribute
      let hdr: Element | null = document.querySelector('[data-mobile-header]');
      // Fallback to <header> tag
      if (!hdr) hdr = document.querySelector('header');
      if (!hdr) {
        const all = Array.from(document.body.querySelectorAll('*')) as HTMLElement[];
        hdr = all.find(el => {
          if (!el) return false;
          // ignore html/body
          if (el === document.body || el === document.documentElement) return false;
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
          const r = el.getBoundingClientRect();
          // must be near the top and reasonably small (not full-page)
          if (r.top < -5 || r.top > 48) return false;
          if (r.height < 24 || r.height > window.innerHeight / 2) return false;
          return true;
        }) || null;
      }

      if (hdr === document.body || hdr === document.documentElement) hdr = null;

      let h = 56;
      if (hdr) {
        const rect = (hdr as HTMLElement).getBoundingClientRect();
        if (rect.height > 0 && rect.height < window.innerHeight / 2) h = Math.ceil(rect.height);
      }
      setHeaderHeight(h);

      let z = 0;
      if (hdr) {
        const zStr = getComputedStyle(hdr as HTMLElement).zIndex;
        const zNum = parseInt(zStr || '', 10);
        z = Number.isFinite(zNum) ? zNum : 0;
      }
      const chosenZ = z > 0 ? Math.max(z - 1, 5) : 30;
      setOverlayZ(chosenZ);
      console.debug('[mobile overlay] header detect:', hdr, 'headerHeight=', h, 'overlayZ=', chosenZ);
    };

    measure();
    window.addEventListener('resize', measure);
    const hdr = document.querySelector('header');
    if (hdr) {
      const obs = new MutationObserver(measure);
      obs.observe(hdr, { attributes: true, childList: true, subtree: true });
      return () => {
        window.removeEventListener('resize', measure);
        obs.disconnect();
      };
    }
  }, [isClient]);

  // Backend availability tracking
  const [backendReachable, setBackendReachable] = useState(true);
  const [backendPingError, setBackendPingError] = useState<string | null>(null);
  
  // Ref to track if backend was ever unreachable (for recovery toast)
  const wasBackendUnreachableRef = useRef(false);
  
  // Ref to track previous backend reachable state for detecting transitions
  const prevBackendReachableRef = useRef(true);


  const { toast } = useToast();
  // transient screen glitch on compile error
  const [showErrorGlitch, setShowErrorGlitch] = useState(false);
  const triggerErrorGlitch = (duration = 600) => {
    try {
      setShowErrorGlitch(true);
      window.setTimeout(() => setShowErrorGlitch(false), duration);
    } catch {}
  };
  const queryClient = useQueryClient();
  const { isConnected, connectionError, hasEverConnected, lastMessage, messageQueue, consumeMessages, sendMessage } = useWebSocket();
  // Mark some hook values as intentionally read to avoid TS unused-local errors
  void isConnected;
  void lastMessage;

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
        // trigger global red glitch to indicate compile error
        triggerErrorGlitch();
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
      // network/backend or unexpected compile error — show glitch as well
      triggerErrorGlitch();
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
      // Clear serial event queue to prevent buffered characters from appearing after stop
      setSerialEventQueue([]);
      // Reset UI pin state on stop but preserve detected pinMode declarations
      resetPinUI({ keepDetected: true });
    },
  });

  // Start simulation mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      // Reset UI before starting a fresh simulation but preserve detected pinMode info
      resetPinUI({ keepDetected: true });
      sendMessage({ type: 'start_simulation', timeout: simulationTimeout });
      return { success: true };
    },
    onSuccess: () => {
      setSimulationStatus('running');
      toast({
        title: "Simulation Started",
        description: "Arduino simulation is now running",
      });
      // If there are any pending pin conflicts detected during parsing,
      // append a warning to the compilation output so the user sees it in
      // the Compiler panel after starting the simulation.
      try {
        if (pendingPinConflicts && pendingPinConflicts.length > 0) {
          const names = pendingPinConflicts.map(p => (p >= 14 && p <= 19) ? `A${p - 14}` : `${p}`).join(', ');
          setCliOutput(prev => (prev ? prev + "\n\n" : "") + `⚠️ Pin usage conflict: Pins used as digital via pinMode(...) and also read with analogRead(): ${names}. This may be unintended.`);
          // Clear pending after showing once
          setPendingPinConflicts([]);
        }
      } catch {}
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
          let text = message.data;
          const isComplete = message.isComplete ?? true; // Default to true for backwards compatibility

          // Trigger TX LED blink (Arduino is transmitting data)
          setTxActivity(prev => prev + 1);

          // If we recently received structured `serial_event` messages, ignore legacy `serial_output` to avoid duplicates
          const now = Date.now();
          if (lastSerialEventAtRef.current && (now - lastSerialEventAtRef.current) < 1000) {
            // Short-circuit: drop this legacy serial_output
            // eslint-disable-next-line no-console
            console.debug('Dropping legacy serial_output because recent serial_event exists', { text, ageMs: now - lastSerialEventAtRef.current });
            break;
          }

          // Remove trailing newlines from text (they are represented by isComplete flag)
          const isNewlineOnly = text === '\n' || text === '\r\n';
          if (isNewlineOnly) {
            text = ''; // Don't add the newline character to the text
          }

          setSerialOutput(prev => {
            const newLines = [...prev];

            if (isComplete) {
              // Check if last line is incomplete - if so, complete it
              if (newLines.length > 0 && !newLines[newLines.length - 1].complete) {
                // Complete the existing incomplete line (add text only if non-empty)
                newLines[newLines.length - 1] = {
                  text: newLines[newLines.length - 1].text + text,
                  complete: true
                };
              } else {
                // Complete line without pending incomplete - add as new line only if text is non-empty
                if (text.length > 0) {
                  newLines.push({ text, complete: true });
                }
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
          case 'serial_event': {
            // Only queue serial events if simulation is running
            if (simulationStatus === 'running') {
              const payload = (message as any).payload || {};
              // Record arrival time so we can suppress duplicate legacy serial_output messages
              const receivedAt = Date.now();
              lastSerialEventAtRef.current = receivedAt;
              // Debug: log incoming payloads to console to help diagnose ordering issues
              // eslint-disable-next-line no-console
              console.debug('[serial_event recv]', { payload, receivedAt });
              // Deduplicate: if last queued event has same ts_write and data, skip
              setSerialEventQueue(prev => {
                const last = prev.length > 0 ? prev[prev.length - 1] : null;
                try {
                  if (last && last.payload && payload && last.payload.ts_write === payload.ts_write && last.payload.data === payload.data) {
                    // eslint-disable-next-line no-console
                    console.debug('Dedup serial_event skipped', { ts_write: payload.ts_write });
                    return prev;
                  }
                } catch (e) {
                  // ignore comparison errors
                }
                return [...prev, { payload, receivedAt }];
              });
            }
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
            // Preserve detected pinMode declarations when simulation stops
            resetPinUI({ keepDetected: true });
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
                // If a mode update comes from the runtime (pinMode call), consider this an explicit
                // digital usage — convert an auto-detected 'analog' type to 'digital' so the UI
                // shows a solid frame instead of dashed.
                newStates[existingIndex] = {
                  ...newStates[existingIndex],
                  mode: modeMap[value] || 'INPUT',
                  type: newStates[existingIndex].type === 'analog' ? 'digital' : newStates[existingIndex].type
                };
              } else if (stateType === 'value') {
                // Update value only. Do NOT change the pin `type` based on incoming
                // value updates — `pinMode` (runtime or parsed) controls whether a
                // pin is considered digital. For analog pins that were never
                // explicitly `pinMode`-ed, new entries (below) will be created
                // with type 'analog'. Here we preserve existing.type.
                newStates[existingIndex] = {
                  ...newStates[existingIndex],
                  value
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
                // New pins on 14..19 are analog by default when a value arrives
                // and we haven't seen an explicit pinMode yet.
                type: stateType === 'pwm' ? 'pwm' : (pin >= 14 && pin <= 19 ? 'analog' : 'digital')
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
    sendMessage({ type: 'code_changed' });
    if (simulationStatus === 'running') {
      setSimulationStatus('stopped');
      // Reset all UI pin state when code changes while running
      resetPinUI();
    }
    // Detected pin modes and pending conflicts are cleared as part of resetPinUI
    
    // Update the active tab content
    if (activeTabId) {
      setTabs(tabs.map(tab => 
        tab.id === activeTabId ? { ...tab, content: newCode } : tab
      ));
    }
  };

  // Parse the current code to detect which analog pins are used by name or channel
  useEffect(() => {
    let mainCode = code;
    if (!mainCode && tabs.length > 0) mainCode = tabs[0].content || '';

    const pins = new Set<number>();
    const varMap = new Map<string, number>();

    // Detect #define VAR A0 or #define VAR 0
    const defineRe = /#define\s+(\w+)\s+(A\d|\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = defineRe.exec(mainCode))) {
      const name = m[1];
      const token = m[2];
      let p: number | undefined;
      const aMatch = token.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
      } else if (/^\d+$/.test(token)) {
        const idx = Number(token);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
        else if (idx >= 14 && idx <= 19) p = idx;
      }
      if (p !== undefined) varMap.set(name, p);
    }

    // Detect simple variable assignments like: int sensorPin = A0; or const int s = 0;
    const assignRe = /(?:int|const\s+int|uint8_t|byte)\s+(\w+)\s*=\s*(A\d|\d+)\s*;/g;
    while ((m = assignRe.exec(mainCode))) {
      const name = m[1];
      const token = m[2];
      let p: number | undefined;
      const aMatch = token.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
      } else if (/^\d+$/.test(token)) {
        const idx = Number(token);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
        else if (idx >= 14 && idx <= 19) p = idx;
      }
      if (p !== undefined) varMap.set(name, p);
    }

    // Find all analogRead(...) occurrences
    const areadRe = /analogRead\s*\(\s*([^\)]+)\s*\)/g;
    while ((m = areadRe.exec(mainCode))) {
      const token = m[1].trim();
      // strip possible casts or expressions (very simple handling)
      const simple = token.match(/^(A\d+|\d+|\w+)$/i);
      if (!simple) continue;
      const tok = simple[1];
      // If token is A<n>
      const aMatch = tok.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) pins.add(14 + idx);
        continue;
      }
      // If numeric literal
      if (/^\d+$/.test(tok)) {
        const idx = Number(tok);
        if (idx >= 0 && idx <= 5) pins.add(14 + idx);
        else if (idx >= 14 && idx <= 19) pins.add(idx);
        continue;
      }
      // Otherwise assume variable name - resolve from varMap
      if (varMap.has(tok)) {
        pins.add(varMap.get(tok)!);
      }
    }

      // Detect for-loops like: for (byte i=16; i<20; i++) { ... analogRead(i) ... }
      const forLoopRe = /for\s*\(\s*(?:byte|int|unsigned|uint8_t)?\s*(\w+)\s*=\s*(\d+)\s*;\s*\1\s*(<|<=)\s*(\d+)\s*;[^\)]*\)\s*\{([\s\S]*?)\}/g;
      let fm: RegExpExecArray | null;
      while ((fm = forLoopRe.exec(mainCode))) {
        const varName = fm[1];
        const start = Number(fm[2]);
        const cmp = fm[3];
        const end = Number(fm[4]);
        const body = fm[5];
        const useRe = new RegExp('analogRead\\s*\\(\\s*' + varName + '\\s*\\)', 'g');
        if (useRe.test(body)) {
          const inclusive = cmp === '<=';
          const last = inclusive ? end : end - 1;
          for (let pin = start; pin <= last; pin++) {
            // If the loop iterates over analog channel numbers (0..5) or internal pins (14..19 or 16..19), handle mapping
            if (pin >= 0 && pin <= 5) pins.add(14 + pin);
            else if (pin >= 14 && pin <= 19) pins.add(pin);
            else if (pin >= 16 && pin <= 19) pins.add(pin);
          }
        }
      }

    const arr = Array.from(pins).sort((a, b) => a - b);
    setAnalogPinsUsed(arr);

    // Do NOT prepopulate `pinStates` for detected analog pins here —
    // showing analog-only frames should only happen when the simulation
    // is actually running. Populate `pinStates` for analog pins when
    // `simulationStatus` becomes 'running' (see separate effect below).

    // Detect explicit pinMode calls in code so pins become clickable even before runtime updates
    // Examples: pinMode(A0, INPUT); pinMode(14, INPUT_PULLUP);
    const pinModeRe = /pinMode\s*\(\s*(A\d+|\d+)\s*,\s*(INPUT_PULLUP|INPUT|OUTPUT)\s*\)/g;
    const digitalPinsFromPinMode = new Set<number>();
    while ((m = pinModeRe.exec(mainCode))) {
      const token = m[1];
      const modeToken = m[2];
      let p: number | undefined;
      const aMatch = token.match(/^A(\d+)$/i);
      if (aMatch) {
        const idx = Number(aMatch[1]);
        if (idx >= 0 && idx <= 5) p = 14 + idx;
      } else if (/^\d+$/.test(token)) {
        // Treat numeric literals in pinMode(...) as literal Arduino pin numbers.
        const idx = Number(token);
        if (idx >= 0 && idx <= 255) p = idx;
      }
      if (p !== undefined) {
        digitalPinsFromPinMode.add(p);
        const mode = modeToken === 'INPUT_PULLUP' ? 'INPUT_PULLUP' : (modeToken === 'OUTPUT' ? 'OUTPUT' : 'INPUT');

        // For analog-numbered pins (14..19), do NOT immediately insert into
        // `pinStates`. We want analog pins (even when used via pinMode(Ax,...))
        // to become visible only when the simulation starts. Record the detected
        // mode in `detectedPinModes` so it can be applied on simulation start.
        if (p >= 14 && p <= 19) {
          setDetectedPinModes(prev => ({ ...prev, [p]: mode }));
        } else {
          // Non-analog pins: make them clickable immediately
          setPinStates(prev => {
            const newStates = [...prev];
            const exists = newStates.find(x => x.pin === p);
            if (!exists) {
              newStates.push({ pin: p, mode: mode as any, value: 0, type: 'digital' });
            } else {
              exists.mode = mode as any;
              exists.type = 'digital';
            }
            return newStates;
          });
        }
      }
    }

    // If any pin is both declared via pinMode(...) and used with analogRead(...), warn the user
    try {
      const overlap = Array.from(pins).filter(p => digitalPinsFromPinMode.has(p));
      if (overlap.length > 0) {
        // Store conflicts and show them when simulation starts
        setPendingPinConflicts(overlap);
        console.warn('[arduino-simulator] Pin usage conflict for pins:', overlap.map(p => (p >= 14 && p <= 19) ? `A${p - 14}` : `${p}`).join(', '));
      } else {
        setPendingPinConflicts([]);
      }
    } catch {}
  }, [code, tabs, activeTabId]);

  // When the simulation starts, apply recorded pinMode declarations and
  // populate any detected analog pins so they become clickable and show
  // their frames only while the simulation is running.
  useEffect(() => {
    if (simulationStatus !== 'running') return;

    setPinStates(prev => {
      const newStates = [...prev];

      // Apply recorded pinMode(...) declarations (including analog-numbered pins)
      for (const [pinStr, mode] of Object.entries(detectedPinModes)) {
        const pin = Number(pinStr);
        if (Number.isNaN(pin)) continue;
        const exists = newStates.find(p => p.pin === pin);
        if (!exists) {
          newStates.push({ pin, mode: mode as any, value: 0, type: (pin >= 14 && pin <= 19) ? 'digital' : 'digital' });
        } else {
          exists.mode = mode as any;
          if (pin >= 14 && pin <= 19) exists.type = 'digital';
        }
      }

      // Ensure detected analog pins are present (as analog) if not already
      for (const pin of analogPinsUsed) {
        if (pin < 14 || pin > 19) continue;
        const exists = newStates.find(p => p.pin === pin);
        if (!exists) {
          newStates.push({ pin, mode: 'INPUT', value: 0, type: 'analog' });
        }
      }

      return newStates;
    });
  }, [simulationStatus, analogPinsUsed, detectedPinModes]);

  // Process queued serial events in order
  useEffect(() => {
    if (serialEventQueue.length === 0) return;

    // Sort events by original write timestamp when available (fallback to receivedAt)
    const sortedEvents = [...serialEventQueue].sort((a, b) => {
      const ta = (a.payload && typeof a.payload.ts_write === 'number') ? a.payload.ts_write : a.receivedAt;
      const tb = (b.payload && typeof b.payload.ts_write === 'number') ? b.payload.ts_write : b.receivedAt;
      return ta - tb;
    });

    // Process events sequentially, building a buffer
    let buffer = '';
    let newLines: OutputLine[] = [...serialOutput];

    for (const { payload } of sortedEvents) {
      // Normalize data: ensure string but PRESERVE \r for carriage return handling in Serial Monitor
      const piece: string = (payload.data || '').toString();
      buffer += piece;

      // Process complete lines
      while (buffer.includes('\n')) {
        const pos = buffer.indexOf('\n');
        const toProcess = buffer.substring(0, pos + 1);
        buffer = buffer.substring(pos + 1);

        const lines = toProcess.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (i < lines.length - 1) {
            // Complete lines
            if (newLines.length === 0 || newLines[newLines.length - 1].complete) {
              newLines.push({ text: line, complete: true });
            } else {
              newLines[newLines.length - 1].text += line;
              newLines[newLines.length - 1].complete = true;
            }
          } else {
            // Last part, incomplete
            if (line) {
              if (newLines.length === 0 || newLines[newLines.length - 1].complete) {
                newLines.push({ text: line, complete: false });
              } else {
                newLines[newLines.length - 1].text += line;
              }
            }
          }
        }
      }
    }

    // Process remaining buffer as incomplete line
    if (buffer) {
      if (newLines.length === 0 || newLines[newLines.length - 1].complete) {
        newLines.push({ text: buffer, complete: false });
      } else {
        newLines[newLines.length - 1].text += buffer;
      }
    }

    setSerialOutput(newLines);

    // Clear queue after processing
    setSerialEventQueue([]);
  }, [serialEventQueue]);

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
      // Reset UI pin state and detected pin-mode info
      resetPinUI();
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
    // Reset UI pin state and detected pin-mode info
    resetPinUI();
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
  // mark as intentionally present
  void handleStart;

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
    // Reset pin states (preserve detected pinMode info)
    resetPinUI({ keepDetected: true });
    
    toast({
      title: "Resetting...",
      description: "Recompiling and restarting simulation",
    });
    
    // Small delay then recompile and start
    setTimeout(() => {
      handleCompileAndStart();
    }, 100);
  };

  // Toggle INPUT pin value (called when user clicks on an INPUT pin square)
  const handlePinToggle = (pin: number, newValue: number) => {
    if (simulationStatus !== 'running') {
      toast({
        title: "Simulation nicht aktiv",
        description: "Starte die Simulation, um Pin-Werte zu ändern.",
        variant: "destructive",
      });
      return;
    }
    
    // Send the new pin value to the server
    sendMessage({ type: 'set_pin_value', pin, value: newValue });
    
    // Update local pin state immediately for responsive UI
    setPinStates(prev => {
      const newStates = [...prev];
      const existingIndex = newStates.findIndex(p => p.pin === pin);
      if (existingIndex >= 0) {
        newStates[existingIndex] = {
          ...newStates[existingIndex],
          value: newValue,
        };
      }
      return newStates;
    });
  };

  // Handle analog slider changes (0..1023)
  const handleAnalogChange = (pin: number, newValue: number) => {
    if (simulationStatus !== 'running') {
      toast({
        title: "Simulation nicht aktiv",
        description: "Starte die Simulation, um Pin-Werte zu ändern.",
        variant: "destructive",
      });
      return;
    }

    sendMessage({ type: 'set_pin_value', pin, value: newValue });

    // Update local pin state immediately for responsive UI
    setPinStates(prev => {
      const newStates = [...prev];
      const existingIndex = newStates.findIndex(p => p.pin === pin);
      if (existingIndex >= 0) {
        newStates[existingIndex] = {
          ...newStates[existingIndex],
          value: newValue,
          type: 'analog'
        };
      } else {
        newStates.push({ pin, mode: 'INPUT', value: newValue, type: 'analog' });
      }
      return newStates;
    });
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
  void getStatusClass;
  void statusInfo;
  const simulateDisabled = (simulationStatus !== 'running' && (!backendReachable || !isConnected))
    || compileMutation.isPending
    || startMutation.isPending
    || stopMutation.isPending;
  const stopDisabled = simulationStatus !== 'running' || stopMutation.isPending;
  const buttonsClassName = "hover:bg-green-600 hover:text-white transition-colors";
  void stopDisabled;
  void buttonsClassName;

  return (
    <div className={`h-screen flex flex-col bg-background text-foreground relative ${showErrorGlitch ? 'overflow-hidden' : ''}`}>
      {/* Glitch overlay when compilation fails */}
      {showErrorGlitch && (
        <div className="pointer-events-none absolute inset-0 z-50">
          {/* Single red border flash */}
          <div className="absolute inset-0 flex items-stretch justify-stretch">
            <div className="absolute inset-0">
              <div className="absolute inset-0 border-0 pointer-events-none">
                <div className="absolute inset-0 rounded-none border-4 border-red-500 opacity-0 animate-border-flash" />
              </div>
            </div>
          </div>
          <style>{`
            @keyframes border-flash {
              0% { opacity: 0; transform: scale(1); }
              10% { opacity: 1; }
              60% { opacity: 0.7; }
              100% { opacity: 0; }
            }
            .animate-border-flash { animation: border-flash 0.6s ease-out both; }
          `}</style>
        </div>
      )}
      {/* Blue breathing border when backend is unreachable */}
      {!backendReachable && (
        <div className="pointer-events-none absolute inset-0 z-40">
          <div className="absolute inset-0">
            <div className="absolute inset-0 border-0 pointer-events-none">
              <div className="absolute inset-0 rounded-none border-2 border-blue-400 opacity-80 animate-breathe-blue" />
            </div>
          </div>
          <style>{`
            @keyframes breathe-blue {
              0% { box-shadow: 0 0 0 0 rgba(37,99,235,0.06); opacity: 0.6; }
              25% { box-shadow: 0 0 18px 6px rgba(37,99,235,0.10); opacity: 0.85; }
              50% { box-shadow: 0 0 36px 12px rgba(37,99,235,0.16); opacity: 1; }
              75% { box-shadow: 0 0 18px 6px rgba(37,99,235,0.10); opacity: 0.85; }
              100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.06); opacity: 0.6; }
            }
            .animate-breathe-blue { animation: breathe-blue 6s ease-in-out infinite; }
          `}</style>
        </div>
      )}
      {/* Header/Toolbar */}
      {!isMobile ? (
        <div className="bg-card border-b border-border px-4 py-3 flex items-center justify-between flex-nowrap overflow-x-hidden whitespace-nowrap w-screen">
        <div className="flex items-center space-x-4 min-w-0 whitespace-nowrap">
          <div className="flex items-center space-x-2 min-w-0 whitespace-nowrap">
              <Cpu 
                className="h-5 w-5" 
                style={{
                  color: simulationStatus === 'running' ? '#22c55e' : '#6b7280',
                  filter: simulationStatus === 'running' ? 'drop-shadow(0 0 6px #22c55e)' : 'none',
                  transition: 'color 200ms ease-in-out, filter 200ms ease-in-out'
                }}
              />
              <h1 className="text-lg font-semibold truncate">Arduino UNO Simulator</h1>
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

          <div className="flex items-center space-x-3 min-w-0">
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
                  'md:w-64 w-auto',
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
      ) : (
        <div data-mobile-header className="bg-card border-b border-border px-4 py-3 flex items-center justify-center flex-nowrap overflow-hidden w-full relative z-10">
          <Button
            onClick={simulationStatus === 'running' ? handleStop : handleCompileAndStart}
            disabled={simulateDisabled}
            className={clsx(
              'w-64',
              '!text-white',
              'transition-colors',
              {
                '!bg-orange-600 hover:!bg-orange-700': simulationStatus === 'running' && !simulateDisabled,
                '!bg-green-600 hover:!bg-green-700': simulationStatus !== 'running' && !simulateDisabled,
                'opacity-50 cursor-not-allowed bg-gray-500 hover:!bg-gray-500': simulateDisabled,
              }
            )}
            data-testid="button-simulate-toggle-mobile"
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
      )}
      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative z-0">
        {!isMobile ? (
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
                <div className="h-full flex flex-col">
                  {/* Static Serial Header (always full width) */}
                  <div className="bg-muted px-4 border-b border-border flex items-center h-10">
                    <div className="flex items-center w-full min-w-0 overflow-hidden whitespace-nowrap">
                      <div className="flex items-center space-x-2 flex-shrink-0">
                        <div
                          className={`w-2 h-2 rounded-full ${simulationStatus === 'running' ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`}
                          style={{
                            boxShadow: simulationStatus === 'running' ? '0 0 8px rgba(34, 197, 94, 0.8)' : 'none',
                            transition: 'box-shadow 200ms ease-in-out'
                          }}
                          data-testid="connection-indicator"
                        />
                        <i className="fas fa-comments text-accent text-sm"></i>
                        <span className="text-sm font-medium truncate">Serial Output</span>
                        <span className="text-xs text-muted-foreground hidden sm:inline ml-3">115200 baud</span>
                      </div>
                      <div className="flex items-center space-x-3 ml-auto">
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-w-[9rem] text-xs"
                          onClick={cycleSerialViewMode}
                          data-testid="button-serial-view-toggle"
                        >
                          {serialViewMode === 'monitor'
                            ? 'Monitor only'
                            : serialViewMode === 'plotter'
                              ? 'Plotter only'
                              : 'Monitor + Plotter'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setAutoScrollEnabled(!autoScrollEnabled)}
                          disabled={serialViewMode === 'plotter'}
                          title={autoScrollEnabled ? 'Autoscroll on' : 'Autoscroll off'}
                          data-testid="button-autoscroll"
                        >
                          <ChevronsDown className={`h-4 w-4 ${autoScrollEnabled ? 'text-accent' : 'text-muted-foreground'}`} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleClearSerialOutput} data-testid="button-clear-serial">
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 min-h-0">
                    {/* Serial area: SerialMonitor renders output area and parent renders static header above */}
                    {showSerialMonitor && showSerialPlotter ? (
                      <div className="h-full flex">
                        <div className="w-1/2 border-r border-border">
                          <SerialMonitor
                            output={serialOutput}
                            isConnected={isConnected}
                            isSimulationRunning={simulationStatus === 'running'}
                            onSendMessage={handleSerialSend}
                            onClear={handleClearSerialOutput}
                            showMonitor={showSerialMonitor}
                            autoScrollEnabled={autoScrollEnabled}
                          />
                        </div>
                        <div className="w-1/2">
                          <SerialPlotter output={serialOutput} />
                        </div>
                      </div>
                    ) : showSerialMonitor ? (
                      <SerialMonitor
                        output={serialOutput}
                        isConnected={isConnected}
                        isSimulationRunning={simulationStatus === 'running'}
                        onSendMessage={handleSerialSend}
                        onClear={handleClearSerialOutput}
                        showMonitor={showSerialMonitor}
                        autoScrollEnabled={autoScrollEnabled}
                      />
                    ) : (
                      <div className="h-full">
                        <SerialPlotter output={serialOutput} />
                      </div>
                    )}
                  </div>

                  {/* Input area is rendered in the parent so it spans the whole serial frame */}
                  <div className="p-3 flex-shrink-0 bg-card border-t border-border">
                    <div className="flex space-x-2 items-center">
                      <Input
                        type="text"
                        placeholder="Send to Arduino..."
                        value={serialInputValue}
                        onChange={(e) => setSerialInputValue(e.target.value)}
                        onKeyDown={handleSerialInputKeyDown}
                        className="flex-1 bg-input border-border text-foreground placeholder-muted-foreground h-9"
                        data-testid="input-serial"
                      />

                      <Button
                        type="button"
                        onClick={handleSerialInputSend}
                        size="sm"
                        disabled={!serialInputValue.trim() || simulationStatus !== 'running'}
                        className={`w-40 h-9 ${!serialInputValue.trim() || simulationStatus !== 'running' ? '' : '!bg-green-600 hover:!bg-green-700 !text-white'}`}
                        data-testid="button-send-serial"
                      >
                        <Zap className="h-3 w-3 mr-1" />
                        Send
                      </Button>
                    </div>
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle data-testid="vertical-resizer-board" />

              <ResizablePanel defaultSize={50} minSize={15} id="board-panel">
                <ArduinoBoard
                  pinStates={pinStates}
                  isSimulationRunning={simulationStatus === 'running'}
                  txActive={txActivity}
                  rxActive={rxActivity}
                  onReset={handleReset}
                  onPinToggle={handlePinToggle}
                  analogPins={analogPinsUsed}
                  onAnalogChange={handleAnalogChange}
                />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="h-full relative">
            {/* Render tab bar in a portal so it's fixed to the viewport regardless of ancestor transforms */}
            {isClient && createPortal(
              <div className="fixed inset-0 pointer-events-none" style={{ zIndex: overlayZ }}>
                <div className="absolute inset-0 flex items-end justify-end p-8" style={{ paddingBottom: 'env(safe-area-inset-bottom, 32px)', paddingRight: 'env(safe-area-inset-right, 32px)' }}>
                    <div className="pointer-events-auto sticky mr-4 mb-4" style={{ alignSelf: 'flex-end' }}>
                      <div className="bg-black/95 rounded-full shadow-lg p-1 flex flex-col items-center space-y-2">
                  <button
                    aria-label="Code Editor"
                    onClick={() => setMobilePanel(mobilePanel === 'code' ? null : 'code')}
                    className={clsx('w-10 h-10 flex items-center justify-center rounded-full transition', mobilePanel === 'code' ? 'bg-blue-600 text-white' : 'bg-transparent text-muted-foreground')}
                  >
                    <Cpu className="w-5 h-5" />
                  </button>
                  <button
                    aria-label="Compilation Output"
                    onClick={() => setMobilePanel(mobilePanel === 'compile' ? null : 'compile')}
                    className={clsx('w-10 h-10 flex items-center justify-center rounded-full transition', mobilePanel === 'compile' ? 'bg-green-600 text-white' : 'bg-transparent text-muted-foreground')}
                  >
                    <Wrench className="w-5 h-5" />
                  </button>
                  <button
                    aria-label="Serial Output"
                    onClick={() => setMobilePanel(mobilePanel === 'serial' ? null : 'serial')}
                    className={clsx('w-10 h-10 flex items-center justify-center rounded-full transition', mobilePanel === 'serial' ? 'bg-amber-600 text-white' : 'bg-transparent text-muted-foreground')}
                  >
                    <Terminal className="w-5 h-5" />
                  </button>
                  <button
                    aria-label="Arduino Board"
                    onClick={() => setMobilePanel(mobilePanel === 'board' ? null : 'board')}
                    className={clsx('w-10 h-10 flex items-center justify-center rounded-full transition', mobilePanel === 'board' ? 'bg-sky-600 text-white' : 'bg-transparent text-muted-foreground')}
                  >
                    <Square className="w-5 h-5" />
                  </button>
                    </div>
                  </div>
                </div>
              </div>, document.body)

            }

            {mobilePanel && (
              <div className="fixed left-0 right-0 bottom-0 bg-card p-0 flex flex-col w-screen" style={{ top: `${headerHeight}px`, height: `calc(100vh - ${headerHeight}px)`, zIndex: overlayZ }}>
                <div className="flex-1 overflow-auto w-screen h-full">
                  {mobilePanel === 'code' && (
                    <div className="h-full flex flex-col w-full">
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
                      <div className="flex-1 min-h-0 w-full">
                        <CodeEditor value={code} onChange={handleCodeChange} onCompileAndRun={handleCompileAndStart} onFormat={formatCode} editorRef={editorRef} />
                      </div>
                    </div>
                  )}
                  {mobilePanel === 'compile' && (
                    <div className="h-full w-full">
                      <CompilationOutput
                        output={cliOutput}
                        onClear={handleClearCompilationOutput}
                      />
                    </div>
                  )}
                  {mobilePanel === 'serial' && (
                    <div className="h-full w-full">
                      <SerialMonitor
                        output={serialOutput}
                        isConnected={isConnected}
                        isSimulationRunning={simulationStatus === 'running'}
                        onSendMessage={handleSerialSend}
                        onClear={handleClearSerialOutput}
                        showMonitor={showSerialMonitor}
                        autoScrollEnabled={autoScrollEnabled}
                      />
                    </div>
                  )}
                  {mobilePanel === 'board' && (
                    <div className="h-full w-full">
                      <ArduinoBoard
                        pinStates={pinStates}
                        isSimulationRunning={simulationStatus === 'running'}
                        txActive={txActivity}
                        rxActive={rxActivity}
                        onReset={handleReset}
                        onPinToggle={handlePinToggle}
                        analogPins={analogPinsUsed}
                        onAnalogChange={handleAnalogChange}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}