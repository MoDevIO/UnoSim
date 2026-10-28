import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CPU, PinState, avrInstruction } from "avr8js";
import { describe, expect, it } from "vitest";
import { ATTINY85, avr8jsSramParameter, buildSimulationImage, erasedEeprom, loadSimulationImage, ramEnd } from "../src/index";
import type { McuPeripherals } from "../src/index";

const CLOCK_HZ = 8_000_000;
const GIFR = 0x5a;
const GIMSK = 0x5b;
const PCMSK = 0x35;
const MCUCR = 0x55;

interface Tiny {
  readonly cpu: CPU;
  readonly peripherals: McuPeripherals;
  readonly eeprom: Uint8Array;
}

/** A CPU with the ATtiny85 profile, loaded with a fixture or empty. */
function tiny(fixture?: string): Tiny {
  const progMem = fixture
    ? loadSimulationImage(buildSimulationImage({ board: "attiny85", hex: readFileSync(join(__dirname, "fixtures", `attiny85-${fixture}.hex`), "utf8") })).progMem
    : new Uint16Array(ATTINY85.flashBytes / 2);
  const cpu = new CPU(progMem, avr8jsSramParameter(ATTINY85.memory));
  const eeprom = erasedEeprom(ATTINY85.eepromBytes);
  return { cpu, peripherals: ATTINY85.createPeripherals(cpu, CLOCK_HZ, eeprom), eeprom };
}

function run({ cpu }: Tiny, ms: number, until?: () => boolean): void {
  const end = cpu.cycles + (ms * CLOCK_HZ) / 1000;
  while (cpu.cycles < end && !until?.()) {
    for (let i = 0; i < 200; i++) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }
}

const word = (eeprom: Uint8Array, address: number) => eeprom[address] | (eeprom[address + 1] << 8);

/** Share of samples in which `pin` of port B is high, over `periods` timer periods of 256 timer counts at prescaler 64. */
function highShare({ cpu, peripherals }: Tiny, pin: number, periods = 20): number {
  const port = peripherals.ports.get("B");
  const step = 64;
  const end = cpu.cycles + periods * 256 * 64;
  let high = 0;
  let samples = 0;
  let next = cpu.cycles;
  while (cpu.cycles < end) {
    avrInstruction(cpu);
    cpu.tick();
    if (cpu.cycles >= next) {
      samples++;
      if (port?.pinState(pin) === PinState.High) high++;
      next += step;
    }
  }
  return high / samples;
}

