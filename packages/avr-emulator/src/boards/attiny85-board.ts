import type { BoardHardware, PinHardware } from "./types";

// ATTinyCore 1.5.2, variants/tinyX5/pins_arduino.h (8 MHz internal): pins 0–5 are PB0–PB5,
// A0–A3 are second names of pins 5, 2, 4, 3 (ADC0–3); PWM on 0 (OC0A), 1 (OC1A, TIMER1_PWM)
// and 4 (OC1B); `Serial` is TinySoftwareSerial with TX on PB0 and RX on PB1; LED_BUILTIN is 1.
const ANALOG: Readonly<Record<number, number>> = { 5: 0, 2: 1, 4: 2, 3: 3 };
const PWM: Readonly<Record<number, PinHardware["pwm"]>> = {
  0: { timer: 0, channel: "A" },
  1: { timer: 1, channel: "A" },
  4: { timer: 1, channel: "B" },
};

// PB5 is RESET (the fuse that would free it is not set by the core); PB0/PB1 carry `Serial`.
const ROLE: Readonly<Record<number, PinHardware["role"]>> = { 0: "serial", 1: "serial", 5: "reset" };

function pin(number: number): PinHardware {
  const channel = ANALOG[number];
  return {
    pin: number,
    label: `PB${number}`,
    port: { port: "B", bit: number },
    ...(channel === undefined ? {} : { adcChannel: channel, analogName: `A${channel}` }),
    ...(PWM[number] ? { pwm: PWM[number] } : {}),
    ...(ROLE[number] ? { role: ROLE[number] } : {}),
  };
}

export const ATTINY85_BOARD: BoardHardware = {
  id: "attiny85",
  mcu: "attiny85",
  clockHz: 8_000_000,
  vccVolts: 5,
  ledBuiltin: 1,
  pins: Array.from({ length: 6 }, (_, number) => pin(number)),
  serialPorts: [{ index: 0, kind: "software", rxPin: 1, txPin: 0 }],
};
