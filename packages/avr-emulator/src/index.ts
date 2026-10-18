/**
 * @unosim/avr-emulator – AVR emulation core of UnoSim.
 *
 * The package describes hardware only and imports nothing from UnoSim
 * (`client/`, `server/`, `shared/`); UnoSim's `shared/` may import it.
 */
export { BOARD_HARDWARE_IDS, BOARD_MCU, isBoardHardwareId } from "./boards/ids";
export type { BoardHardwareId } from "./boards/ids";
export { NANO, UNO } from "./boards/atmega328p-boards";
export { boardHardware, hasBoardHardware } from "./boards/registry";
export type { BoardHardware, PinHardware, PortName, SerialPortHardware } from "./boards/types";
export { createMachine } from "./machine";
export { systemClock } from "./runtime/clock";
export type { RuntimeClock } from "./runtime/clock";
export { Emulator } from "./runtime/emulator";
export type { DiagnosticEvent, EmulatorOptions, RunState, StopInfo, StopReason } from "./runtime/emulator";
export { ANALOG_STEPS, AnalogInputs } from "./io/analog-inputs";
export { Diagnostics } from "./io/diagnostics";
export type { Diagnostic, DiagnosticKind } from "./io/diagnostics";
export { IoUsageObserver } from "./io/io-usage";
export type { IoFunction, IoUsage } from "./io/io-usage";
export { PinModel } from "./io/pin-model";
export { SERIAL_INPUT_LIMITS, SerialPorts } from "./io/serial-ports";
export type { SerialFrameConfig, SerialOutput } from "./io/serial-ports";
export { Utf8StreamDecoder, encodeUtf8 } from "./io/utf8";
export type { Level, PinChanges, PinMode, PinSnapshot } from "./io/pin-model";
export { pwmDuty, pwmRegisterAddresses } from "./io/pwm";
export type { PwmChannel, TimerRegisters } from "./io/pwm";
export type { Machine, MachineOptions } from "./machine";
export { ArrayEepromBackend, erasedEeprom } from "./mcu/eeprom";
export { ATMEGA328P } from "./mcu/atmega328p";
export { mcuProfile } from "./mcu/registry";
export type { McuPeripherals, McuProfile } from "./mcu/types";
export { encodeBase64, decodeBase64 } from "./image/base64";
export { readElfSymbols } from "./image/elf";
export type { ElfSymbol } from "./image/elf";
export { ImageError } from "./image/image-error";
export { parseIntelHex } from "./image/intel-hex";
export type { IntelHexImage } from "./image/intel-hex";
export { sha256Hex } from "./image/sha256";
export {
  IO_FUNCTION_SYMBOLS,
  MEMORY_SYMBOLS,
  SIMULATION_IMAGE_FORMAT_VERSION,
  buildSimulationImage,
  loadSimulationImage,
} from "./image/simulation-image";
export type {
  BuildImageInput,
  ImageSymbols,
  IoFunctionSymbol,
  LoadedImage,
  MemorySymbol,
  SimulationImage,
} from "./image/simulation-image";
export { AVR8JS_DATA_SPACE_OFFSET, avr8jsSramParameter, ramEnd } from "./mcu/memory";
export type { MemoryLayout } from "./mcu/memory";
export { MCU_FLASH_BYTES, MCU_IDS } from "./mcu/mcus";
export type { McuId } from "./mcu/mcus";
export { PROTOCOL_VERSION, COMMAND_LIMITS, RUN_STARTING_COMMANDS } from "./protocol/messages";
export type {
  Command,
  CommandType,
  RunEvent,
  RunStatus,
  TelemetrySample,
  WorkerEvent,
  WorkerEventType,
} from "./protocol/messages";
export { parseCommand } from "./protocol/commands";
export type { CommandResult } from "./protocol/commands";
export { EventBatcher } from "./protocol/event-batcher";
export type { BatcherOptions, FlushContext } from "./protocol/event-batcher";
export { RunGate } from "./protocol/run-gate";