describe("ATtiny85 profile (plan P6.2)", () => {
  it("has 8 KiB flash, 512 bytes SRAM from 0x60 (RAMEND 0x25F) and 512 bytes EEPROM", () => {
    const { cpu } = tiny();
    expect(ATTINY85.flashBytes).toBe(8192);
    expect(ramEnd(ATTINY85.memory)).toBe(0x25f);
    expect(cpu.data).toHaveLength(0x260);
    expect(cpu.SP).toBe(0x25f);
    expect(ATTINY85.eepromBytes).toBe(512);
  });

  it("has one port, timers 0 and 1, no hardware USART", () => {
    const { peripherals } = tiny();
    expect([...peripherals.ports.keys()]).toEqual(["B"]);
    expect(peripherals.timers).toHaveLength(2);
    expect(peripherals.usarts).toEqual([]);
  });

  describe("tiny_probe (ATTinyCore 1.5.2, 8 MHz)", () => {
    const probe = tiny("tiny_probe");
    probe.peripherals.adc.channelValues[1] = 2.5; // A1 = PB2
    probe.peripherals.adc.channelValues[3] = 0.5; // A3 = PB3
    run(probe, 1500, () => probe.eeprom[12] === 0xa5);
    run(probe, 5); // the two analogWrite calls after the marker

    it("runs setup to the end", () => {
      expect(probe.eeprom[12]).toBe(0xa5);
    });

    it("starts with SP at RAMEND and sees RAMEND 0x25F", () => {
      expect(word(probe.eeprom, 10)).toBe(0x25f);
      // setup() runs two return addresses below RAMEND (main, then setup's frame).
      expect(word(probe.eeprom, 0)).toBeLessThan(0x25f);
      expect(word(probe.eeprom, 0)).toBeGreaterThan(0x240);
    });

    it("times delay(587) with timer 0 at 8 MHz like the core (585–589 ms)", () => {
      // millis() advances only on the timer 0 overflow, every 2.048 ms at prescaler 64, so
      // each reading lags by up to 2.048 ms: the difference is the elapsed ≥ 587 ms ± 2.048 ms.
      expect(word(probe.eeprom, 2)).toBeGreaterThanOrEqual(585);
      expect(word(probe.eeprom, 2)).toBeLessThanOrEqual(589);
    });

    it("reads the ADC against VCC, 1.1 V and 2.56 V (REFS2 at bit 4)", () => {
      expect(word(probe.eeprom, 4)).toBe(Math.floor((2.5 / 5) * 1024)); // 512
      expect(word(probe.eeprom, 6)).toBe(Math.floor((0.5 / 1.1) * 1024)); // 465
      expect(word(probe.eeprom, 8)).toBe(Math.floor((0.5 / 2.56) * 1024)); // 200; avr8js alone gives 102
    });

    it("sets up PWM on PB4 with timer 1 (OCR1B, OCR1C as TOP, PWM1B, COM1B clear on match)", () => {
      const { data } = probe.cpu;
      expect(data[0x4b]).toBe(200); // OCR1B
      expect(data[0x4d]).toBe(255); // OCR1C = TOP
      expect(data[0x4c] & 0x70).toBe(0x60); // GTCCR: PWM1B, COM1B1:0 = 10
    });

    it("drives the timer 1 waveform on PB4: high from 0 to OCR1B, period OCR1C + 1 (avr8js alone: none)", () => {
      expect(highShare(probe, 4)).toBeCloseTo(200 / 256, 1);
    });

    it("drives fast PWM on PB0 with timer 0", () => {
      expect(probe.cpu.data[0x49]).toBe(77); // OCR0A
      expect(highShare(probe, 0)).toBeCloseTo(78 / 256, 1);
    });
  });

  describe("interrupts on the shared registers GIMSK and GIFR", () => {
    it("counts INT0 rising edges on PB2 and pin changes on PB3", () => {
      const probe = tiny("tiny_interrupts");
      const port = probe.peripherals.ports.get("B");
      run(probe, 20);
      for (let i = 0; i < 3; i++) {
        port?.setPin(2, true);
        run(probe, 5);
        port?.setPin(2, false);
        run(probe, 5);
      }
      for (let i = 0; i < 2; i++) {
        port?.setPin(3, true);
        run(probe, 5);
        port?.setPin(3, false);
        run(probe, 5);
      }
      run(probe, 20);
      expect(probe.eeprom[0]).toBe(3); // rising edges only
      expect(probe.eeprom[1]).toBe(4); // every change
    });

    it("enables a pending pin-change interrupt when GIMSK is written", () => {
      const { cpu, peripherals } = tiny();
      cpu.writeData(PCMSK, 1 << 3);
      peripherals.ports.get("B")?.setPin(3, true);
      expect(cpu.data[GIFR] & (1 << 5)).toBeTruthy(); // PCIF set while PCIE is off
      expect(cpu.nextInterrupt).toBe(-1);

      cpu.writeData(GIMSK, 1 << 5);
      expect(cpu.nextInterrupt).toBe(2); // PCINT0 vector
    });

    it("clears a pending INT0 when 1 is written to INTF0 in GIFR", () => {
      const { cpu, peripherals } = tiny();
      cpu.writeData(MCUCR, 0x03); // rising edge
      cpu.writeData(GIMSK, 1 << 6);
      peripherals.ports.get("B")?.setPin(2, true);
      expect(cpu.data[GIFR] & (1 << 6)).toBeTruthy();
      expect(cpu.nextInterrupt).toBe(1); // INT0 vector

      cpu.writeData(GIFR, 1 << 6);
      expect(cpu.data[GIFR] & (1 << 6)).toBe(0);
      expect(cpu.nextInterrupt).toBe(-1);
    });
  });

  describe("timer 1 PWM (datasheet: Timer/Counter1 in PWM Mode; avr8js counts phase-correct and drives no pin with CTC1)", () => {
    const TCCR1 = 0x50;
    const GTCCR = 0x4c;
    const OCR1A = 0x4e;
    const OCR1B = 0x4b;
    const OCR1C = 0x4d;
    const TIFR = 0x58;
    const DDRB = 0x37;

    /** Level of `pin` after each of the next `cycles` CPU cycles, as 0/1 string, timer 1 at prescaler 1. */
    function levels({ cpu, peripherals }: Tiny, pin: number, cycles: number): string {
      const port = peripherals.ports.get("B");
      let out = "";
      for (let i = 0; i < cycles; i++) {
        cpu.cycles++;
        cpu.tick();
        out += port?.pinState(pin) === PinState.High ? "1" : "0";
      }
      return out;
    }

    function pwmTiny(setup: (cpu: CPU) => void): Tiny {
      const probe = tiny();
      probe.cpu.writeData(DDRB, (1 << 1) | (1 << 4));
      probe.cpu.writeData(OCR1C, 9); // period 10 counts
      setup(probe.cpu);
      levels(probe, 1, 25); // settle into the first periods
      return probe;
    }

    it("sets OC1A at 0 and clears it on OCR1A, period OCR1C + 1, with CTC1 as ATTinyCore sets it", () => {
      const probe = pwmTiny((cpu) => {
        cpu.writeData(OCR1A, 3);
        cpu.writeData(TCCR1, 0x80 | 0x40 | 0x20 | 0x01); // CTC1, PWM1A, COM1A = 10, CK/1
      });
      const wave = levels(probe, 1, 40);
      expect(wave.match(/1+/g)?.slice(0, 3).map((run) => run.length)).toEqual([3, 3, 3]);
      expect(wave.match(/0+/g)?.slice(1, 3).map((run) => run.length)).toEqual([7, 7]);
    });

    it("counts the same sawtooth without CTC1 (not phase-correct)", () => {
      const probe = pwmTiny((cpu) => {
        cpu.writeData(OCR1A, 3);
        cpu.writeData(TCCR1, 0x40 | 0x20 | 0x01); // PWM1A, COM1A = 10, CK/1
      });
      expect(levels(probe, 1, 40).match(/1+/g)?.slice(0, 3).map((run) => run.length)).toEqual([3, 3, 3]);
    });

    it("inverts OC1B with COM1B = 11 and sets TOV1 at the wrap to 0", () => {
      const probe = pwmTiny((cpu) => {
        cpu.writeData(OCR1B, 3);
        cpu.writeData(GTCCR, 0x40 | 0x30); // PWM1B, COM1B = 11
        cpu.writeData(TCCR1, 0x01); // CK/1
      });
      expect(levels(probe, 4, 40).match(/1+/g)?.slice(1, 3).map((run) => run.length)).toEqual([7, 7]);
      expect(probe.cpu.data[TIFR] & (1 << 2)).toBeTruthy(); // TOV1
    });
  });

  it("resets on a 15 ms watchdog timeout and reports it in MCUSR", () => {
    const probe = tiny("tiny_watchdog");
    run(probe, 100);
    expect(probe.eeprom[0]).toBeGreaterThanOrEqual(4); // first boot plus resets every ~16 ms
    expect(probe.eeprom[1] & 0x08).toBe(0x08); // WDRF
  });

  it("takes about 3.6 ms for an EEPROM write at 8 MHz (erase and write 1.8 ms each)", () => {
    const { cpu, eeprom } = tiny();
    cpu.writeData(0x3e, 7); // EEARL
    cpu.writeData(0x3d, 0x42); // EEDR
    cpu.writeData(0x3c, 0x04); // EEMPE
    cpu.writeData(0x3c, 0x06); // EEMPE | EEPE
    expect(eeprom[7]).toBe(0x42);
    expect(cpu.data[0x3c] & 0x02).toBeTruthy(); // busy
    const done = cpu.cycles + 2 * 14_400;
    while (cpu.cycles < done + 10) {
      cpu.cycles++;
      cpu.tick();
    }
    expect(cpu.data[0x3c] & 0x02).toBe(0);
  });
});
