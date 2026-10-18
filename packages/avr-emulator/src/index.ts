/**
 * @unosim/avr-emulator – AVR emulation core of UnoSim.
 *
 * The package describes hardware only and imports nothing from UnoSim
 * (`client/`, `server/`, `shared/`); UnoSim's `shared/` may import it.
 */
export { AVR8JS_DATA_SPACE_OFFSET, avr8jsSramParameter, ramEnd } from "./mcu/memory";
export type { MemoryLayout } from "./mcu/memory";
