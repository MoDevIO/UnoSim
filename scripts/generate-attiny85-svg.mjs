// Draws the ATtiny85 for the board view (plan P6.5): `client/public/ATtiny85.svg` (a DIP-8 chip on a small
// carrier board) and `ATtiny85-overlay.svg` (the interactive parts, same id convention as the Uno:
// pin-<n>-click/-state/-frame, led-l/-on, reset-click). Drawn from scratch, no third-party artwork.
// 4 units per mm. Pin numbers are ATTinyCore's (0–5 = PB0–PB5); PB5 is RESET and not interactive.
//   node scripts/generate-attiny85-svg.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const MM = 4;
const WIDTH = 32 * MM; // 128
const HEIGHT = 24 * MM; // 96
const MARGIN = 4;
const PITCH = 2.54 * MM;
const BOARD_COLOR = "#0f7391"; // replaced by the user's board colour at run time
const CHIP = { x: 48, y: 30, width: 32, height: 4 * PITCH + 4 };
const LEFT_X = 20;
const RIGHT_X = WIDTH - 20;
const FIRST_Y = CHIP.y + 7;

/** DIP-8 pins, physical order: 1–4 down the left, 8–5 down the right. `pin` = Arduino pin of ATTinyCore. */
const LEFT = [
  { dip: 1, label: "PB5", note: "RST · A0", reserved: true },
  { dip: 2, label: "PB3", note: "A3", pin: 3 },
  { dip: 3, label: "PB4", note: "A2 · ~", pin: 4 },
  { dip: 4, label: "GND", power: true },
];
const RIGHT = [
  { dip: 8, label: "VCC", power: true },
  { dip: 7, label: "PB2", note: "A1", pin: 2 },
  { dip: 6, label: "PB1", note: "~ · RX · L", pin: 1 },
  { dip: 5, label: "PB0", note: "~ · TX", pin: 0 },
];

const fmt = (value) => Number(value.toFixed(2));
const place = (row, x) => row.map((entry, index) => ({ ...entry, x, y: fmt(FIRST_Y + index * PITCH) }));
const pins = [...place(LEFT, LEFT_X), ...place(RIGHT, RIGHT_X)];
const LED = { l: { x: 100, y: 12 }, on: { x: 22, y: 12 } };
const RESET = { x: 64, y: 82 };

const header = (inner, extra = "") => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-MARGIN} ${-MARGIN} ${fmt(WIDTH + 2 * MARGIN)} ${fmt(HEIGHT + 2 * MARGIN)}">
${extra}${inner}</svg>
`;

const text = (x, y, size, content, { anchor = "middle", opacity } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="Arial, sans-serif" fill="#ffffff" text-anchor="${anchor}"${opacity ? ` fill-opacity="${opacity}"` : ""}>${content}</text>`;

