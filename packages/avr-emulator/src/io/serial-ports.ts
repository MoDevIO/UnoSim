import type { AVRUSART } from "avr8js";
import type { SerialPortHardware } from "../boards/types";
import type { Machine } from "../machine";
import { SoftwareUart } from "./software-uart";
import { Utf8StreamDecoder, encodeUtf8 } from "./utf8";

/** What a serial port needs of its transport: a hardware USART or the core's software UART (ATtiny85). */
type SerialChannel = Pick<
  AVRUSART,
  "onByteTransmit" | "onRxComplete" | "onConfigurationChange" | "rxEnable" | "rxBusy" | "writeByte" | "baudRate" | "bitsPerChar" | "stopBits" | "parityEnabled" | "parityOdd"
>;

/** Input limits as in UnoSim today (plan P1.7): per message and pending per port. */
export const SERIAL_INPUT_LIMITS = { maxMessageBytes: 4 * 1024, maxPendingBytes: 1024 * 1024 } as const;

export interface SerialFrameConfig {
  readonly baud: number;
  readonly dataBits: 5 | 6 | 7 | 8 | 9;
  readonly parity: "none" | "even" | "odd";
  readonly stopBits: 1 | 2;
}

export interface SerialOutput {
  /** 0 = `Serial`, 1 = `Serial1`, … */
  readonly port: number;
  readonly text: string;
}

interface Port {
  readonly hardware: SerialPortHardware;
  readonly usart: SerialChannel;
  /** Set for a software UART: its fallback baud rate follows the Serial Monitor. */
  readonly software?: SoftwareUart;
  readonly decoder: Utf8StreamDecoder;
  output: string;
  /** Bytes waiting for the receiver, oldest first. */
  readonly rx: number[];
  rxHead: number;
}

/**
 * The hardware serial ports of a board. Output: USART bytes decoded as UTF-8
 * across packet boundaries. Input: a queue that hands the USART one byte per
 * frame time while its receiver is enabled; the core's receive buffer behaves
 * as on the board (64 bytes on the Uno, unread bytes are lost). Bytes that
 * arrive while the receiver is disabled (before `Serial.begin()`, after
 * `Serial.end()`) are discarded, as on the chip, and reported through
 * `onDiscard` once per situation: a port reports again only after its
 * receiver has been enabled in between.
 */
export class SerialPorts {
  private readonly ports = new Map<number, Port>();

  /** Ports whose discarded input has been reported and whose receiver has not been enabled since. */
  private readonly reported = new Set<number>();

  constructor(
    machine: Machine,
    private readonly onDiscard: (port: number, bytes: number) => void = () => undefined,
  ) {
    for (const hardware of machine.board.serialPorts) {
      const software = hardware.kind === "software" ? softwareUart(machine, hardware) : undefined;
      const usart = software ?? (hardware.kind === "usart" ? machine.peripherals.usarts[hardware.usart] : undefined);
      if (!usart) throw new RangeError(`${machine.mcu.id} has no USART${hardware.kind === "usart" ? hardware.usart : ""}`);
      const port: Port = { hardware, usart, ...(software ? { software } : {}), decoder: new Utf8StreamDecoder(), output: "", rx: [], rxHead: 0 };
      usart.onByteTransmit = (byte) => {
        port.output += port.decoder.decode([byte]);
      };
      usart.onRxComplete = () => this.pump(port);
      usart.onConfigurationChange = () => this.pump(port);
      this.ports.set(hardware.index, port);
    }
  }

  get portIndexes(): readonly number[] {
    return [...this.ports.keys()];
  }

  /** Decoded output per port since the previous call (complete characters only). */
  takeOutput(): SerialOutput[] {
    const out: SerialOutput[] = [];
    for (const [index, port] of this.ports) {
      if (port.output === "") continue;
      out.push({ port: index, text: port.output });
      port.output = "";
    }
    return out;
  }

  /** Queues text for the sketch, UTF-8 encoded; rejects messages and backlogs above the limits. */
  send(portIndex: number, text: string): void {
    const port = this.port(portIndex);
    const bytes = encodeUtf8(text);
    if (bytes.length > SERIAL_INPUT_LIMITS.maxMessageBytes) {
      throw new RangeError(`serial input of ${bytes.length} bytes exceeds ${SERIAL_INPUT_LIMITS.maxMessageBytes} bytes`);
    }
    if (this.pendingBytes(portIndex) + bytes.length > SERIAL_INPUT_LIMITS.maxPendingBytes) {
      throw new RangeError(`more than ${SERIAL_INPUT_LIMITS.maxPendingBytes} bytes of serial input are pending`);
    }
    port.rx.push(...bytes);
    this.pump(port);
  }

  /** Bytes not yet handed to the USART. */
  pendingBytes(portIndex: number): number {
    const port = this.port(portIndex);
    return port.rx.length - port.rxHead;
  }

  /**
   * Baud rate of a software UART until its output reveals the sketch's
   * (`Serial.begin(baud)` sets no register); the Serial Monitor's setting.
   * Ignored for a hardware USART, whose rate is in UBRR.
   */
  setFallbackBaud(portIndex: number, baud: number): void {
    const { software } = this.port(portIndex);
    if (software) software.configuredBaud = baud;
  }

  /** Frame format the sketch configured (UBRR, U2X, UCSRC; for a software UART the rate it found, 8N1). */
  frameConfig(portIndex: number): SerialFrameConfig {
    const { usart } = this.port(portIndex);
    return { baud: usart.baudRate, dataBits: usart.bitsPerChar, parity: parityOf(usart), stopBits: usart.stopBits };
  }

  private pump(port: Port): void {
    if (port.usart.rxEnable) this.reported.delete(port.hardware.index);
    else this.discard(port);
    if (port.rxHead >= port.rx.length || port.usart.rxBusy || !port.usart.rxEnable) return;
    if (port.usart.writeByte(port.rx[port.rxHead])) port.rxHead++;
    if (port.rxHead === port.rx.length) {
      port.rx.length = 0;
      port.rxHead = 0;
    }
  }

  private discard(port: Port): void {
    const bytes = port.rx.length - port.rxHead;
    port.rx.length = 0;
    port.rxHead = 0;
    if (bytes === 0 || this.reported.has(port.hardware.index)) return;
    this.reported.add(port.hardware.index);
    this.onDiscard(port.hardware.index, bytes);
  }

  private port(index: number): Port {
    const port = this.ports.get(index);
    if (!port) throw new RangeError(`serial port ${index} does not exist`);
    return port;
  }
}

/** The core's software UART on the pins of `hardware`; both must be on the same port. */
function softwareUart(machine: Machine, hardware: SerialPortHardware): SoftwareUart {
  const pinOf = (number: number) => machine.board.pins.find((pin) => pin.pin === number)?.port;
  const tx = pinOf(hardware.txPin);
  const rx = pinOf(hardware.rxPin);
  const io = tx && machine.peripherals.ports.get(tx.port);
  if (!tx || !rx || !io || tx.port !== rx.port) throw new RangeError(`serial port ${hardware.index} needs TX and RX on one port`);
  return new SoftwareUart(machine.cpu, io, machine.board.clockHz, { txPin: tx.bit, rxPin: rx.bit });
}

function parityOf(usart: SerialChannel): SerialFrameConfig["parity"] {
  if (!usart.parityEnabled) return "none";
  return usart.parityOdd ? "odd" : "even";
}
