import { useEffect, useState, useRef, useCallback } from 'react';
import { Cpu, Eye, EyeOff } from 'lucide-react';

interface PinState {
  pin: number;
  mode: 'INPUT' | 'OUTPUT' | 'INPUT_PULLUP';
  value: number; // 0-255 for analog, 0 or 1 for digital
  type: 'digital' | 'analog' | 'pwm';
}

interface ArduinoBoardProps {
  pinStates?: PinState[];
  isSimulationRunning?: boolean;
  txActive?: number; // TX activity counter (changes trigger blink)
  rxActive?: number; // RX activity counter (changes trigger blink)
  onReset?: () => void; // Callback when reset button is clicked
  onPinToggle?: (pin: number, newValue: number) => void; // Callback when an INPUT pin is clicked
}

// SVG viewBox dimensions (from ArduinoUno.svg)
const VIEWBOX_WIDTH = 285.2;
const VIEWBOX_HEIGHT = 209;
const SAFE_MARGIN = 4; // px gap to window edges

// PWM-capable pins on Arduino UNO
const PWM_PINS = [3, 5, 6, 9, 10, 11];

export function ArduinoBoard({
  pinStates = [],
  isSimulationRunning = false,
  txActive = 0,
  rxActive = 0,
  onReset,
  onPinToggle,
}: ArduinoBoardProps) {
  const [svgContent, setSvgContent] = useState<string>('');
  const [overlaySvgContent, setOverlaySvgContent] = useState<string>('');
  const [txBlink, setTxBlink] = useState(false);
  const [rxBlink, setRxBlink] = useState(false);
  const [showPWMValues, setShowPWMValues] = useState(false);
  const txTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rxTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [scale, setScale] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Handle TX blink (stays on for 100ms after activity)
  useEffect(() => {
    if (txActive > 0) {
      setTxBlink(true);
      if (txTimeoutRef.current) clearTimeout(txTimeoutRef.current);
      txTimeoutRef.current = setTimeout(() => setTxBlink(false), 100);
    }
  }, [txActive]);

  // Handle RX blink (stays on for 100ms after activity)
  useEffect(() => {
    if (rxActive > 0) {
      setRxBlink(true);
      if (rxTimeoutRef.current) clearTimeout(rxTimeoutRef.current);
      rxTimeoutRef.current = setTimeout(() => setRxBlink(false), 100);
    }
  }, [rxActive]);

  // Load both SVGs once
  useEffect(() => {
    Promise.all([
      fetch('/ArduinoUno.svg').then(r => r.text()),
      fetch('/ArduinoUno-overlay.svg').then(r => r.text())
    ])
      .then(([main, overlay]) => {
        setSvgContent(main);
        setOverlaySvgContent(overlay);
      })
      .catch(err => console.error('Failed to load Arduino SVGs:', err));
  }, []);

  // Get pin color based on state
  const getPinColor = useCallback((pin: number): string => {
    const state = pinStates.find(p => p.pin === pin);
    if (!state) return 'transparent';
    
    if (state.type === 'pwm' && PWM_PINS.includes(pin)) {
      const intensity = Math.round((state.value / 255) * 255);
      return `rgb(${intensity}, 0, 0)`;
    } else if (state.value > 0) {
      return '#ff0000';
    } else {
      return '#000000';
    }
  }, [pinStates]);

  // Check if pin is INPUT
  const isPinInput = useCallback((pin: number): boolean => {
    const state = pinStates.find(p => p.pin === pin);
    return state !== undefined && (state.mode === 'INPUT' || state.mode === 'INPUT_PULLUP');
  }, [pinStates]);

  // Update overlay SVG elements based on current state
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !overlaySvgContent) return;
    
    // Wait for next frame to ensure SVG is parsed and in DOM
    const rafId = requestAnimationFrame(() => {
      const svgEl = overlay.querySelector('svg');
      if (!svgEl) return;

      // Update digital pins 0-13
      for (let pin = 0; pin <= 13; pin++) {
        const frame = svgEl.querySelector<SVGRectElement>(`#pin-${pin}-frame`);
        const state = svgEl.querySelector<SVGCircleElement>(`#pin-${pin}-state`);
        const click = svgEl.querySelector<SVGRectElement>(`#pin-${pin}-click`);
        
        const isInput = isPinInput(pin);
        const color = getPinColor(pin);
        
        // Yellow frame for INPUT pins (show/hide via display)
        if (frame) {
          frame.style.display = isInput ? 'block' : 'none';
          frame.style.filter = isInput ? 'drop-shadow(0 0 2px #ffff00)' : 'none';
        }
        
        // State circle fill color
        if (state) {
          if (color === 'transparent' || color === '#000000') {
            // Default/LOW state: black fill, no glow
            state.setAttribute('fill', '#000000');
            state.style.filter = 'none';
          } else {
            // Active HIGH state: red fill with glow
            state.setAttribute('fill', color);
            state.style.filter = `drop-shadow(0 0 3px ${color})`;
          }
        }
        
        // Click area only for INPUT pins
        if (click) {
          click.style.pointerEvents = isInput ? 'auto' : 'none';
          click.style.cursor = isInput ? 'pointer' : 'default';
        }
      }

      // Update analog pins A0-A5 (pins 14-19 internally, or identified as A0-A5)
      for (let i = 0; i <= 5; i++) {
        const pinId = `A${i}`;
        const pinNumber = 14 + i; // A0=14, A1=15, ..., A5=19
        
        const frame = svgEl.querySelector<SVGRectElement>(`#pin-${pinId}-frame`);
        const state = svgEl.querySelector<SVGCircleElement>(`#pin-${pinId}-state`);
        const click = svgEl.querySelector<SVGRectElement>(`#pin-${pinId}-click`);
        
        const isInput = isPinInput(pinNumber);
        const color = getPinColor(pinNumber);
        
        // Yellow frame for INPUT pins (show/hide via display)
        if (frame) {
          frame.style.display = isInput ? 'block' : 'none';
          frame.style.filter = isInput ? 'drop-shadow(0 0 2px #ffff00)' : 'none';
        }
        
        // State circle fill color
        if (state) {
          if (color === 'transparent' || color === '#000000') {
            // Default/LOW state: black fill, no glow
            state.setAttribute('fill', '#000000');
            state.style.filter = 'none';
          } else {
            // Active HIGH state: red fill with glow
            state.setAttribute('fill', color);
            state.style.filter = `drop-shadow(0 0 3px ${color})`;
          }
        }
        
        // Click area only for INPUT pins
        if (click) {
          click.style.pointerEvents = isInput ? 'auto' : 'none';
          click.style.cursor = isInput ? 'pointer' : 'default';
        }
      }

      // Update LEDs
      const ledOn = svgEl.querySelector<SVGRectElement>('#led-on');
      const ledL = svgEl.querySelector<SVGRectElement>('#led-l');
      const ledTx = svgEl.querySelector<SVGRectElement>('#led-tx');
      const ledRx = svgEl.querySelector<SVGRectElement>('#led-rx');
      
      // ON LED - green when running, black when off
      if (ledOn) {
        if (isSimulationRunning) {
          ledOn.setAttribute('fill', '#00ff00');
          ledOn.setAttribute('fill-opacity', '1');
          ledOn.style.filter = 'url(#glow-green)';
        } else {
          ledOn.setAttribute('fill', '#000000');
          ledOn.setAttribute('fill-opacity', '0.8');
          ledOn.style.filter = 'none';
        }
      }
      
      // L LED - yellow when pin 13 is HIGH, black when LOW
      const pin13State = pinStates.find(p => p.pin === 13);
      const pin13On = pin13State && pin13State.value > 0;
      if (ledL) {
        if (pin13On) {
          ledL.setAttribute('fill', '#ffff00');
          ledL.setAttribute('fill-opacity', '1');
          ledL.style.filter = 'url(#glow-yellow)';
        } else {
          ledL.setAttribute('fill', '#000000');
          ledL.setAttribute('fill-opacity', '0.8');
          ledL.style.filter = 'none';
        }
      }
      
      // TX LED - yellow when blinking, black when off
      if (ledTx) {
        if (txBlink) {
          ledTx.setAttribute('fill', '#ffff00');
          ledTx.setAttribute('fill-opacity', '1');
          ledTx.style.filter = 'url(#glow-yellow)';
        } else {
          ledTx.setAttribute('fill', '#000000');
          ledTx.setAttribute('fill-opacity', '0.8');
          ledTx.style.filter = 'none';
        }
      }
      
      // RX LED - yellow when blinking, black when off
      if (ledRx) {
        if (rxBlink) {
          ledRx.setAttribute('fill', '#ffff00');
          ledRx.setAttribute('fill-opacity', '1');
          ledRx.style.filter = 'url(#glow-yellow)';
        } else {
          ledRx.setAttribute('fill', '#000000');
          ledRx.setAttribute('fill-opacity', '0.8');
          ledRx.style.filter = 'none';
        }
      }
    });
    
    return () => cancelAnimationFrame(rafId);
  }, [pinStates, isSimulationRunning, txBlink, rxBlink, isPinInput, getPinColor, overlaySvgContent]);

  // Handle clicks on the overlay SVG
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as Element;
    
    // Check for pin click
    const pinClick = target.closest('[id^="pin-"][id$="-click"]');
    if (pinClick && onPinToggle) {
      // Match both digital pins (0-13) and analog pins (A0-A5)
      const digitalMatch = pinClick.id.match(/pin-(\d+)-click/);
      const analogMatch = pinClick.id.match(/pin-A(\d+)-click/);
      
      let pin: number | undefined;
      if (digitalMatch) {
        pin = parseInt(digitalMatch[1], 10);
      } else if (analogMatch) {
        // A0-A5 map to pins 14-19
        pin = 14 + parseInt(analogMatch[1], 10);
      }
      
      if (pin !== undefined) {
        const state = pinStates.find(p => p.pin === pin);
        if (state && (state.mode === 'INPUT' || state.mode === 'INPUT_PULLUP')) {
          const newValue = state.value > 0 ? 0 : 1;
          console.log(`[ArduinoBoard] Pin ${pin} clicked, toggling to ${newValue}`);
          onPinToggle(pin, newValue);
        }
      }
      return;
    }
    
    // Check for reset button click
    const resetClick = target.closest('#reset-click');
    if (resetClick && onReset) {
      console.log('[ArduinoBoard] Reset button clicked');
      onReset();
    }
  }, [onPinToggle, onReset, pinStates]);

  // Compute scale to fit both width and height
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !svgContent) return;
    
    const updateScale = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw > 0 && ch > 0) {
        const s = Math.min(
          (cw - SAFE_MARGIN * 2) / VIEWBOX_WIDTH,
          (ch - SAFE_MARGIN * 2) / VIEWBOX_HEIGHT
        );
        setScale(Math.max(s, 0.1));
      }
    };
    
    const timer = setTimeout(updateScale, 50);
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [svgContent]);

  // Modify main SVG (static, just styles)
  const getModifiedSvg = () => {
    if (!svgContent) return '';
    let modified = svgContent;
    modified = modified.replace(/<\?xml[^?]*\?>/g, '');
    modified = modified.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="width: 100%; height: 100%; display: block;" preserveAspectRatio="xMidYMid meet">`
    );
    return modified;
  };

  // Modify overlay SVG
  const getOverlaySvg = () => {
    if (!overlaySvgContent) return '';
    let modified = overlaySvgContent;
    modified = modified.replace(/<\?xml[^?]*\?>/g, '');
    modified = modified.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="width: 100%; height: 100%; display: block; position: absolute; top: 0; left: 0;" preserveAspectRatio="xMidYMid meet">`
    );
    return modified;
  };

  return (
    <div className="h-full flex flex-col bg-card border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between bg-muted px-3 py-2 border-b border-border">
        <div className="flex items-center space-x-2">
          <Cpu 
            className="h-4 w-4" 
            style={{
              color: isSimulationRunning ? '#22c55e' : '#6b7280',
              filter: isSimulationRunning ? 'drop-shadow(0 0 4px #22c55e)' : 'none',
              transition: 'color 200ms ease-in-out, filter 200ms ease-in-out'
            }}
          />
          <span className="text-sm font-medium">Arduino UNO Board</span>
        </div>
        <button
          onClick={() => setShowPWMValues(!showPWMValues)}
          className="flex items-center space-x-1 px-2 py-1 text-xs bg-background border border-border rounded hover:bg-accent transition-colors"
          title={showPWMValues ? 'Hide PWM Values' : 'Show PWM Values'}
        >
          {showPWMValues ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          <span>PWM</span>
        </button>
      </div>

      {/* Board Visualization */}
      <div className="flex-1 overflow-auto p-0 flex items-center justify-center bg-gray-900 min-h-0">
        {svgContent && overlaySvgContent ? (
          <div
            ref={containerRef}
            className="relative flex items-center justify-center"
            style={{ 
              filter: 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.4))',
              width: '100%',
              height: '100%',
            }}
          >
            {/* Scaled inner wrapper to fit both width and height */}
            <div
              style={{
                position: 'relative',
                width: `${VIEWBOX_WIDTH}px`,
                height: `${VIEWBOX_HEIGHT}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'center',
              }}
            >
              {/* Main SVG - static background */}
              <div 
                style={{ position: 'relative', width: '100%', height: '100%' }}
                dangerouslySetInnerHTML={{ __html: getModifiedSvg() }} 
              />
              {/* Overlay SVG - dynamic visualization and click handling */}
              <div 
                ref={overlayRef}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                onClick={handleOverlayClick}
                dangerouslySetInnerHTML={{ __html: getOverlaySvg() }} 
              />
            </div>
          </div>
        ) : (
          <div className="text-gray-500">Loading Arduino Board...</div>
        )}
      </div>
    </div>
  );
}
