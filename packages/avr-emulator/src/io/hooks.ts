import type { CPU } from "avr8js";

/** Wraps an existing write hook: the peripheral's hook runs first, then `observe`. */
export function chainWrite(cpu: CPU, address: number, observe: (value: number, old: number) => void): void {
  const previous = cpu.writeHooks[address];
  cpu.writeHooks[address] = (value, old, addr, mask) => {
    const handled = previous?.(value, old, addr, mask);
    observe(value, old);
    return handled;
  };
}
