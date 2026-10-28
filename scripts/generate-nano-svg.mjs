// Builds the supplied Nano artwork and its overlay from the actual pad, LED and reset contours.
// The source is retained byte for byte in assets/boards/ArduinoNano.source.svg.
// Run: npm run generate:nano-svg
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { NANO } from "../packages/avr-emulator/src/boards/atmega328p-boards.ts";

const root = join(import.meta.dirname, "..");
const dom = new JSDOM(readFileSync(join(root, "assets/boards/ArduinoNano.source.svg"), "utf8"), { contentType: "image/svg+xml" });
const document = dom.window.document;
const svg = document.documentElement;
const NS = "http://www.w3.org/2000/svg";
// Trim the unused canvas around the supplied artwork, retaining a margin around every painted part.
const CROP = { x: 40, y: 27, width: 370, height: 148 };
const SCALE = 0.5;
const fmt = (value) => Number(value.toFixed(6));
const x = (value) => fmt((value - CROP.x) * SCALE);
const y = (value) => fmt((value - CROP.y) * SCALE);
const size = (value) => fmt(value * SCALE);
const NUMBER = String.raw`[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?`;

/** These particular exported paths consist of closed contours. After z, a relative m starts at the
 * preceding contour's start. Make those starts absolute before separating the contacts. */
function contours(path) {
  let startX = 0;
  let startY = 0;
  return [...path.getAttribute("d").matchAll(new RegExp(String.raw`([mM])\s*(${NUMBER})[\s,]+(${NUMBER})([^mM]*)`, "g"))].map(([, command, dx, dy, rest]) => {
    if (!/[zZ]\s*$/.test(rest)) throw new Error("Nano source contour is not closed");
    startX = Number(dx) + (command === "m" ? startX : 0);
    startY = Number(dy) + (command === "m" ? startY : 0);
    return { x: startX, y: startY, rest: rest.trim() };
  });
}

function circle(contour) {
  // A sticky scan consumes each number once instead of retrying an unanchored
  // numeric expression at every character of the supplied path.
  const values = [];
  const pattern = new RegExp(NUMBER, "iy");
  for (let offset = 0; offset < contour.rest.length;) {
    pattern.lastIndex = offset;
    const match = pattern.exec(contour.rest);
    if (match) {
      values.push(Number(match[0]));
      offset = pattern.lastIndex;
    } else offset++;
  }
  const radius = values[0];
  const endpoints = [[radius, radius], [-radius, radius], [-radius, -radius], [radius, -radius]];
  if (!/^a\s/i.test(contour.rest) || values.length !== 28 || endpoints.some(([dx, dy], index) => {
    const expected = [radius, radius, 0, 0, 1, dx, dy];
    return expected.some((value, offset) => Math.abs(values[index * 7 + offset] - value) > 1e-8);
  })) throw new Error("Nano source circle changed; review its geometry");
  return { cx: contour.x, cy: contour.y + radius, r: radius };
}

function rectangle(contour) {
  let px = contour.x;
  let py = contour.y;
  const points = [[px, py]];
  const pattern = new RegExp(String.raw`([hHvV])\s*(${NUMBER})`, "g");
  if (contour.rest.replaceAll(pattern, "").replaceAll(/[zZ\s,]/g, "")) throw new Error("Nano source rectangle changed");
  for (const [, command, value] of contour.rest.matchAll(pattern)) {
    if (command.toLowerCase() === "h") px = Number(value) + (command === "h" ? px : 0);
    else py = Number(value) + (command === "v" ? py : 0);
    points.push([px, py]);
  }
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function shape(tag, attributes) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, typeof value === "number" ? String(fmt(value)) : value);
  return element;
}

function separate(path, parts) {
  const group = shape("g", { id: path.id, style: path.getAttribute("style") });
  for (const part of parts) group.append(part);
  path.replaceWith(group);
}

// The source puts every pad in one path. Split only its simple circle/square contours; their fill and
// stroke stay inherited from that path. The drawing's labels determine the order, not the old view.
const padPath = document.getElementById("path21");
const pads = contours(padPath).map(contour => {
  const round = /^a\s/i.test(contour.rest);
  const geometry = round ? circle(contour) : rectangle(contour);
  return { element: shape(round ? "circle" : "rect", geometry),
    cx: round ? geometry.cx : geometry.x + geometry.width / 2,
    cy: round ? geometry.cy : geometry.y + geometry.height / 2, r: round ? geometry.r : geometry.width / 2 };
});
const rows = [pads.filter(pad => pad.cy < 100), pads.filter(pad => pad.cy >= 100)].map(row => row.toSorted((a, b) => a.cx - b.cx));
if (pads.length !== 30 || rows.some(row => row.length !== 15)) throw new Error("Nano source headers changed; review the pin order");
const names = [
  ["12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", null, null, "0", "1"],
  ["13", null, null, "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", null, null, null, null],
];
const pins = new Map();
rows.forEach((row, index) => row.forEach((pad, column) => {
  const name = names[index][column];
  if (name !== null) {
    pad.element.id = `nano-pad-${name}`;
    pins.set(name, pad);
  }
}));
separate(padPath, pads.map(pad => pad.element));