function boardSvg() {
  const legs = pins
    .map(({ x, y }) => {
      const towardsChip = x < WIDTH / 2 ? CHIP.x : CHIP.x + CHIP.width;
      return `  <line x1="${x}" y1="${y}" x2="${towardsChip}" y2="${y}" stroke="#c9c9c9" stroke-width="1.4"/>`;
    })
    .join("\n");
  const pads = pins
    .map(({ x, y, label, note, pin, power, reserved }) => {
      const left = x < WIDTH / 2;
      const labelX = left ? x - 4 : x + 4;
      const anchor = left ? "end" : "start";
      const fill = pin === undefined ? "#8a8a8a" : "#d1c690";
      return [
        `  <circle cx="${x}" cy="${y}" r="2.1" fill="${fill}"/>`,
        `  ${text(labelX, y - 0.4, 3, label, { anchor, ...(power || reserved ? { opacity: 0.7 } : {}) })}`,
        note ? `  ${text(labelX, y + 3.2, 2.2, note, { anchor, opacity: 0.8 })}` : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n");
  return header(`  <!-- ATtiny85 (DIP-8) on a carrier board, drawn for UnoSim: ${WIDTH} x ${HEIGHT} units (32 x 24 mm) -->
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="3" fill="${BOARD_COLOR}"/>
${legs}
  <rect x="${CHIP.x}" y="${CHIP.y}" width="${CHIP.width}" height="${fmt(CHIP.height)}" rx="1.5" fill="#222222"/>
  <circle cx="${CHIP.x + 4}" cy="${CHIP.y + 3.5}" r="1.2" fill="#555555"/>
  <path d="M ${CHIP.x + CHIP.width / 2 - 3} ${CHIP.y} a 3 3 0 0 0 6 0" fill="#3a3a3a"/>
  ${text(CHIP.x + CHIP.width / 2, CHIP.y + CHIP.height / 2 + 1, 3.4, "ATtiny85")}
  ${text(CHIP.x + CHIP.width / 2, CHIP.y + CHIP.height / 2 + 5, 2.2, "8 MHz", { opacity: 0.8 })}
  <rect x="${LED.on.x}" y="${LED.on.y}" width="3.5" height="2.2" fill="#d8d8d8"/>${text(LED.on.x + 5, LED.on.y + 1.9, 2.2, "ON", { anchor: "start" })}
  <rect x="${LED.l.x}" y="${LED.l.y}" width="3.5" height="2.2" fill="#d8d8d8"/>${text(LED.l.x - 1.5, LED.l.y + 1.9, 2.2, "L", { anchor: "end" })}
  <rect x="${RESET.x - 4}" y="${RESET.y - 4}" width="8" height="8" rx="1" fill="#2a2a2a"/>
  <circle cx="${RESET.x}" cy="${RESET.y}" r="2.4" fill="#6b6b6b"/>
  ${text(RESET.x + 7, RESET.y + 1, 2.4, "RESET", { anchor: "start", opacity: 0.8 })}
  ${text(12, 90, 2.8, "ATTINY85", { anchor: "start" })}
  ${text(WIDTH - 12, 90, 2.4, "UnoSim", { anchor: "end", opacity: 0.8 })}
${pads}
`);
}

function overlaySvg() {
  const style = `  <defs>
    <style>
      .pin-stroke { fill: none; stroke: #9a916c; stroke-miterlimit: 5; stroke-width: 1px; }
      .click-area { fill: transparent; cursor: pointer; }
      .state-circle { fill-opacity: 0.8; }
      .input-frame { fill: none; stroke: #ffff00; stroke-width: 1; }
    </style>
    <filter id="glow-yellow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
`;
  const interactive = pins
    .filter(({ pin }) => pin !== undefined)
    .map(({ x, y, pin }) => `  <g id="pin-${pin}" data-pin="${pin}">
    <rect id="pin-${pin}-frame" class="input-frame" x="${fmt(x - 3.5)}" y="${fmt(y - 3.5)}" width="7" height="7" style="display:none"/>
    <circle id="pin-${pin}-state" cx="${x}" cy="${y}" r="2.5" fill="#000000"/>
    <rect id="pin-${pin}-click" class="click-area" x="${fmt(x - 4)}" y="${fmt(y - 4)}" width="8" height="8"/>
  </g>`)
    .join("\n");
  const led = (id, { x, y }) => `  <rect id="${id}" x="${x}" y="${y}" width="3.5" height="2.2" rx="0.9" ry="0.9" fill="transparent" fill-opacity="0"/>`;
  return header(`${[
    '  <g id="board-outline" opacity="0">',
    `    <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="3" fill="none" stroke="${BOARD_COLOR}" stroke-width="1"/>`,
    "  </g>",
    interactive,
    led("led-l", LED.l),
    led("led-on", LED.on),
    '  <g id="reset-button">',
    `    <circle id="reset-click" class="click-area" cx="${RESET.x}" cy="${RESET.y}" r="6"/>`,
    "  </g>",
  ].join("\n")}\n`, `${style}`);
}

const outDir = join(import.meta.dirname, "..", "client", "public");
writeFileSync(join(outDir, "ATtiny85.svg"), boardSvg());
writeFileSync(join(outDir, "ATtiny85-overlay.svg"), overlaySvg());
console.log(`wrote ATtiny85.svg and ATtiny85-overlay.svg (viewBox ${-MARGIN} ${-MARGIN} ${fmt(WIDTH + 2 * MARGIN)} ${fmt(HEIGHT + 2 * MARGIN)})`);
