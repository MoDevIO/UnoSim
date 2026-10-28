import type { BoardHardwareId } from "./ids";
import { boardHardware } from "./registry";
import type { PinHardware } from "./types";

/** Reference capability, independent of a sketch's use of the pin. */
export interface PinBusReference {
  readonly interface: "i2c" | "spi" | "serial";
  readonly peripheral: "hardware" | "usi" | "software";
  readonly signal: "SDA" | "SCL" | "SS" | "MOSI" | "MISO" | "SCK" | "RX" | "TX";
  readonly serialPort?: number;
  readonly mode?: "master";
  /** A modeled peripheral is not a guarantee that arbitrary connected devices are simulated. */
  readonly simulation: "modeled" | "not-modeled";
}

export interface PinReference {
  readonly hardware: PinHardware;
  readonly buses: readonly PinBusReference[];
  /** Arduino digitalPinToInterrupt index, not the MCU's vector number. */
  readonly externalInterrupt?: number;
  readonly pinChange?: {
    readonly index: number;
    readonly coreSupported: boolean;
  };
}

/** Nonprogrammable contacts; repeated GND/RESET contacts share a reference entry. */
export interface ReferenceContact {
  readonly label: string;
  readonly description: string;
}

interface CorePinFunctions {
  readonly i2c: readonly [sda: number, scl: number];
  readonly spi: readonly [ss: number, mosi: number, miso: number, sck: number];
  readonly externalInterrupts: Readonly<Partial<Record<number, number>>>;
}

// arduino:avr 1.8.8, variants/{standard,eightanaloginputs,mega}/pins_arduino.h.
// ATTinyCore 1.5.2, variants/tinyX5/pins_arduino.h: USI DI/DO names are MASTER
// roles. ISP programmer labels use the opposite MISO/MOSI convention.
const STANDARD: CorePinFunctions = {
  i2c: [18, 19],
  spi: [10, 11, 12, 13],
  externalInterrupts: { 2: 0, 3: 1 },
};
const CORE_FUNCTIONS: Readonly<Record<BoardHardwareId, CorePinFunctions>> = {
  uno: STANDARD,
  nano: STANDARD,
  mega2560: {
    i2c: [20, 21],
    spi: [53, 51, 50, 52],
    externalInterrupts: { 2: 0, 3: 1, 18: 5, 19: 4, 20: 3, 21: 2 },
  },
  attiny85: { i2c: [0, 2], spi: [3, 1, 0, 2], externalInterrupts: { 2: 0 } },
};

function pinChange(
  board: BoardHardwareId,
  pin: PinHardware,
): PinReference["pinChange"] {
  if (!pin.port) return undefined;
  const { port, bit } = pin.port;
  if (board === "attiny85") return { index: bit, coreSupported: true };
  if (board !== "mega2560") {
    const offsets = { B: 0, C: 8, D: 16 };
    return port in offsets
      ? {
          index: offsets[port as keyof typeof offsets] + bit,
          coreSupported: true,
        }
      : undefined;
  }
  // ATmega2560: PCINT0–7 = PB0–7, PCINT8 = PE0, PCINT9–15 = PJ0–6,
  // PCINT16–23 = PK0–7. Arduino's PCINT helpers deliberately omit PE0/PJ0/PJ1.
  if (port === "B") return { index: bit, coreSupported: true };
  if (port === "K") return { index: 16 + bit, coreSupported: true };
  if (port === "E" && bit === 0) return { index: 8, coreSupported: false };
  if (port === "J" && bit <= 6) return { index: 9 + bit, coreSupported: false };
  return undefined;
}

/** Signal rows always come from the hardware profile; only extra roles are mapped here. */
export function boardPinReference(
  board: BoardHardwareId,
): readonly PinReference[] {
  const hardware = boardHardware(board);
  const core = CORE_FUNCTIONS[board];
  const peripheral = board === "attiny85" ? "usi" : "hardware";
  return hardware.pins.map((pin) => {
    const buses: PinBusReference[] = [];
    core.i2c.forEach((number, index) => {
      if (pin.pin === number)
        buses.push({
          interface: "i2c",
          peripheral,
          signal: index === 0 ? "SDA" : "SCL",
          simulation: "not-modeled",
        });
    });
    const spiSignals = ["SS", "MOSI", "MISO", "SCK"] as const;
    core.spi.forEach((number, index) => {
      if (pin.pin === number)
        buses.push({
          interface: "spi",
          peripheral,
          signal: spiSignals[index],
          ...(peripheral === "usi" ? { mode: "master" as const } : {}),
          simulation: "not-modeled",
        });
    });
    for (const serial of hardware.serialPorts) {
      if (pin.pin === serial.rxPin || pin.pin === serial.txPin) {
        buses.push({
          interface: "serial",
          peripheral: serial.kind === "software" ? "software" : "hardware",
          signal: pin.pin === serial.rxPin ? "RX" : "TX",
          serialPort: serial.index,
          simulation: "modeled",
        });
      }
    }
    const externalInterrupt = core.externalInterrupts[pin.pin];
    const change = pinChange(board, pin);
    return {
      hardware: pin,
      buses,
      ...(externalInterrupt === undefined ? {} : { externalInterrupt }),
      ...(change ? { pinChange: change } : {}),
    };
  });
}

/** Pin labels on the boards, not additional Arduino pin numbers or interactive inputs. */
export function boardReferenceContacts(
  board: BoardHardwareId,
): readonly ReferenceContact[] {
  if (board === "attiny85")
    return [
      { label: "VCC", description: "Supply voltage" },
      { label: "GND", description: "Ground" },
    ];
  const common: ReferenceContact[] = [
    { label: "5V", description: "5 V supply" },
    { label: "3.3V", description: "3.3 V supply" },
    { label: "GND", description: "Ground (all GND contacts)" },
    { label: "VIN", description: "External supply input" },
    { label: "RESET", description: "Active-low reset (all RESET contacts)" },
    { label: "AREF", description: "Analog reference input" },
  ];
  return board === "nano"
    ? common
    : [
        ...common,
        { label: "IOREF", description: "I/O voltage reference" },
        { label: "NC", description: "Not connected" },
      ];
}
