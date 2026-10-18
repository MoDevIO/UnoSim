import { ATMEGA328P } from "./atmega328p";
import type { McuId } from "./mcus";
import type { McuProfile } from "./types";

/** ATmega2560 (P5.1) and ATtiny85 (P6.2) follow. */
const PROFILES: Partial<Record<McuId, McuProfile>> = { atmega328p: ATMEGA328P };

export function mcuProfile(id: McuId): McuProfile {
  const profile = PROFILES[id];
  if (!profile) throw new RangeError(`MCU ${id} has no profile yet`);
  return profile;
}
