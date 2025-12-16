import { useEffect, useState, useRef } from 'react';
import { Cpu } from 'lucide-react';

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
}

// Digital pin positions in the SVG (x coordinates, y=19 for all)
// Pin 13 is at x=134.8, then each pin is +9 units apart
const DIGITAL_PIN_POSITIONS: { [key: number]: { x: number; y: number } } = {
  13: { x: 134.8, y: 19 },
  12: { x: 143.8, y: 19 },
  11: { x: 152.8, y: 19 },
  10: { x: 161.8, y: 19 },
  9: { x: 170.8, y: 19 },
  8: { x: 179.8, y: 19 },
  7: { x: 194.2, y: 19 },
  6: { x: 203.2, y: 19 },
  5: { x: 212.2, y: 19 },
  4: { x: 221.2, y: 19 },
  3: { x: 230.2, y: 19 },
  2: { x: 239.2, y: 19 },
  1: { x: 248.2, y: 19 },
  0: { x: 257.2, y: 19 },
};

export function ArduinoBoard({
  pinStates = [],
  isSimulationRunning = false,
  txActive = 0,
  rxActive = 0,
  onReset,
}: ArduinoBoardProps) {
  const [svgContent, setSvgContent] = useState<string>('');
  const [txBlink, setTxBlink] = useState(false);
  const [rxBlink, setRxBlink] = useState(false);
  const txTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rxTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  useEffect(() => {
    // Load SVG content
    fetch('/ArduinoUno.svg')
      .then(response => response.text())
      .then(text => {
        setSvgContent(text);
      })
      .catch(err => console.error('Failed to load Arduino SVG:', err));
  }, []);

  // Reference to the container div for attaching event listeners
  const containerRef = useRef<HTMLDivElement>(null);

  // Use event delegation for reset button click - this survives DOM updates from dangerouslySetInnerHTML
  useEffect(() => {
    if (!containerRef.current || !onReset) return;

    const handleContainerClick = (e: MouseEvent) => {
      // Check if clicked element or any of its parents is part of the reset button group
      let target = e.target as Element | null;
      while (target && target !== containerRef.current) {
        const id = target.id || '';
        // Check for reset button elements - the smd_157sw group is the reset button
        // Also check for IDs containing the reset button pattern
        if (id.includes('smd_157sw') || id.includes('_x30_.1.15')) {
          e.stopPropagation();
          onReset();
          return;
        }
        target = target.parentElement;
      }
    };

    containerRef.current.addEventListener('click', handleContainerClick);
    
    return () => {
      containerRef.current?.removeEventListener('click', handleContainerClick);
    };
  }, [onReset]);

  // PWM-capable pins on Arduino UNO
  const PWM_PINS = [3, 5, 6, 9, 10, 11];

  // Get the color for a digital pin based on its state
  const getPinColor = (pin: number): string => {
    const state = pinStates.find(p => p.pin === pin);
    if (!state) return 'transparent'; // No state = no overlay
    
    if (state.mode === 'OUTPUT') {
      // Check if this is a PWM pin with analog value
      if (state.type === 'pwm' && PWM_PINS.includes(pin)) {
        // PWM: interpolate between black (0) and red (255)
        const intensity = Math.round((state.value / 255) * 255);
        return `rgb(${intensity}, 0, 0)`;
      } else if (state.value > 0) {
        // HIGH (5V) = red
        return '#ff0000';
      } else {
        // LOW (0V) = black
        return '#000000';
      }
    } else if (state.mode === 'INPUT' || state.mode === 'INPUT_PULLUP') {
      // Input mode = yellow
      return '#ffff00';
    }
    return 'transparent';
  };

  // Generate SVG circles for pin state overlays
  const generatePinOverlays = (): string => {
    let overlays = '';
    
    for (const [pinStr, pos] of Object.entries(DIGITAL_PIN_POSITIONS)) {
      const pin = parseInt(pinStr);
      const color = getPinColor(pin);
      
      if (color !== 'transparent') {
        // Add a glowing circle overlay on the pin
        overlays += `
          <circle cx="${pos.x}" cy="${pos.y}" r="2.5" 
            fill="${color}" 
            fill-opacity="0.8"
            style="filter: drop-shadow(0 0 2px ${color});"
          />
        `;
      }
    }
    
    return overlays;
  };

  // Modify SVG to show LED status and pin states
  const getModifiedSvg = () => {
    if (!svgContent) return '';
    
    let modified = svgContent;
    
    // Remove XML declaration if present
    modified = modified.replace(/<\?xml[^?]*\?>/g, '');
    
    // Add width/height to SVG if not present and ensure it scales properly
    // Also inject CSS for reset button cursor
    modified = modified.replace(
      /<svg([^>]*)>/,
      `<svg$1 style="width: 100%; height: 100%; max-width: 600px;">
        <style>
          #smd_157sw, #smd_157sw * { cursor: pointer; }
          [id*="_x30_.1.15"] { cursor: pointer; }
        </style>`
    );
    
    if (isSimulationRunning) {
      // LED ON: bright green with glow effect
      modified = modified.replace(
        /<rect id="rect23418" class="st33"/g,
        '<rect id="rect23418" style="fill: #00ff00; filter: drop-shadow(0 0 3px #00ff00);"'
      );
    } else {
      // LED OFF: dark green
      modified = modified.replace(
        /<rect id="rect23418" class="st33"/g,
        '<rect id="rect23418" style="fill: #1a3d1a; fill-opacity: 0.6;"'
      );
    }
    
    // L LED (rect23416 - Pin 13 LED, yellow, at x=127.2, y=50.3)
    // This should light up when pin 13 is HIGH
    const pin13State = pinStates.find(p => p.pin === 13);
    if (pin13State && pin13State.value > 0) {
      modified = modified.replace(
        /<rect id="rect23416" class="st34"/g,
        '<rect id="rect23416" style="fill: #ffff00; filter: drop-shadow(0 0 4px #ffff00);"'
      );
    } else {
      modified = modified.replace(
        /<rect id="rect23416" class="st34"/g,
        '<rect id="rect23416" style="fill: #3d3d1a; fill-opacity: 0.6;"'
      );
    }
    
    // TX LED (led-06033 group, rect at x=126.1, y=66.9)
    // ID: _x30_.1.11.0.0.0.0.0.1.0
    if (txBlink) {
      modified = modified.replace(
        /<rect id="_x30_.1.11.0.0.0.0.0.1.0" class="st39"/g,
        '<rect id="_x30_.1.11.0.0.0.0.0.1.0" style="fill: #ffff00; filter: drop-shadow(0 0 4px #ffff00); transition: fill 50ms ease-in-out, filter 50ms ease-in-out;"'
      );
    } else {
      modified = modified.replace(
        /<rect id="_x30_.1.11.0.0.0.0.0.1.0" class="st39"/g,
        '<rect id="_x30_.1.11.0.0.0.0.0.1.0" style="fill: #3d3d1a; fill-opacity: 0.6; transition: fill 50ms ease-in-out, filter 50ms ease-in-out;"'
      );
    }
    
    // RX LED (led-06032 group, rect at x=126.1, y=75)
    // ID: _x30_.1.10.0.0.0.0.0.1.0
    if (rxBlink) {
      modified = modified.replace(
        /<rect id="_x30_.1.10.0.0.0.0.0.1.0" class="st39"/g,
        '<rect id="_x30_.1.10.0.0.0.0.0.1.0" style="fill: #ffff00; filter: drop-shadow(0 0 4px #ffff00); transition: fill 50ms ease-in-out, filter 50ms ease-in-out;"'
      );
    } else {
      modified = modified.replace(
        /<rect id="_x30_.1.10.0.0.0.0.0.1.0" class="st39"/g,
        '<rect id="_x30_.1.10.0.0.0.0.0.1.0" style="fill: #3d3d1a; fill-opacity: 0.6; transition: fill 50ms ease-in-out, filter 50ms ease-in-out;"'
      );
    }
    
    // Add pin state overlays before closing </svg> tag
    const pinOverlays = generatePinOverlays();
    if (pinOverlays) {
      modified = modified.replace('</svg>', `${pinOverlays}</svg>`);
    }
    
    return modified;
  };

  return (
    <div className="h-full flex flex-col bg-card border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between bg-muted px-3 py-2 border-b border-border">
        <div className="flex items-center space-x-2">
          <Cpu className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium">Arduino UNO Board</span>
        </div>
        <div className="flex items-center space-x-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isSimulationRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'
            }`}
          />
          <span className="text-xs text-muted-foreground">
            {isSimulationRunning ? 'Running' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Board Visualization */}
      <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gray-900 min-h-0">
        {svgContent ? (
          <div
            ref={containerRef}
            className="w-full h-full flex items-center justify-center"
            style={{ filter: 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.4))' }}
            dangerouslySetInnerHTML={{ __html: getModifiedSvg() }}
          />
        ) : (
          <div className="text-gray-500">Loading Arduino Board...</div>
        )}
      </div>
    </div>
  );
}
