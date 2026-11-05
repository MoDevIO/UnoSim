import { describe, expect, it } from "vitest";
import { clockSamples, expectSteadyClock, forwardStep } from "./clock-samples";

const samples = (...pairs: Array<[number | bigint, number | bigint]>) =>
  pairs.map(([ms, us]) => ({ ms: BigInt(ms), us: BigInt(us) }));

describe("clock samples", () => {
  it("measures forward steps across a regular counter overflow", () => {
    expect(forwardStep(10n, 25n, 32)).toBe(15n);
    expect(forwardStep(0xffff_fff0n, 0x10n, 32)).toBe(0x20n);
    expect(forwardStep(0xffff_ffff_ffff_fffen, 3n, 64)).toBe(5n);
    expect(forwardStep(500n, 499n, 32)).toBe(0xffff_ffffn);
  });

  it("reads only complete T:<millis>:<micros> lines", () => {
    expect(clockSamples(["T:12:12345", "noise", "T:13:", "T:14:14001"])).toEqual(samples([12, 12345], [14, 14001]));
  });

  it("accepts a steady clock and an overflow of both counters", () => {
    expect(expectSteadyClock(samples([100, 100_200], [120, 120_100], [160, 160_900]), 64, 50)).toBe(40);
    // A 32-bit micros() overflows after about 71.6 minutes while millis() goes on.
    const max32 = 0xffff_ffffn;
    expect(expectSteadyClock(samples([4_294_966, max32 - 1_500n], [4_294_968, 500], [4_294_970, 2_500]), 32, 50)).toBe(2);
    const max64 = 0xffff_ffff_ffff_ffffn;
    expect(expectSteadyClock(samples([max64 - 1n, max64 - 1_000n], [3, 3_500]), 64, 50)).toBe(5);
  });

  it("rejects the readings of the paused-time defect", () => {
    // The millis() readings were recorded in Docker mode with a 500 ms pause before the fix: the first reading
    // after the resume still contains the paused time, the next one drops back.
    const jumped = samples([169, 169_400], [223, 223_300], [833, 833_200], [343, 343_100], [398, 398_200]);
    expect(() => expectSteadyClock(jumped, 64, 300)).toThrow("millis() stepped by +610 ms at sample 2 of 5");
    expect(() => expectSteadyClock(jumped.filter((_, i) => i !== 2), 64, 300)).not.toThrow();
    const back = samples([223, 223_300], [205, 205_100]);
    expect(() => expectSteadyClock(back, 64, 300)).toThrow("millis() stepped by -18 ms (backwards)");
  });

  it("rejects micros() that steps alone or disagrees with millis()", () => {
    expect(() => expectSteadyClock(samples([100, 100_000], [120, 900_000]), 64, 300)).toThrow("micros() stepped by +800000 µs");
    expect(() => expectSteadyClock(samples([100, 100_000], [120, 20_000]), 64, 300)).toThrow("micros() stepped by -80000 µs (backwards)");
    expect(() => expectSteadyClock(samples([100, 100_000], [130, 120_000]), 64, 300)).toThrow("disagree at sample 1");
  });

  it("needs two samples", () => {
    expect(() => expectSteadyClock(samples([1, 1000]), 64, 300)).toThrow("at least two clock samples");
  });
});
