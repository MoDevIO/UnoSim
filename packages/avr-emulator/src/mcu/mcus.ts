/** MCUs the emulator supports (plan E3). Profiles follow in P1.3, P5.1 and P6.2. */
export const MCU_IDS = ["atmega328p", "atmega2560", "attiny85"] as const;
export type McuId = (typeof MCU_IDS)[number];

/** Flash size from the datasheet, in bytes. */
export const MCU_FLASH_BYTES: Readonly<Record<McuId, number>> = {
  atmega328p: 32 * 1024,
  atmega2560: 256 * 1024,
  attiny85: 8 * 1024,
};
