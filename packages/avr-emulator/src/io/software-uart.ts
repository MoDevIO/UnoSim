import type { AVRIOPort, CPU } from "avr8js";

/**
 * `Serial` of the ATtiny85 (plan P6.3, spike P0.5): the core's
 * `TinySoftwareSerial` bit-bangs TX on a pin and receives through the analog
 * comparator. It offers the members of `AVRUSART` that `SerialPorts` uses, so
 * a board without a hardware USART gets the same serial port.
 *
 * - **TX:** edges of the TX pin while it is an output and not driven by
 *   timer 0 PWM. The baud rate is not in any register: it is the largest
 *   standard bit time of which the edge distances are whole multiples, the bit
 *   width is then refined from them (the core's delay loop runs a few percent
 *   slow). Until enough edges fix it, the configured baud rate (the Serial
 *   Monitor's) decodes the line once it is idle.
 * - **RX:** a waveform on the RX pin (AIN1) in simulated time; the comparator
 *   (ACSR) compares it with the bandgap (ACBG) or AIN0 and raises its
 *   interrupt. The receiver counts as enabled while the comparator interrupt
 *   is (after `Serial.begin()`). Half duplex: the core disables interrupts
 *   while it sends, so bits arriving then are lost, as on the chip.
 */
export interface SoftwareUartPins {
  readonly txPin: number;
  readonly rxPin: number;
}

/** Register addresses of the ATtiny85 the UART model reads (data space). */
const PINB = 0x36;
const DDRB = 0x37;
const PORTB = 0x38;
const TCCR0A = 0x4a;
const ACSR = 0x28;
/** COM0A bits: timer 0 drives PB0 (OC0A). */
const COM0A_MASK = 0xc0;
const ACD = 0x80;
const ACBG = 0x40;
const ACO = 0x20;
const ACI = 0x10;
const ACIE = 0x08;
const ACIS_MASK = 0x03;
const BANDGAP_VOLTS = 1.1;
const VCC_VOLTS = 5;

/** Standard rates, fastest last; the largest fitting bit time wins. */
const STANDARD_BAUDS = [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 115200] as const;
/** In-frame edge distances needed before the baud rate counts as found. */
const MIN_FIT_INTERVALS = 8;
/**
 * Share of them that must be whole multiples of the bit time. The pin set-up
 * makes a few short pulses and the core's delay loop stretches single bits
 * (measured at 19200 baud: 3 of 39 distances off by more than 20 %).
 */
const MIN_FIT_SHARE = 0.9;
/** Idle bits between two received bytes, after the stop bit. */
const RX_IDLE_BITS = 2;

type Edge = readonly [cycle: number, level: 0 | 1];

export class SoftwareUart {
  onByteTransmit: ((byte: number) => void) | null = null;
  onRxComplete: (() => void) | null = null;
  onConfigurationChange: (() => void) | null = null;

  readonly bitsPerChar = 8;
  readonly stopBits = 1;
  readonly parityEnabled = false;
  readonly parityOdd = false;

  /** Baud rate used until the TX line reveals the sketch's (`Serial.begin(baud)` is not visible otherwise). */
  configuredBaud = 9600;

  private detectedBaud: number | null = null;
  /** Measured cycles per TX bit once the baud rate is found. */
  private txBitCycles: number | null = null;
  private edges: Edge[] = [];
  private txLevel: 0 | 1 = 1;
  private frameStart: number | null = null;
  private idleCheck: (() => void) | null = null;
  private rxLevel: 0 | 1 = 1;
  private rxBusyValue = false;
  private rxEnabledValue = false;

  constructor(
    private readonly cpu: CPU,
    private readonly port: AVRIOPort,
    private readonly clockHz: number,
    private readonly pins: SoftwareUartPins = { txPin: 0, rxPin: 1 },
  ) {
    port.addListener(() => this.onPortChange());
    this.installComparator();
    this.setRx(1);
  }

  /** The detected baud rate of the TX line, else the configured one. */
  get baudRate(): number {
    return this.detectedBaud ?? this.configuredBaud;
  }

  get rxEnable(): boolean {
    return this.rxEnabledValue;
  }

  get rxBusy(): boolean {
    return this.rxBusyValue;
  }

