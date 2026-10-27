// Bare ATtiny85 DIP-8 package: no carrier board, external LEDs or reset switch.
// Overlay targets sit on the five usable metal leads; PB5/RESET and power stay passive.
// Run: npm run generate:attiny85-svg
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ATTINY85_BOARD } from "../packages/avr-emulator/src/boards/attiny85-board.ts";

const WIDTH = 168;
const HEIGHT = 112;
const BODY = "M 60 16 H 77 A 7 7 0 0 0 91 16 H 108 Q 112 16 112 20 V 92 Q 112 96 108 96 H 60 Q 56 96 56 92 V 20 Q 56 16 60 16 Z";
const LEFT = [
  { dip: 1, label: "PB5", note: "RESET / A0" },
  { dip: 2, label: "PB3", note: "A3", pin: 3 },
  { dip: 3, label: "PB4", note: "A2 / PWM", pin: 4 },
  { dip: 4, label: "GND" },
];
const RIGHT = [
  { dip: 8, label: "VCC" },
  { dip: 7, label: "PB2", note: "A1", pin: 2 },
  { dip: 6, label: "PB1", note: "PWM / RX", pin: 1 },
  { dip: 5, label: "PB0", note: "PWM / TX", pin: 0 },
];
const place = (entries, side) => entries.map((entry, index) => ({ ...entry, side, x: side === "left" ? 42 : 126, y: 26 + index * 20 }));
const pins = [...place(LEFT, "left"), ...place(RIGHT, "right")];
const pwmPins = new Set(ATTINY85_BOARD.pins.filter(pin => pin.pwm).map(pin => pin.pin));
const header = (content) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}">\n${content}</svg>\n`;

function leadPath({ side, y }) {
  return side === "left"
    ? `M 56 ${y - 3} H 51 L 49 ${y - 4} H 36 Q 35 ${y - 4} 35 ${y - 3} V ${y + 3} Q 35 ${y + 4} 36 ${y + 4} H 49 L 51 ${y + 3} H 56 Z`
    : `M 112 ${y - 3} H 117 L 119 ${y - 4} H 132 Q 133 ${y - 4} 133 ${y - 3} V ${y + 3} Q 133 ${y + 4} 132 ${y + 4} H 119 L 117 ${y + 3} H 112 Z`;
}

