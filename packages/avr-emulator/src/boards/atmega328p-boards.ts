import type { BoardHardware, PinHardware } from "./types";

// arduino:avr@1.8.8, variants/standard/pins_arduino.h (Uno) and
// variants/eightanaloginputs/pins_arduino.h (Nano, adds A6/A7).
const PWM: Readonly<Record<number, PinHardware["pwm"]>> = {
  3: { timer: 2, channel: "B" },
  5: { timer: 0, channel: "B" },
  6: { timer: 0, channel: "A" },
  9: { timer: 1, channel: "A" },
  10: { timer: 1, channel: "B" },
  11: { timer: 2, channel: "A" },
};

function digitalPin(pin: number): PinHardware {
  const [port, bit] = pin < 8 ? (["D", pin] as const) : (["B", pin - 8] as const);
  return {
    pin,
    label: `D${pin}`,
    port: { port, bit },
    ...(PWM[pin] ? { pwm: PWM[pin] } : {}),
    ...(pin <= 1 ? { role: "serial" as const } : {}),
  };
}

const analogPin = (channel: number): PinHardware => ({
  pin: 14 + channel,
  label: `A${channel}`,
  port: { port: "C", bit: channel },
  adcChannel: channel,
});

const atmega328pPins: readonly PinHardware[] = [
  ...Array.from({ length: 14 }, (_, pin) => digitalPin(pin)),
  ...Array.from({ length: 6 }, (_, channel) => analogPin(channel)),
];

const common = {
  mcu: "atmega328p",
  clockHz: 16_000_000,
  vccVolts: 5,
  ledBuiltin: 13,
  serialPorts: [{ index: 0, kind: "usart", usart: 0, rxPin: 0, txPin: 1 }],
} as const;

export const UNO: BoardHardware = { id: "uno", ...common, pins: atmega328pPins };

/** Nano: A6/A7 (pins 20/21) are analog-only inputs without a port bit. */
export const NANO: BoardHardware = {
  id: "nano",
  ...common,
  pins: [...atmega328pPins, { pin: 20, label: "A6", adcChannel: 6 }, { pin: 21, label: "A7", adcChannel: 7 }],
};