  /** Sends one byte as a waveform on the RX pin; false while a byte is on the line or the receiver is off. */
  writeByte(byte: number): boolean {
    if (!this.rxEnabledValue || this.rxBusyValue) return false;
    this.rxBusyValue = true;
    const bit = this.clockHz / this.baudRate;
    const levels: Array<0 | 1> = [0, ...Array.from({ length: 8 }, (_, index) => ((byte >> index) & 1) as 0 | 1), 1];
    levels.forEach((level, index) => {
      this.cpu.addClockEvent(() => this.setRx(level), Math.max(1, Math.round(index * bit)));
    });
    this.cpu.addClockEvent(() => {
      this.rxBusyValue = false;
      this.onRxComplete?.();
    }, Math.round((levels.length + RX_IDLE_BITS) * bit));
    return true;
  }

  // ---------- TX ----------

  private onPortChange(): void {
    const { data } = this.cpu;
    const mask = 1 << this.pins.txPin;
    const timerDriven = this.pins.txPin === 0 && (data[TCCR0A] & COM0A_MASK) !== 0;
    if (!(data[DDRB] & mask) || timerDriven) return;
    const level: 0 | 1 = data[PORTB] & mask ? 1 : 0;
    if (level === this.txLevel) return;
    this.txLevel = level;
    this.onEdge([this.cpu.cycles, level]);
  }

  private onEdge(edge: Edge): void {
    this.edges.push(edge);
    if (this.txBitCycles === null) {
      this.tryDetectBaud();
      this.scheduleIdleCheck();
      return;
    }
    if (this.frameStart === null && edge[1] === 0) this.startFrame(edge[0]);
  }

  private startFrame(start: number): void {
    const bit = this.txBitCycles as number;
    this.frameStart = start;
    this.cpu.addClockEvent(() => this.finishFrame(), Math.max(1, Math.ceil(start + 9.5 * bit - this.cpu.cycles)));
  }

  private finishFrame(): void {
    if (this.frameStart === null || this.txBitCycles === null) return;
    const start = this.frameStart;
    const valid = this.isStartBit(start, this.txBitCycles);
    if (valid) this.emit(this.frameByte(start, this.txBitCycles));
    // A pulse that was no start bit ends at itself; the next falling edge may be a real one.
    const end = valid ? start + 9.5 * this.txBitCycles : start;
    this.frameStart = null;
    // Keep only the edges after this frame; a start bit among them opens the next one.
    this.edges = this.edges.filter(([cycle]) => cycle > end);
    const next = this.edges.find(([, level]) => level === 0);
    if (next) this.startFrame(next[0]);
  }

  /** Decodes every complete frame among the buffered edges with `bit` cycles per bit; keeps an open frame. */
  private decodeBuffered(bit: number, now: number): void {
    let index = 0;
    while (index < this.edges.length) {
      const [start, level] = this.edges[index];
      if (level !== 0) {
        index++;
        continue;
      }
      const end = start + 9.5 * bit;
      if (end > now) break;
      if (!this.isStartBit(start, bit)) {
        index++;
        continue;
      }
      this.emit(this.frameByte(start, bit));
      while (index < this.edges.length && this.edges[index][0] <= end) index++;
    }
    this.edges = this.edges.slice(index);
  }

  /** A start bit is still low at its middle; a shorter pulse (pin set-up) is no byte. */
  private isStartBit(start: number, bit: number): boolean {
    return this.levelAt(start + bit / 2) === 0;
  }

  private frameByte(start: number, bit: number): number {
    let byte = 0;
    for (let index = 0; index < 8; index++) byte |= this.levelAt(start + bit * (1.5 + index)) << index;
    return byte;
  }

  /** Line level at `cycle` from the buffered edges (idle high before the first). */
  private levelAt(cycle: number): 0 | 1 {
    let level: 0 | 1 = 1;
    for (const [at, value] of this.edges) {
      if (at > cycle) break;
      level = value;
    }
    return level;
  }