function boardSvg() {
  const legs = pins.map((pin) => {
    const left = pin.side === "left";
    const pwm = pwmPins.has(pin.pin);
    return `  <g>
    <title>Physical pin ${pin.dip}: ${pin.label}${pin.note ? ` (${pin.note})` : ""}</title>
    <path id="attiny-lead-${pin.dip}" d="${leadPath(pin)}" fill="url(#attiny-lead-fill)" stroke="#848a91" stroke-width="0.3"/>
    <rect id="attiny-contact-${pin.dip}" x="${pin.x - 6}" y="${pin.y - 3}" width="12" height="6" rx="0.5" fill="url(#attiny-lead-face)"/>
    <path d="M ${left ? 36 : 120} ${pin.y - 2.5} H ${left ? 48 : 132}" stroke="#f1f3f5" stroke-opacity="0.7" stroke-width="0.4"/>
    <text${pwm ? ` data-pwm-pin="${pin.pin}"` : ""} x="${left ? 30 : 138}" y="${pin.y - 0.6}" font-size="5.5" text-anchor="${left ? "end" : "start"}" fill="#d7dce2">${pin.dip} · ${pwm ? "~" : ""}${pin.label}</text>
${pin.note ? `    <text x="${left ? 30 : 138}" y="${pin.y + 6.8}" font-size="5.5" text-anchor="${left ? "end" : "start"}" fill="#b8c1cc">${pin.note}</text>` : ""}
  </g>`;
  }).join("\n");
  return header(`  <defs>
    <linearGradient id="attiny-body-fill" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#4b4e53"/><stop offset="0.16" stop-color="#303237"/>
      <stop offset="0.7" stop-color="#222428"/><stop offset="1" stop-color="#111316"/>
    </linearGradient>
    <linearGradient id="attiny-lead-fill" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#f0f2f4"/><stop offset="0.2" stop-color="#cbd0d6"/>
      <stop offset="0.65" stop-color="#a8afb8"/><stop offset="1" stop-color="#686f79"/>
    </linearGradient>
    <linearGradient id="attiny-lead-face" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#dbe0e5"/><stop offset="0.5" stop-color="#bfc6ce"/><stop offset="1" stop-color="#929aa5"/>
    </linearGradient>
    <radialGradient id="attiny-marker-fill">
      <stop stop-color="#151619"/><stop offset="0.8" stop-color="#202226"/><stop offset="1" stop-color="#62666d"/>
    </radialGradient>
    <filter id="attiny-shadow" x="-20%" y="-15%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.3"/></filter>
  </defs>
  <g font-family="Arial, sans-serif">
    <rect x="55" y="19" width="59" height="79" rx="5" fill="#000000" opacity="0.45" filter="url(#attiny-shadow)"/>
${legs}
    <path id="attiny-package" d="${BODY}" fill="url(#attiny-body-fill)" stroke="#141619" stroke-width="0.7"/>
    <path d="M 58 25 V 91 Q 58 94 61 94 H 107" fill="none" stroke="#101215" stroke-width="1.2"/>
    <path d="M 60 18 H 76 M 92 18 H 107 Q 110 18 110 21 V 89" fill="none" stroke="#686c73" stroke-opacity="0.55" stroke-width="0.6"/>
    <path id="attiny-notch" d="M 77 16 A 7 7 0 0 0 91 16" fill="none" stroke="#0c0d10" stroke-width="1.1"/>
    <circle id="attiny-pin1-marker" cx="64.5" cy="30.5" r="2.4" fill="url(#attiny-marker-fill)"/>
    <g fill="#b5b8be" text-anchor="middle" font-family="monospace">
      <text x="84" y="52" font-size="6.4" letter-spacing="0.3">ATTINY85</text>
      <text x="84" y="61" font-size="4.2" letter-spacing="0.8" fill="#858b94">DIP-8</text>
      <path d="M 72 68 H 96" stroke="#101215" stroke-width="0.4"/>
    </g>
  </g>
`);
}

function overlaySvg() {
  return header(`  <defs>
    <style>
      .attiny-click-area { fill: transparent; cursor: pointer; }
      .attiny-input-frame { fill: none; stroke: #ffff00; stroke-width: 0.7; pointer-events: none; }
      .attiny-pin-state { fill-opacity: 0.9; pointer-events: none; }
      .attiny-pin-state[fill="var(--color-black)"], .attiny-pin-state[fill="transparent"] { fill-opacity: 0; }
    </style>
${["red", "yellow"].map(color => `    <filter id="glow-${color}" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="1" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`).join("\n")}
  </defs>
${pins.filter(pin => pin.pin !== undefined).map(({ pin, x, y, label, dip }) => `  <g id="pin-${pin}" data-pin="${pin}">
    <title>${label}, physical pin ${dip}</title>
    <rect id="pin-${pin}-frame" class="attiny-input-frame" x="${x - 7}" y="${y - 4}" width="14" height="8" rx="0.8" style="display:none"/>
    <circle id="pin-${pin}-state" class="attiny-pin-state" cx="${x}" cy="${y}" r="2.3" fill="transparent"/>
    <rect id="pin-${pin}-click" class="attiny-click-area" x="${x - 8}" y="${y - 5}" width="16" height="10"/>
  </g>`).join("\n")}
`);
}

const output = join(import.meta.dirname, "..", "client/public");
writeFileSync(join(output, "ATtiny85.svg"), boardSvg());
writeFileSync(join(output, "ATtiny85-overlay.svg"), overlaySvg());
console.log(`wrote bare ATtiny85 DIP-8 and pin overlay (viewBox 0 0 ${WIDTH} ${HEIGHT})`);
