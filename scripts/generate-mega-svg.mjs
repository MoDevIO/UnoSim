// Draws the Arduino Mega 2560 for the board view (plan P5.4): `client/public/ArduinoMega.svg` (the board) and
// `ArduinoMega-overlay.svg` (the interactive parts, same id convention as the Uno and the Nano: pin-<n>-click/-state/-frame,
// pin-A<k>-..., led-l/-on/-tx/-rx, reset-click). Drawn from scratch, no third-party artwork. 4 units per mm.
//   node scripts/generate-mega-svg.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const MM = 4;
const WIDTH = 101.6 * MM; // 406.4
const HEIGHT = 53.3 * MM; // 213.2
const MARGIN = 4;
const PITCH = 2.54 * MM;
const X0 = 70;
const GAP = 8;
const TOP_Y = 8;
const BOTTOM_Y = HEIGHT - 8;
const RIGHT_X = [WIDTH - 20, WIDTH - 9.84];
const RIGHT_Y0 = 40;
const BOARD_COLOR = "#0f7391"; // replaced by the user's board colour at run time

/** One header block: `label` = silk screen, `pin` = Arduino pin name in the sketch (absent for power pins). */
const digital = (n, label = `D${n}`) => ({ label, pin: String(n) });
const analog = (k) => ({ label: `A${k}`, pin: `A${k}` });
const power = (label) => ({ label });

const TOP_BLOCKS = [
  [power("AREF"), power("GND"), ...[13, 12, 11, 10, 9, 8].map((n) => digital(n))],
  [7, 6, 5, 4, 3, 2, 1, 0].map((n) => digital(n)),
  [digital(14, "TX3"), digital(15, "RX3"), digital(16, "TX2"), digital(17, "RX2"), digital(18, "TX1"), digital(19, "RX1"), digital(20, "SDA"), digital(21, "SCL")],
];
const BOTTOM_BLOCKS = [
  [power("NC"), power("IOREF"), power("RST"), power("3V3"), power("5V"), power("GND"), power("GND"), power("VIN")],
  Array.from({ length: 8 }, (_, k) => analog(k)),
  Array.from({ length: 8 }, (_, k) => analog(k + 8)),
];

const fmt = (value) => Number(value.toFixed(2));

function rowPositions(blocks, y) {
  const out = [];
  let x = X0;
  for (const block of blocks) {
    for (const entry of block) {
      out.push({ ...entry, x: fmt(x), y });
      x += PITCH;
    }
    x += GAP;
  }
  return out;
}

/** The two-row header on the right edge: pins 22–53 (even in the left column, odd in the right), 5V on top and GND at the bottom. */
function rightPositions() {
  const out = [];
  for (let row = 0; row < 16; row++) {
    const y = fmt(RIGHT_Y0 + row * PITCH);
    out.push({ ...digital(22 + 2 * row), x: fmt(RIGHT_X[0]), y }, { ...digital(23 + 2 * row), x: fmt(RIGHT_X[1]), y });
  }
  const top = fmt(RIGHT_Y0 - PITCH);
  const bottom = fmt(RIGHT_Y0 + 16 * PITCH);
  out.push(
    { ...power("5V"), x: fmt(RIGHT_X[0]), y: top }, { ...power("5V"), x: fmt(RIGHT_X[1]), y: top },
    { ...power("GND"), x: fmt(RIGHT_X[0]), y: bottom }, { ...power("GND"), x: fmt(RIGHT_X[1]), y: bottom },
  );
  return out;
}

const pins = [...rowPositions(TOP_BLOCKS, TOP_Y), ...rowPositions(BOTTOM_BLOCKS, BOTTOM_Y), ...rightPositions()];

