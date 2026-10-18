import { AVRUSART, type CPU } from "avr8js";

type UsartConfig = ConstructorParameters<typeof AVRUSART>[1];

const UCSRA_RXC = 0x80;
const UCSRB_RXCIE = 0x80;
const UCSRB_RXEN = 0x10;

/**
 * An AVRUSART whose pending receive-complete flag survives writes to UCSRnB.
 *
 * avr8js 0.21.1 clears RXC on every write to UCSRnB while RXEN stays set. On
 * the chip only reading UDRn clears the flag (datasheet 19.7.3), and the Arduino
 * core writes UCSRnB with every `Serial.write` (`sbi UCSR0B, UDRIE0`). A byte
 * that arrived while the sketch was printing therefore lost its interrupt and
 * the next byte replaced it. The wrapper restores the flag (and so the pending
 * interrupt) after such a write.
 */
export function createUsart(cpu: CPU, config: UsartConfig, clockHz: number): AVRUSART {
  const usart = new AVRUSART(cpu, config, clockHz);
  const receiveComplete = {
    address: config.rxCompleteInterrupt,
    flagRegister: config.UCSRA,
    flagMask: UCSRA_RXC,
    enableRegister: config.UCSRB,
    enableMask: UCSRB_RXCIE,
  };
  const upstream = cpu.writeHooks[config.UCSRB];
  cpu.writeHooks[config.UCSRB] = (value, oldValue, address, mask) => {
    const pending = (cpu.data[config.UCSRA] & UCSRA_RXC) !== 0;
    const handled = upstream?.(value, oldValue, address, mask);
    if (pending && value & UCSRB_RXEN && oldValue & UCSRB_RXEN) cpu.setInterruptFlag(receiveComplete);
    return handled;
  };
  return usart;
}
