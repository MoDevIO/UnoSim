const PIN_MODE_NAMES: Record<number, string> = {
  0: "INPUT",
  1: "OUTPUT",
  2: "INPUT_PULLUP",
};

export function pinModeToString(mode: number): string {
  return PIN_MODE_NAMES[mode] ?? "UNKNOWN";
}
