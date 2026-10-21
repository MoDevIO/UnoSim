import type { BoardHardware, PinHardware, PortName } from "./types";

// arduino:avr@1.8.8, variants/mega/pins_arduino.h: pin 0–53 digital, 54–69 = A0–A15.
// [port, bit] by pin number, as digital_pin_to_port_PGM and digital_pin_to_bit_mask_PGM list them.
const PORT_BITS: ReadonlyArray<readonly [PortName, number]> = [
  ["E", 0], ["E", 1], ["E", 4], ["E", 5], ["G", 5], ["E", 3], ["H", 3], ["H", 4], ["H", 5], ["H", 6], //  0– 9
  ["B", 4], ["B", 5], ["B", 6], ["B", 7], ["J", 1], ["J", 0], ["H", 1], ["H", 0], ["D", 3], ["D", 2], // 10–19
  ["D", 1], ["D", 0], ["A", 0], ["A", 1], ["A", 2], ["A", 3], ["A", 4], ["A", 5], ["A", 6], ["A", 7], // 20–29
  ["C", 7], ["C", 6], ["C", 5], ["C", 4], ["C", 3], ["C", 2], ["C", 1], ["C", 0], ["D", 7], ["G", 2], // 30–39
  ["G", 1], ["G", 0], ["L", 7], ["L", 6], ["L", 5], ["L", 4], ["L", 3], ["L", 2], ["L", 1], ["L", 0], // 40–49
  ["B", 3], ["B", 2], ["B", 1], ["B", 0], ["F", 0], ["F", 1], ["F", 2], ["F", 3], ["F", 4], ["F", 5], // 50–59
  ["F", 6], ["F", 7], ["K", 0], ["K", 1], ["K", 2], ["K", 3], ["K", 4], ["K", 5], ["K", 6], ["K", 7], // 60–69
];

// digital_pin_to_timer_PGM: pins 2–13 and 44–46.
const PWM: Readonly<Record<number, PinHardware["pwm"]>> = {
  2: { timer: 3, channel: "B" },
  3: { timer: 3, channel: "C" },
  4: { timer: 0, channel: "B" },
  5: { timer: 3, channel: "A" },
  6: { timer: 4, channel: "A" },
  7: { timer: 4, channel: "B" },
  8: { timer: 4, channel: "C" },
  9: { timer: 2, channel: "B" },
  10: { timer: 2, channel: "A" },
  11: { timer: 1, channel: "A" },
  12: { timer: 1, channel: "B" },
  13: { timer: 0, channel: "A" },
  44: { timer: 5, channel: "C" },
  45: { timer: 5, channel: "B" },
  46: { timer: 5, channel: "A" },
};

const FIRST_ANALOG_PIN = 54;

const pins: readonly PinHardware[] = PORT_BITS.map(([port, bit], pin) => {
  const analog = pin >= FIRST_ANALOG_PIN;
  return {
    pin,
    label: analog ? `A${pin - FIRST_ANALOG_PIN}` : `D${pin}`,
    port: { port, bit },
    ...(analog ? { adcChannel: pin - FIRST_ANALOG_PIN } : {}),
    ...(PWM[pin] ? { pwm: PWM[pin] } : {}),
    ...(pin <= 1 ? { role: "serial" as const } : {}),
  };
});

/** Arduino Mega 2560: four hardware serial ports (Serial = USART0 on pins 0/1, Serial1–3 on 19/18, 17/16, 15/14). */
export const MEGA2560: BoardHardware = {
  id: "mega2560",
  mcu: "atmega2560",
  clockHz: 16_000_000,
  vccVolts: 5,
  ledBuiltin: 13,
  pins,
  serialPorts: [
    { index: 0, kind: "usart", usart: 0, rxPin: 0, txPin: 1 },
    { index: 1, kind: "usart", usart: 1, rxPin: 19, txPin: 18 },
    { index: 2, kind: "usart", usart: 2, rxPin: 17, txPin: 16 },
    { index: 3, kind: "usart", usart: 3, rxPin: 15, txPin: 14 },
  ],
};