  private tryDetectBaud(): void {
    const intervals = this.edges.slice(1).map(([cycle], index) => cycle - this.edges[index][0]);
    for (const baud of STANDARD_BAUDS) {
      const bit = this.clockHz / baud;
      const inFrame = intervals.filter((distance) => distance < bit * 9.5);
      if (inFrame.length < MIN_FIT_INTERVALS) continue;
      const fitting = inFrame.filter((distance) => {
        const bits = Math.round(distance / bit);
        return bits >= 1 && Math.abs(distance - bits * bit) < bit * 0.2;
      });
      if (fitting.length < inFrame.length * MIN_FIT_SHARE) continue;
      const measured = fitting.reduce((sum, distance) => sum + distance / Math.round(distance / bit), 0) / fitting.length;
      this.lock(baud, measured);
      return;
    }
  }

  private lock(baud: number, bitCycles: number): void {
    this.detectedBaud = baud;
    this.txBitCycles = bitCycles;
    if (this.idleCheck) this.cpu.clearClockEvent(this.idleCheck);
    this.idleCheck = null;
    this.decodeBuffered(bitCycles, this.cpu.cycles);
    const open = this.edges.find(([, level]) => level === 0);
    if (open) this.startFrame(open[0]);
    this.onConfigurationChange?.();
  }

  /** Before the baud rate is found, an idle line is decoded with the configured one. */
  private scheduleIdleCheck(): void {
    if (this.idleCheck) this.cpu.clearClockEvent(this.idleCheck);
    const bit = this.clockHz / this.configuredBaud;
    this.idleCheck = this.cpu.addClockEvent(() => {
      this.idleCheck = null;
      if (this.txBitCycles === null) this.decodeBuffered(bit, this.cpu.cycles);
    }, Math.round(12 * bit));
  }

  private emit(byte: number): void {
    this.onByteTransmit?.(byte);
  }

  // ---------- RX: analog comparator ----------

  /** Analog comparator interrupt, vector 7. */
  private readonly comparatorInterrupt = { address: 7, flagRegister: ACSR, flagMask: ACI, enableRegister: ACSR, enableMask: ACIE };

  private comparatorOutput(): 0 | 1 {
    const { data } = this.cpu;
    const acsr = data[ACSR];
    if (acsr & ACD) return 0;
    const ain0 = data[PINB] & (1 << this.pins.txPin) ? VCC_VOLTS : 0;
    const positive = acsr & ACBG ? BANDGAP_VOLTS : ain0;
    const negative = this.rxLevel ? VCC_VOLTS : 0; // AIN1, ACME is not modelled
    return positive > negative ? 1 : 0;
  }

  private updateComparator(previous: 0 | 1): void {
    const { data } = this.cpu;
    const output = this.comparatorOutput();
    data[ACSR] = (data[ACSR] & ~ACO) | (output ? ACO : 0);
    const mode = data[ACSR] & ACIS_MASK; // 0 toggle, 2 falling, 3 rising
    const edge = output !== previous && (mode === 0 || (mode === 3 && output === 1) || (mode === 2 && output === 0));
    if (edge && !(data[ACSR] & ACD)) this.cpu.setInterruptFlag(this.comparatorInterrupt);
  }

  private installComparator(): void {
    const { cpu } = this;
    cpu.writeHooks[ACSR] = (value) => {
      const previous: 0 | 1 = cpu.data[ACSR] & ACO ? 1 : 0;
      // ACO is read-only; ACI is cleared by writing 1.
      cpu.data[ACSR] = (value & ~(ACO | ACI)) | (cpu.data[ACSR] & (ACO | ACI));
      if (value & ACI) cpu.clearInterruptByFlag(this.comparatorInterrupt, value);
      cpu.updateInterruptEnable(this.comparatorInterrupt, value);
      this.updateComparator(previous);
      const enabled = (value & ACIE) !== 0 && (value & ACD) === 0;
      if (enabled !== this.rxEnabledValue) {
        this.rxEnabledValue = enabled;
        this.onConfigurationChange?.();
      }
      return true;
    };
  }

  private setRx(level: 0 | 1): void {
    const previous = this.comparatorOutput();
    this.rxLevel = level;
    if (!(this.cpu.data[DDRB] & (1 << this.pins.rxPin))) this.port.setPin(this.pins.rxPin, level === 1);
    this.updateComparator(previous);
  }
}
