import type { CPU } from "avr8js";
import { describe, expect, it } from "vitest";
import { machineFromFixture } from "./machine-helpers";

const UCSR0A = 0xc0;
const UCSR0B = 0xc1;
const UDR0 = 0xc6;
const SREG = 0x5f;
const RXC = 0x80;
const RXCIE = 0x80;
const RXEN = 0x10;
const TXEN = 0x08;
const UDRIE = 0x20;
const RX_VECTOR = 0x24;

function receiverWithPendingByte() {
  const { cpu, peripherals } = machineFromFixture("uno", "uno-blink.hex");
  cpu.data[SREG] = 0; // interrupts disabled, as inside the core's atomic block
  cpu.writeData(UCSR0B, RXCIE | RXEN | TXEN);
  peripherals.usarts[0].writeByte(65, true);
  return { cpu };
}

/** Enables interrupts and reports whether the receive-complete vector is entered. */
function serviced(cpu: CPU): boolean {
  cpu.data[SREG] = 0x80;
  cpu.tick();
  return cpu.pc === RX_VECTOR;
}

describe("USART receive-complete flag (avr8js 0.21.1 clears it on UCSR0B writes)", () => {
  it("stays set and pending when the sketch writes UCSR0B, as Serial.write does", () => {
    const { cpu } = receiverWithPendingByte();
    expect(cpu.data[UCSR0A] & RXC).toBe(RXC);

    cpu.writeData(UCSR0B, RXCIE | RXEN | TXEN | UDRIE);

    expect(cpu.data[UCSR0A] & RXC).toBe(RXC);
    expect(serviced(cpu)).toBe(true);
  });

  it("is cleared by reading UDR0, which returns the byte", () => {
    const { cpu } = receiverWithPendingByte();
    cpu.writeData(UCSR0B, RXCIE | RXEN | TXEN | UDRIE);

    expect(cpu.readData(UDR0)).toBe(65);

    expect(cpu.data[UCSR0A] & RXC).toBe(0);
    expect(serviced(cpu)).toBe(false);
  });

  it("is not invented by a UCSR0B write when no byte is waiting", () => {
    const { cpu } = machineFromFixture("uno", "uno-blink.hex");
    cpu.data[SREG] = 0;
    cpu.writeData(UCSR0B, RXCIE | RXEN | TXEN);

    cpu.writeData(UCSR0B, RXCIE | RXEN | TXEN | UDRIE);

    expect(cpu.data[UCSR0A] & RXC).toBe(0);
    expect(serviced(cpu)).toBe(false);
  });
});
