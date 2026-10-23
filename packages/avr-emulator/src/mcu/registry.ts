import { ATMEGA2560 } from "./atmega2560";
import { ATMEGA328P } from "./atmega328p";
import type { McuId } from "./mcus";
import type { McuProfile } from "./types";

/** The ATtiny85 profile (mcu/attiny85.ts, P6.2) is registered with its board hardware (P6.4). */
const PROFILES: Partial<Record<McuId, McuProfile>> = { atmega328p: ATMEGA328P, atmega2560: ATMEGA2560 };

export function mcuProfile(id: McuId): McuProfile {
  const profile = PROFILES[id];
  if (!profile) throw new RangeError(`MCU ${id} has no profile yet`);
  return profile;
}
