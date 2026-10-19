// Draws the Arduino Nano for the board view (plan P4.4): `client/public/ArduinoNano.svg` (the board) and
// `ArduinoNano-overlay.svg` (the interactive parts, same id convention as the Uno: pin-<n>-click/-state/-frame,
// pin-A<k>-..., led-l/-on/-tx/-rx, reset-click). Drawn from scratch, no third-party artwork. 4 units per mm.
//   node scripts/generate-nano-svg.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const MM = 4;
const WIDTH = 43.2 * MM; // 172.8
const HEIGHT = 18 * MM; // 72
const MARGIN = 4;
const PITCH = 2.54 * MM;
const X0 = 21.6;
const TOP_Y = 6;
const BOTTOM_Y = HEIGHT - 6;
const BOARD_COLOR = "#0f7391"; // replaced by the user's board colour at run time

/** Header rows, left to right with the USB connector at the left. `pin` = Arduino pin name, `label` = silk screen. */
const TOP = [
  { label: "TX1", pin: "1" }, { label: "RX0", pin: "0" }, { label: "RST" }, { label: "GND" },
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => ({ label: `D${n}`, pin: String(n) })),
];
const BOTTOM = [
  { label: "VIN" }, { label: "GND" }, { label: "RST" }, { label: "5V" },
  ...[7, 6, 5, 4, 3, 2, 1, 0].map((n) => ({ label: `A${n}`, pin: `A${n}` })),
  { label: "REF" }, { label: "3V3" }, { label: "D13", pin: "13" },
];

const fmt = (value) => Number(value.toFixed(2));
const positions = (row, y) => row.map((entry, index) => ({ ...entry, x: fmt(X0 + index * PITCH), y }));
const pins = [...positions(TOP, TOP_Y), ...positions(BOTTOM, BOTTOM_Y)];

const header = (inner, extra = "") => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-MARGIN} ${-MARGIN} ${fmt(WIDTH + 2 * MARGIN)} ${fmt(HEIGHT + 2 * MARGIN)}">
${extra}${inner}</svg>
`;

function boardSvg() {
  const pads = pins
    .map(({ x, y, label, pin }) => {
      const labelY = y === TOP_Y ? y + 7.5 : y - 5.5;
      return `  <circle cx="${x}" cy="${y}" r="2.1" fill="${pin ? "#d1c690" : "#8a8a8a"}"/>\n  <text x="${x}" y="${labelY}" font-size="3" font-family="Arial, sans-serif" fill="#ffffff" text-anchor="middle"${pin === undefined ? ' fill-opacity="0.7"' : ""}>${label}</text>`;
    })
    .join("\n");
  return header(`  <!-- Arduino Nano, drawn for UnoSim: ${WIDTH} x ${HEIGHT} units (43.2 x 18 mm) -->
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="3" fill="${BOARD_COLOR}"/>
  <rect x="-3" y="22" width="19" height="28" rx="1.5" fill="#bdbdbd" stroke="#8a8a8a" stroke-width="0.6"/>
  <rect x="-3" y="26" width="13" height="20" rx="1" fill="#9b9b9b"/>
  <rect x="68" y="25" width="34" height="22" rx="1" fill="#222222"/>
  <text x="85" y="37" font-size="3.4" font-family="Arial, sans-serif" fill="#ffffff" text-anchor="middle">ATmega328P</text>
  <circle cx="70.5" cy="27.5" r="0.9" fill="#555555"/>
  <rect x="108" y="29" width="10" height="14" rx="1" fill="#c0c0c0"/>
  <text x="123" y="36.5" font-size="3.4" font-family="Arial, sans-serif" fill="#ffffff">NANO</text>
  <text x="123" y="42" font-size="2.6" font-family="Arial, sans-serif" fill="#ffffff" fill-opacity="0.8">UnoSim</text>
  <rect x="38" y="29" width="8" height="8" rx="1" fill="#2a2a2a"/>
  <rect x="26" y="40" width="3.5" height="2.2" fill="#d8d8d8"/><text x="31" y="41.9" font-size="2.2" font-family="Arial, sans-serif" fill="#ffffff">L</text>
  <rect x="26" y="45" width="3.5" height="2.2" fill="#d8d8d8"/><text x="31" y="46.9" font-size="2.2" font-family="Arial, sans-serif" fill="#ffffff">TX</text>
  <rect x="26" y="30" width="3.5" height="2.2" fill="#d8d8d8"/><text x="31" y="31.9" font-size="2.2" font-family="Arial, sans-serif" fill="#ffffff">RX</text>
  <rect x="26" y="35" width="3.5" height="2.2" fill="#d8d8d8"/><text x="31" y="36.9" font-size="2.2" font-family="Arial, sans-serif" fill="#ffffff">ON</text>
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
    <rect id="pin-${pin}-click" class="click-area" x="${fmt(x - 4)}" y="${fmt(y - 5)}" width="8" height="10"/>
  </g>`)
    .join("\n");
  const led = (id, y, fill = "transparent") => `  <rect id="${id}" x="26" y="${y}" width="3.5" height="2.2" rx="0.9" ry="0.9" fill="${fill}" fill-opacity="0"/>`;
  return header(`${[
    '  <g id="board-outline" opacity="0">',
    `    <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="3" fill="none" stroke="${BOARD_COLOR}" stroke-width="1"/>`,
    "  </g>",
    interactive,
    led("led-l", 40),
    led("led-tx", 45),
    led("led-rx", 30),
    led("led-on", 35),
    '  <g id="reset-button">',
    '    <circle id="reset-click" class="click-area" cx="42" cy="33" r="6"/>',
    "  </g>",
  ].join("\n")}\n`, `${style}`);
}

const outDir = join(import.meta.dirname, "..", "client", "public");
writeFileSync(join(outDir, "ArduinoNano.svg"), boardSvg());
writeFileSync(join(outDir, "ArduinoNano-overlay.svg"), overlaySvg());
console.log(`wrote ArduinoNano.svg and ArduinoNano-overlay.svg (viewBox ${-MARGIN} ${-MARGIN} ${fmt(WIDTH + 2 * MARGIN)} ${fmt(HEIGHT + 2 * MARGIN)})`);
