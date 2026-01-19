import { render, waitFor } from '@testing-library/react';
import { ArduinoBoard } from '@/components/features/arduino-board';

describe('ArduinoBoard - Pin Frame Visibility', () => {
  let mockSvgContent: string;
  let mockOverlaySvgContent: string;

  beforeEach(() => {
    // Mock SVG content with frame elements for pins 0-13 and A0-A5
    mockSvgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 285.2 209">
        <g id="board-background">
          <rect width="285.2" height="209" fill="#0f7391" />
        </g>
      </svg>
    `;

    mockOverlaySvgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 285.2 209">
        <!-- Digital pins 0-13 -->
        ${Array.from({ length: 14 }, (_, i) => `
          <rect id="pin-${i}-frame" x="${10 + i * 15}" y="10" width="12" height="12" fill="none" stroke="#ffff00" stroke-width="2" display="none" />
          <circle id="pin-${i}-state" cx="${16 + i * 15}" cy="16" r="4" fill="#000000" />
          <rect id="pin-${i}-click" x="${10 + i * 15}" y="10" width="12" height="12" fill="transparent" />
        `).join('')}
        
        <!-- Analog pins A0-A5 -->
        ${Array.from({ length: 6 }, (_, i) => `
          <rect id="pin-A${i}-frame" x="${10 + i * 15}" y="50" width="12" height="12" fill="none" stroke="#ffff00" stroke-width="2" display="none" />
          <circle id="pin-A${i}-state" cx="${16 + i * 15}" cy="56" r="4" fill="#000000" />
          <rect id="pin-A${i}-click" x="${10 + i * 15}" y="50" width="12" height="12" fill="transparent" />
        `).join('')}
        
        <!-- LEDs -->
        <rect id="led-on" x="100" y="100" width="4" height="4" fill="transparent" />
        <rect id="led-l" x="110" y="100" width="4" height="4" fill="transparent" />
        <rect id="led-tx" x="120" y="100" width="4" height="4" fill="transparent" />
        <rect id="led-rx" x="130" y="100" width="4" height="4" fill="transparent" />
        
        <!-- Glow filters -->
        <defs>
          <filter id="glow-green">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <filter id="glow-yellow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
      </svg>
    `;

    // Mock fetch to return our SVG content
    global.fetch = jest.fn((url) => {
      if (url === '/ArduinoUno.svg') {
        return Promise.resolve({
          text: () => Promise.resolve(mockSvgContent),
        } as Response);
      }
      if (url === '/ArduinoUno-overlay.svg') {
        return Promise.resolve({
          text: () => Promise.resolve(mockOverlaySvgContent),
        } as Response);
      }
      return Promise.reject(new Error('Not found'));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should display yellow frame for pin 0 when configured as INPUT', async () => {
    const pinStates = [
      { pin: 0, mode: 'INPUT' as const, value: 0, type: 'digital' as const },
    ];

    render(
      <ArduinoBoard
        pinStates={pinStates}
        isSimulationRunning={true}
      />
    );

    // Wait for SVG to load and frame to become visible
    await waitFor(() => {
      const frame = document.querySelector('#pin-0-frame') as SVGRectElement;
      expect(frame).toBeTruthy();
      expect(frame.style.display).toBe('block');
    }, { timeout: 2000 });

    // Verify frame has glow effect
    const frame = document.querySelector('#pin-0-frame') as SVGRectElement;
    expect(frame.style.filter).toContain('drop-shadow');
  });

  it('should display yellow frames for pins 0-6 when all configured as INPUT', async () => {
    const pinStates = Array.from({ length: 7 }, (_, i) => ({
      pin: i,
      mode: 'INPUT' as const,
      value: 0,
      type: 'digital' as const,
    }));

    render(
      <ArduinoBoard
        pinStates={pinStates}
        isSimulationRunning={true}
      />
    );

    // Wait for all frames to become visible
    await waitFor(() => {
      for (let pin = 0; pin < 7; pin++) {
        const frame = document.querySelector(`#pin-${pin}-frame`) as SVGRectElement;
        expect(frame, `pin ${pin} frame should exist`).toBeTruthy();
        expect(frame.style.display, `pin ${pin} frame should be visible`).toBe('block');
      }
    }, { timeout: 2000 });
  });

  it('should NOT display frame for pin 0 when configured as OUTPUT', async () => {
    const pinStates = [
      { pin: 0, mode: 'OUTPUT' as const, value: 1, type: 'digital' as const },
    ];

    render(
      <ArduinoBoard
        pinStates={pinStates}
        isSimulationRunning={true}
      />
    );

    // Wait for SVG to load
    await waitFor(() => {
      const frame = document.querySelector('#pin-0-frame') as SVGRectElement;
      expect(frame).toBeTruthy();
    }, { timeout: 2000 });

    // Verify frame is hidden for OUTPUT mode
    const frame = document.querySelector('#pin-0-frame') as SVGRectElement;
    expect(frame.style.display).toBe('none');
  });

  it('should display frame for analog pin A0 when configured as INPUT', async () => {
    const pinStates = [
      { pin: 14, mode: 'INPUT' as const, value: 0, type: 'analog' as const },
    ];

    render(
      <ArduinoBoard
        pinStates={pinStates}
        isSimulationRunning={true}
        analogPins={[14]}
      />
    );

    // Wait for frame to become visible
    await waitFor(() => {
      const frame = document.querySelector('#pin-A0-frame') as SVGRectElement;
      expect(frame).toBeTruthy();
      expect(frame.style.display).toBe('block');
    }, { timeout: 2000 });

    // Verify frame has glow effect
    const frame = document.querySelector('#pin-A0-frame') as SVGRectElement;
    expect(frame.style.filter).toContain('drop-shadow');
  });
});
