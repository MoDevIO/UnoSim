// Runs one sketch in the emulation core inside a Web Worker and reports the real-time factor.
import { Emulator, buildSimulationImage, loadSimulationImage, runHeadless, systemClock } from "../../packages/avr-emulator/src/index";

interface Job { name: string; hex: string; realTimeMs: number; peakSimMs: number }

self.onmessage = (event: MessageEvent<Job>) => {
  const { name, hex, realTimeMs, peakSimMs } = event.data;
  const image = loadSimulationImage(buildSimulationImage({ board: "uno", hex }));

  const peak = runHeadless(image, { simMs: peakSimMs });

  const factors: number[] = [];
  const emulator = new Emulator(image, { clock: systemClock(), timeoutMs: realTimeMs + 5_000 });
  emulator.start();
  const startedAt = performance.now();
  const timer = setInterval(() => {
    factors.push(emulator.realTimeFactor);
    if (performance.now() - startedAt >= realTimeMs) {
      clearInterval(timer);
      const simTimeMs = emulator.simTimeMs;
      emulator.stop();
      (self as unknown as Worker).postMessage({ name, peakSpeed: peak.speed, factors, simTimeMs, wallMs: performance.now() - startedAt });
    }
  }, 500);
};
