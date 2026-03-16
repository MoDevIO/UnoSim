/**
 * Arduino Mock Module - Public API
 *
 * Exports all C++ code segments needed for Arduino mock injection.
 * Each module covers a distinct concern of the simulated C++ runtime:
 *
 *  arduino-constants      — typedefs, pin-mode macros, math constants
 *  arduino-string         — Arduino String class
 *  arduino-registry       — IOPinRecord structs + pinModes[]/pinValues[] init
 *  arduino-registry-logic — IORegistry map + GPIO functions (Step A)
 *  arduino-timing         — global runtime state + timing/random functions
 *  arduino-string-utils   — SerialClass + delay() (Step B)
 *  arduino-stdin          — stdin protocol command dispatcher
 */

export { ARDUINO_CONSTANTS_CODE } from './arduino-constants';
export { ARDUINO_STRING_CLASS } from './arduino-string';
export { ARDUINO_REGISTRY_STRUCTURES, ARDUINO_PIN_STATE_INIT } from './arduino-registry';
export { ARDUINO_REGISTRY_LOGIC } from './arduino-registry-logic';
export { ARDUINO_GLOBALS, ARDUINO_TIMING_AND_RANDOM } from './arduino-timing';
export { ARDUINO_SERIAL_CLASS } from './arduino-string-utils';
export { ARDUINO_STDIN_HANDLER } from './arduino-stdin';
