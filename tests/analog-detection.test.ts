import { test, expect } from "vitest";

test("detect analog pins from for-loop with analogRead", () => {
  const code = `void setup()
{

}

void loop()
{
    for (byte i = 16; i < 20; i++)
    {
        Serial.print(analogRead(i));
        Serial.print(" ");
    }
    Serial.println();
    
    delay(100);
}`;

  // Simulate the detection logic
  const pins = new Set<number>();

  // Detect for-loops
  const forLoopRe =
    /for\s*\(\s*(?:byte|int|unsigned|uint8_t)?\s*(\w+)\s*=\s*(\d+)\s*;\s*\1\s*(<|<=)\s*(\d+)\s*;[^\)]*\)\s*\{([\s\S]*?)\}/g;
  let fm;
  while ((fm = forLoopRe.exec(code))) {
    const varName = fm[1];
    const start = Number(fm[2]);
    const cmp = fm[3];
    const end = Number(fm[4]);
    const body = fm[5];
    const useRe = new RegExp(
      "analogRead\\s*\\(\\s*" + varName + "\\s*\\)",
      "g",
    );
    if (useRe.test(body)) {
      const inclusive = cmp === "<=";
      const last = inclusive ? end : end - 1;
      for (let pin = start; pin <= last; pin++) {
        if (pin >= 0 && pin <= 5) pins.add(14 + pin);
        else if (pin >= 14 && pin <= 19) pins.add(pin);
        else if (pin >= 16 && pin <= 19) pins.add(pin);
      }
    }
  }

  const arr = Array.from(pins).sort((a, b) => a - b);
  console.log("Detected pins:", arr);
  console.log("Pins as analog:", arr.map((p) => `A${p - 14}`).join(", "));

  // Expect pins 16-19 to be detected (A2-A5)
  expect(arr).toEqual([16, 17, 18, 19]);
});