const header = (inner, extra = "") => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-MARGIN} ${-MARGIN} ${fmt(WIDTH + 2 * MARGIN)} ${fmt(HEIGHT + 2 * MARGIN)}">
${extra}${inner}</svg>
`;

const FONT = 'font-family="Arial, sans-serif"';

function labelPosition({ x, y }) {
  if (x > WIDTH - 40) return { x: x < WIDTH - 15 ? x - 5.2 : x + 5.2, y: y + 1, anchor: x < WIDTH - 15 ? "end" : "start" };
  return { x, y: y === TOP_Y ? y + 7.5 : y - 5.5, anchor: "middle" };
}

function boardSvg() {
  const pads = pins
    .map((entry) => {
      const { x, y, label, pin } = entry;
      const at = labelPosition(entry);
      return `  <circle cx="${x}" cy="${y}" r="2.1" fill="${pin ? "#d1c690" : "#8a8a8a"}"/>\n  <text x="${at.x}" y="${at.y}" font-size="3" ${FONT} fill="#ffffff" text-anchor="${at.anchor}"${pin === undefined ? ' fill-opacity="0.7"' : ""}>${label}</text>`;
    })
    .join("\n");
  const led = (y, label, x = 40) => `  <rect x="${x}" y="${y}" width="5" height="2.6" fill="#d8d8d8"/><text x="${x + 6.5}" y="${y + 2.2}" font-size="2.4" ${FONT} fill="#ffffff">${label}</text>`;
  return header(`  <!-- Arduino Mega 2560, drawn for UnoSim: ${WIDTH} x ${HEIGHT} units (101.6 x 53.3 mm) -->
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="3" fill="${BOARD_COLOR}"/>
  <rect x="-3" y="30" width="34" height="38" rx="1.5" fill="#bdbdbd" stroke="#8a8a8a" stroke-width="0.6"/>
  <rect x="-3" y="36" width="26" height="26" rx="1" fill="#9b9b9b"/>
  <rect x="-3" y="${HEIGHT - 70}" width="40" height="46" rx="1.5" fill="#222222"/>
  <rect x="-3" y="${HEIGHT - 64}" width="30" height="34" rx="1" fill="#3a3a3a"/>
  <rect x="140" y="82" width="52" height="52" rx="1" fill="#222222"/>
  <circle cx="146" cy="88" r="1.3" fill="#555555"/>
  <text x="166" y="106" font-size="4" ${FONT} fill="#ffffff" text-anchor="middle">ATmega2560</text>
  <text x="166" y="113" font-size="3" ${FONT} fill="#ffffff" fill-opacity="0.8" text-anchor="middle">16 MHz</text>
  <rect x="82" y="98" width="26" height="26" rx="1" fill="#2a2a2a"/>
  <text x="95" y="112" font-size="3" ${FONT} fill="#ffffff" text-anchor="middle">16U2</text>
  <rect x="116" y="150" width="12" height="16" rx="1" fill="#c0c0c0"/>
  <circle cx="52" cy="104" r="6" fill="#c0c0c0" stroke="#8a8a8a" stroke-width="0.6"/>
  <circle cx="52" cy="104" r="3.4" fill="#b02a2a"/>
  <rect x="226" y="120" width="40" height="26" rx="1" fill="#2a2a2a"/>
  <text x="246" y="135" font-size="3" ${FONT} fill="#ffffff" text-anchor="middle">UnoSim</text>
  <text x="290" y="150" font-size="7" ${FONT} fill="#ffffff" text-anchor="middle">MEGA 2560</text>
${led(66, "TX")}
${led(72, "RX")}
${led(78, "L")}
${led(84, "ON")}
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
    <rect id="pin-${pin}-click" class="click-area" x="${fmt(x - 4)}" y="${fmt(y - 4.6)}" width="8" height="9.2"/>
  </g>`)
    .join("\n");
  const led = (id, y) => `  <rect id="${id}" x="40" y="${y}" width="5" height="2.6" rx="1" ry="1" fill="transparent" fill-opacity="0"/>`;
  return header(`${[
    '  <g id="board-outline" opacity="0">',
    `    <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="3" fill="none" stroke="${BOARD_COLOR}" stroke-width="1"/>`,
    "  </g>",
    interactive,
    led("led-tx", 66),
    led("led-rx", 72),
    led("led-l", 78),
    led("led-on", 84),
    '  <g id="reset-button">',
    '    <circle id="reset-click" class="click-area" cx="52" cy="104" r="7"/>',
    "  </g>",
  ].join("\n")}\n`, style);
}

const outDir = join(import.meta.dirname, "..", "client", "public");
writeFileSync(join(outDir, "ArduinoMega.svg"), boardSvg());
writeFileSync(join(outDir, "ArduinoMega-overlay.svg"), overlaySvg());
console.log(`wrote ArduinoMega.svg and ArduinoMega-overlay.svg (viewBox ${-MARGIN} ${-MARGIN} ${fmt(WIDTH + 2 * MARGIN)} ${fmt(HEIGHT + 2 * MARGIN)})`);