const ledPath = document.getElementById("path18");
const lenses = contours(ledPath).map(rectangle);
if (lenses.length !== 4) throw new Error("Nano source LEDs changed");
const lights = ["tx", "rx", "on", "l"].map((name, index) => ({ name, ...lenses[index] }));
separate(ledPath, lights.map(({ name, ...box }) => shape("rect", { id: `nano-led-${name}`, ...box })));
const resetPath = document.getElementById("path24");
const reset = circle(contours(resetPath)[0]);
// Same dark-red cap and edge as the Uno; retain the source button's contour.
resetPath.replaceWith(shape("circle", { id: "nano-reset-surface", style: resetPath.getAttribute("style").replace("fill:#f2f2f2", "fill:#852725").replace("stroke:#333333", "stroke:#641d1c"), ...reset }));

for (const element of document.querySelectorAll("[id]")) if (!element.id.startsWith("nano-")) element.id = `nano-source-${element.id}`;
// Snapshot the live collection before removing or reparenting source children.
const sourceChildren = Array.from(svg.children);
for (const element of sourceChildren) if (element.localName === "namedview") element.remove();
const artwork = shape("g", { id: "nano-artwork", transform: "matrix(0.5 0 0 0.5 -20 -13.5)" });
const drawingChildren = Array.from(svg.children);
for (const element of drawingChildren) if (element.localName !== "defs" && element.localName !== "title") artwork.append(element);
svg.append(artwork);
const viewBox = `0 0 ${size(CROP.width)} ${size(CROP.height)}`;
// Do not carry the editor's xmlns:svg alias onto the output root: XMLSerializer can otherwise emit
// <svg:svg>, which HTML insertion treats as an unknown HTML element instead of an SVG viewport.
const output = shape("svg", { id: svg.id, viewBox });
output.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns", NS);
output.append(...svg.children);
// The supplied labels are paths. A separate wave below each PWM label preserves
// the lettering and clears the nearby crystal, LED and contact contours.
const pwmMarkers = shape("g", { id: "nano-pwm-markers", fill: "none", stroke: "#fff", "stroke-width": "0.45", "stroke-linecap": "round", "pointer-events": "none" });
for (const { pin } of NANO.pins.filter(pin => pin.pwm)) {
  const pad = pins.get(String(pin));
  pwmMarkers.append(shape("path", { "data-pwm-pin": String(pin), d: "M -1.5 0 C -0.5 -1.5 0.5 1.5 1.5 0", transform: `translate(${x(pad.cx)} 14)` }));
}
output.append(pwmMarkers);
const board = new dom.window.XMLSerializer().serializeToString(output)
  .replaceAll("#017e7b", "#0f7391") // retain the existing configurable PCB colour
  .replaceAll("><", ">\n<")
  .split("\n").map(line => line.trimEnd()).join("\n");

const overlay = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <defs>
    <style>
      .click-area { fill: transparent; cursor: pointer; }
      .input-frame { fill: none; stroke: #ffff00; stroke-width: 0.7; pointer-events: none; }
    </style>
${["yellow", "green", "red"].map(color => `    <filter id="glow-${color}" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="1" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`).join("\n")}
  </defs>
${[...pins].map(([name, pad]) => `  <g id="pin-${name}" data-pin="${name}">
    <title>${name.startsWith("A") ? name : `D${name}`}</title>
    <rect id="pin-${name}-frame" class="input-frame" x="${fmt(x(pad.cx) - 3.5)}" y="${fmt(y(pad.cy) - 3.5)}" width="7" height="7" style="display:none"/>
    <circle id="pin-${name}-state" cx="${x(pad.cx)}" cy="${y(pad.cy)}" r="${size(pad.r)}" fill="transparent"/>
    <rect id="pin-${name}-click" class="click-area" x="${fmt(x(pad.cx) - 4.25)}" y="${fmt(y(pad.cy) - 4.25)}" width="8.5" height="8.5"/>
  </g>`).join("\n")}
${lights.map(light => `  <rect id="led-${light.name}" x="${x(light.x)}" y="${y(light.y)}" width="${size(light.width)}" height="${size(light.height)}" fill="transparent" fill-opacity="0" pointer-events="none"/>`).join("\n")}
  <circle id="reset-click" class="click-area" cx="${x(reset.cx)}" cy="${y(reset.cy)}" r="${size(reset.r)}"><title>Reset</title></circle>
</svg>
`;
writeFileSync(join(root, "client/public/ArduinoNano.svg"), `${board}\n`);
writeFileSync(join(root, "client/public/ArduinoNano-overlay.svg"), overlay);
dom.window.close();
console.log(`wrote supplied Nano artwork and overlay (${pins.size} pins, viewBox ${viewBox})`);
