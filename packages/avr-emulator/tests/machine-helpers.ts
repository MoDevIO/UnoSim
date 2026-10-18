import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avrInstruction } from "avr8js";
import { type BoardHardwareId, type Machine, buildSimulationImage, createMachine, loadSimulationImage } from "../src/index";

export function machineFromFixture(board: BoardHardwareId, hexFile: string): Machine {
  const hex = readFileSync(join(__dirname, "fixtures", hexFile), "utf8");
  return createMachine(loadSimulationImage(buildSimulationImage({ board, hex })));
}

/** Runs until `Serial` printed `stopAfter` or `maxMs` of simulated time passed; returns port 0 text. */
export function runSerial(machine: Machine, { stopAfter = "DONE\n", maxMs = 2000 } = {}): string {
  const { cpu, board, peripherals } = machine;
  let text = "";
  peripherals.usarts[0].onByteTransmit = (byte) => {
    text += String.fromCodePoint(byte);
  };
  const end = (maxMs * board.clockHz) / 1000;
  while (cpu.cycles < end && !text.includes(stopAfter)) {
    for (let i = 0; i < 1000; i++) {
      avrInstruction(cpu);
      cpu.tick();
    }
  }
  return text.replaceAll("\r\n", "\n");
}
