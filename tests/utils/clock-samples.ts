/** One reading of the sketch clock: `millis()` and `micros()` taken back to back. */
export interface ClockSample {
  ms: bigint;
  us: bigint;
}

/**
 * Forward distance from `prev` to `next` on a counter of `bits` width. A regular overflow is a small step; a
 * backward jump shows up as a step close to the full counter range.
 */
export function forwardStep(prev: bigint, next: bigint, bits: number): bigint {
  const modulus = 1n << BigInt(bits);
  return (((next - prev) % modulus) + modulus) % modulus;
}

/** Reads `T:<millis>:<micros>` lines. */
export function clockSamples(lines: string[]): ClockSample[] {
  return lines.flatMap((line) => {
    const match = /^T:(\d+):(\d+)$/.exec(line);
    return match ? [{ ms: BigInt(match[1]), us: BigInt(match[2]) }] : [];
  });
}

/**
 * Fails when a reading goes backwards or advances by more than `maxStepMs` (both clocks, overflow-aware),
 * or when the steps of `millis()` and `micros()` disagree. Returns the largest step seen, in ms.
 */
export function expectSteadyClock(samples: ClockSample[], bits: number, maxStepMs: number): number {
  if (samples.length < 2) throw new Error(`Need at least two clock samples, got ${samples.length}`);
  const maxStepUs = BigInt(maxStepMs) * 1000n;
  let largest = 0n;
  for (let i = 1; i < samples.length; i++) {
    const [prev, next] = [samples[i - 1], samples[i]];
    const msStep = forwardStep(prev.ms, next.ms, bits);
    const usStep = forwardStep(prev.us, next.us, bits);
    const where = `sample ${i} of ${samples.length} (${prev.ms}/${prev.us} → ${next.ms}/${next.us})`;
    if (msStep > BigInt(maxStepMs)) throw new Error(`millis() stepped by ${describeStep(msStep, bits)} at ${where}`);
    if (usStep > maxStepUs) throw new Error(`micros() stepped by ${describeStep(usStep, bits, "µs")} at ${where}`);
    // micros() is read just before millis(), so their steps differ by at most a few ms.
    const drift = msStep - usStep / 1000n;
    if (drift > 5n || drift < -5n) throw new Error(`millis() and micros() disagree at ${where}`);
    if (msStep > largest) largest = msStep;
  }
  return Number(largest);
}

function describeStep(step: bigint, bits: number, unit = "ms"): string {
  const back = (1n << BigInt(bits)) - step;
  return back < step ? `-${back} ${unit} (backwards)` : `+${step} ${unit}`;
}
