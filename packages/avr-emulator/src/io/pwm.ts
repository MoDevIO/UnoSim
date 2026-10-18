/** Registers of one timer, as far as PWM observation needs them. */
export interface TimerRegisters {
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

export type PwmChannel = "A" | "B" | "C";

const COM_SHIFT: Readonly<Record<PwmChannel, number>> = { A: 6, B: 4, C: 2 };

/** All data-space addresses whose writes can change a duty cycle of this timer. */
export function pwmRegisterAddresses(timer: TimerRegisters): number[] {
  const wide = (address: number) => (timer.bits === 16 ? [address, address + 1] : [address]);
  return [timer.TCCRA, timer.TCCRB, ...[timer.OCRA, timer.OCRB, timer.OCRC, timer.ICR].filter((a) => a !== 0).flatMap(wide)];
}

/**
 * Duty cycle 0–255 of a timer channel from compare-output mode, waveform and
 * compare register, or undefined when the channel does not drive its pin
 * with PWM (normal or CTC mode, output disconnected). No waveform is modelled.
 */
export function pwmDuty(data: Uint8Array, timer: TimerRegisters, channel: PwmChannel): number | undefined {
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

function pwmTop(data: Uint8Array, timer: TimerRegisters): number | undefined {
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
