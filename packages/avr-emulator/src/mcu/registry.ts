import { ATMEGA2560 } from "./atmega2560";
import { ATMEGA328P } from "./atmega328p";
import { ATTINY85 } from "./attiny85";
import type { McuId } from "./mcus";
import type { McuProfile } from "./types";

const PROFILES: Partial<Record<McuId, McuProfile>> = { atmega328p: ATMEGA328P, atmega2560: ATMEGA2560, attiny85: ATTINY85 };

export function mcuProfile(id: McuId): McuProfile {
  const profile = PROFILES[id];
  if (!profile) throw new RangeError(`MCU ${id} has no profile yet`);
  return profile;
}
