/** Registers of one timer of the ATmega kind, as far as PWM observation needs them. */
export interface AvrTimerRegisters {
  readonly bits: 8 | 16;
  readonly TCCRA: number;
  readonly TCCRB: number;
  readonly OCRA: number;
  readonly OCRB: number;
  /** 0 if the timer has no channel C. */
  readonly OCRC: number;
  /** 0 if the timer has no input capture register. */
  readonly ICR: number;
}

/**
 * Timer 1 of the ATtiny85: PWM1A and COM1A in TCCR1, PWM1B and COM1B in GTCCR,
 * counting from 0 to OCR1C (datasheet 12.2).
 */
export interface AttinyTimer1Registers {
  readonly kind: "attiny-timer1";
  readonly TCCR1: number;
  readonly GTCCR: number;
  readonly OCR1A: number;
  readonly OCR1B: number;
  readonly OCR1C: number;
}

export type TimerRegisters = AvrTimerRegisters | AttinyTimer1Registers;

const isAttinyTimer1 = (timer: TimerRegisters): timer is AttinyTimer1Registers => "kind" in timer;

export type PwmChannel = "A" | "B" | "C";

const COM_SHIFT: Readonly<Record<PwmChannel, number>> = { A: 6, B: 4, C: 2 };

/**
 * Where a channel's compare-output mode and compare value live: `control` holds
 * the COM bits with the upper one at `comHighBit`, `ocr` the compare value.
 */
export function pwmChannelRegisters(timer: TimerRegisters, channel: PwmChannel): { control: number; comHighBit: number; ocr: number } {
  if (isAttinyTimer1(timer)) {
    return channel === "B"
      ? { control: timer.GTCCR, comHighBit: 5, ocr: timer.OCR1B }
      : { control: timer.TCCR1, comHighBit: 5, ocr: timer.OCR1A };
  }
  return { control: timer.TCCRA, comHighBit: { A: 7, B: 5, C: 3 }[channel], ocr: { A: timer.OCRA, B: timer.OCRB, C: timer.OCRC }[channel] };
}

/** All data-space addresses whose writes can change a duty cycle of this timer. */
export function pwmRegisterAddresses(timer: TimerRegisters): number[] {
  if (isAttinyTimer1(timer)) return [timer.TCCR1, timer.GTCCR, timer.OCR1A, timer.OCR1B, timer.OCR1C];
  const wide = (address: number) => (timer.bits === 16 ? [address, address + 1] : [address]);
  return [timer.TCCRA, timer.TCCRB, ...[timer.OCRA, timer.OCRB, timer.OCRC, timer.ICR].filter((a) => a !== 0).flatMap(wide)];
}

/**
 * Duty cycle 0–255 of a timer channel from compare-output mode, waveform and
 * compare register, or undefined when the channel does not drive its pin
 * with PWM (normal or CTC mode, output disconnected). No waveform is modelled.
 */
export function pwmDuty(data: Uint8Array, timer: TimerRegisters, channel: PwmChannel): number | undefined {
  if (isAttinyTimer1(timer)) return attinyTimer1Duty(data, timer, channel);
  const com = (data[timer.TCCRA] >> COM_SHIFT[channel]) & 3;
  if (com < 2) return undefined; // disconnected (toggle mode carries no duty cycle)
  const ocrAddress = { A: timer.OCRA, B: timer.OCRB, C: timer.OCRC }[channel];
  if (ocrAddress === 0) return undefined;
  const top = pwmTop(data, timer);
  if (top === undefined || top === 0) return undefined;
  const ocr = read(data, ocrAddress, timer.bits);
  const duty = Math.round((Math.min(ocr, top) * 255) / top);
  return com === 3 ? 255 - duty : duty;
}

/** PWM1x selects PWM for the channel; OCR1C is TOP; COM 10 clears on match, 11 sets (inverted). */
function attinyTimer1Duty(data: Uint8Array, timer: AttinyTimer1Registers, channel: PwmChannel): number | undefined {
  if (channel === "C") return undefined;
  const control = channel === "A" ? data[timer.TCCR1] : data[timer.GTCCR];
  const pwmEnabled = (control & 0x40) !== 0; // PWM1A in TCCR1, PWM1B in GTCCR: both bit 6
  const com = (control >> 4) & 3;
  if (!pwmEnabled || com < 2) return undefined;
  const top = data[timer.OCR1C];
  if (top === 0) return undefined;
  const ocr = channel === "A" ? data[timer.OCR1A] : data[timer.OCR1B];
  const duty = Math.round((Math.min(ocr, top) * 255) / top);
  return com === 3 ? 255 - duty : duty;
}

function pwmTop(data: Uint8Array, timer: AvrTimerRegisters): number | undefined {
  const wgmLow = data[timer.TCCRA] & 3;
  if (timer.bits === 8) {
    const mode = wgmLow | ((data[timer.TCCRB] >> 1) & 4);
    if (mode === 1 || mode === 3) return 0xff;
    if (mode === 5 || mode === 7) return data[timer.OCRA];
    return undefined;
  }
  const mode = wgmLow | ((data[timer.TCCRB] >> 1) & 0xc);
  const tops: Record<number, number | undefined> = {
    1: 0xff, 2: 0x1ff, 3: 0x3ff, 5: 0xff, 6: 0x1ff, 7: 0x3ff,
    8: read(data, timer.ICR, 16), 10: read(data, timer.ICR, 16), 14: read(data, timer.ICR, 16),
    9: read(data, timer.OCRA, 16), 11: read(data, timer.OCRA, 16), 15: read(data, timer.OCRA, 16),
  };
  return tops[mode];
}

const read = (data: Uint8Array, address: number, bits: 8 | 16): number =>
  bits === 8 ? data[address] : data[address] | (data[address + 1] << 8);
