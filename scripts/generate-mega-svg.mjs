// Builds the Mega view from the supplied artwork, never from an approximate schematic.
// The source stays untouched; the quarter scale keeps runtime labels in the other boards' unit range.
// Run: npm run generate:mega-svg
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { MEGA2560 } from "../packages/avr-emulator/src/boards/mega2560-board.ts";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "assets/boards/ArduinoMega.source.svg"), "utf8");
const dom = new JSDOM(source, { contentType: "image/svg+xml" });
const document = dom.window.document;
const svg = document.documentElement;
const SCALE = 0.25;
const [, , sourceWidth, sourceHeight] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
const viewBox = `0 0 ${sourceWidth * SCALE} ${sourceHeight * SCALE}`;
const fmt = (value) => Number(value.toFixed(6));
const n = (element, attribute) => Number(element.getAttribute(attribute));

function socket(element) {
  const surround = element.previousElementSibling;
  if (surround?.tagName !== "rect") throw new Error("Mega contact has no rectangular surround");
  const box = (node) => Object.fromEntries(["x", "y", "width", "height"].map(key => [key, n(node, key)]));
  const hole = box(element);
  return { element, hole, surround: box(surround), x: hole.x + hole.width / 2, y: hole.y + hole.height / 2 };
}

const sockets = [...document.querySelectorAll("#pins > rect.cls-28")].map(socket);
const top = sockets.filter(({ hole, y }) => hole.width > hole.height && y < sourceHeight / 2).sort((a, b) => a.x - b.x);
const bottom = sockets.filter(({ hole, y }) => hole.width > hole.height && y > sourceHeight / 2).sort((a, b) => a.x - b.x);
const right = sockets.filter(({ hole }) => hole.width < hole.height);
const midColumn = (Math.min(...right.map(({ x }) => x)) + Math.max(...right.map(({ x }) => x))) / 2;
const columns = [right.filter(({ x }) => x < midColumn), right.filter(({ x }) => x > midColumn)]
  .map(column => column.toSorted((a, b) => a.y - b.y));
if (top.length !== 26 || bottom.length !== 24 || columns.some(column => column.length !== 18)) {
  throw new Error("Mega artwork's headers changed; review the pin assignment before generating the overlay");
}

const pins = new Map();
const assign = (name, pad) => {
  pad.element.dataset.megaContact = name;
  pins.set(name, pad);
};
[13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 14, 15, 16, 17, 18, 19, 20, 21]
  .forEach((pin, index) => assign(String(pin), top[index + 4]));
for (let channel = 0; channel < 16; channel++) assign(`A${channel}`, bottom[channel + 8]);
for (let row = 0; row < 16; row++) {
  assign(String(22 + row * 2), columns[0][row + 1]);
  assign(String(23 + row * 2), columns[1][row + 1]);
}
const aliases = [{ pin: "21", alias: "scl", pad: top[0] }, { pin: "20", alias: "sda", pad: top[1] }];
for (const { pin, alias, pad } of aliases) pad.element.dataset.megaContact = `${pin}-${alias}`;

const lights = [["l", "led_l_off"], ["on", "led_l_off-2"], ["tx", "led_l_off-3"], ["rx", "led_l_off-4"]]
  .map(([name, id]) => ({ name, element: document.getElementById(id) }));
const reset = document.getElementById("button_off");
// Match the Uno reset cap and its darker edge, preserving the supplied geometry.
reset.setAttribute("style", "fill:#852725");
document.getElementById("button_on").setAttribute("style", "fill:#641d1c");

// The export contains duplicate ids and permanently lit LED glows, including an invalid
// "display:none" class. Only the runtime overlay should provide these lights.
[...document.querySelectorAll('[id="led_l_on"]')].forEach((element, index) => {
  element.id = `led_glow_${index}`;
  element.setAttribute("display", "none");
  element.dataset.sourceLedGlow = "";
});

// Namespace the illustrator's generic classes, masks and ids to protect other inline SVGs.
const sourceIds = [...document.querySelectorAll("[id]")].map(element => element.id);
for (const element of document.querySelectorAll("[id]")) element.id = `mega-source-${element.id}`;
for (const { element } of sockets) {
  const name = element.dataset.megaContact;
  if (name) element.id = `mega-pad-${name}`;
}
const artwork = document.createElementNS("http://www.w3.org/2000/svg", "g");
artwork.id = "mega-artwork";
artwork.setAttribute("transform", `scale(${SCALE})`);
// Snapshot the live collection before moving its members to another parent.
const sourceChildren = Array.from(svg.children);
for (const child of sourceChildren) if (child.tagName !== "defs") artwork.append(child);
svg.append(artwork);
svg.setAttribute("viewBox", viewBox);

// Keep the supplied outline lettering intact. Add the Uno's PWM wave next to
// the corresponding labels, using the same hardware capabilities as the UI.
const pwmMarkers = document.createElementNS("http://www.w3.org/2000/svg", "g");
pwmMarkers.id = "mega-pwm-markers";
for (const [name, value] of Object.entries({ fill: "none", stroke: "#fff", "stroke-width": "0.55", "stroke-linecap": "round", "pointer-events": "none" })) {
  pwmMarkers.setAttribute(name, value);
}
for (const { pin } of MEGA2560.pins.filter(pin => pin.pwm)) {
  const pad = pins.get(String(pin));
  const topRow = pin <= 13;
  let labelOffset = 0;
  if (!topRow) labelOffset = pin % 2 === 0 ? -18.75 : 6.3;
  const x = pad.x * SCALE + labelOffset;
  const y = topRow ? 27.5 : pad.y * SCALE;
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "path");
  marker.dataset.pwmPin = String(pin);
  marker.setAttribute("d", "M -1.8 0 C -0.6 -1.8 0.6 1.8 1.8 0");
  marker.setAttribute("transform", `translate(${fmt(x)} ${fmt(y)})${topRow ? " rotate(-90)" : ""}`);
  pwmMarkers.append(marker);
}
svg.append(pwmMarkers);
let board = new dom.window.XMLSerializer().serializeToString(svg);
for (const id of sourceIds) board = board.replaceAll(`url(#${id})`, `url(#mega-source-${id})`);
board = board.replaceAll(/\bcls-(\d+)\b/g, "mega-cls-$1")
  .replaceAll("#41969c", "#0f7391") // preserve the existing configurable PCB colour
  .replaceAll("><", ">\n<");

function pinOverlay(name, { x, y, hole, surround }) {
  const box = Object.fromEntries(Object.entries(surround).map(([key, value]) => [key, value * SCALE]));
  box.x = x * SCALE - box.width / 2;
  box.y = y * SCALE - box.height / 2;
  return `  <g id="pin-${name}" data-pin="${name}">
    <title>${name.startsWith("A") ? name : `D${name}`}</title>
    <rect id="pin-${name}-frame" class="input-frame" x="${fmt(box.x - 0.25)}" y="${fmt(box.y - 0.25)}" width="${fmt(box.width + 0.5)}" height="${fmt(box.height + 0.5)}" style="display:none"/>
    <circle id="pin-${name}-state" cx="${fmt(x * SCALE)}" cy="${fmt(y * SCALE)}" r="${fmt(Math.min(hole.width, hole.height) * SCALE / 2)}" fill="transparent"/>
    <rect id="pin-${name}-click" class="click-area" x="${fmt(box.x - 0.25)}" y="${fmt(box.y - 0.25)}" width="${fmt(box.width + 0.5)}" height="${fmt(box.height + 0.5)}"/>
  </g>`;
}

function aliasOverlay({ pin, alias, pad }) {
  const original = pins.get(pin);
  const x = fmt((pad.x - original.x) * SCALE);
  const y = fmt((pad.y - original.y) * SCALE);
  return `  <g id="pin-${pin}-${alias}" data-pin="${pin}">
    <title>${alias.toUpperCase()} (D${pin})</title>
${["frame", "state", "click"].map(part => `    <use id="pin-${pin}-${alias}-${part}" href="#pin-${pin}-${part}" x="${x}" y="${y}"/>`).join("\n")}
  </g>`;
}

function ledOverlay({ name, element }) {
  const geometry = ["x", "y", "width", "height"].map(attribute => `${attribute}="${fmt(n(element, attribute) * SCALE)}"`).join(" ");
  return `  <rect id="led-${name}" ${geometry} fill="transparent" fill-opacity="0" pointer-events="none"/>`;
}

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
${[...pins].map(([name, pad]) => pinOverlay(name, pad)).join("\n")}
${aliases.map(aliasOverlay).join("\n")}
${lights.map(ledOverlay).join("\n")}
  <circle id="reset-click" class="click-area" ${["cx", "cy", "r"].map(attribute => `${attribute}="${fmt(n(reset, attribute) * SCALE)}"`).join(" ")}><title>Reset</title></circle>
</svg>
`;

writeFileSync(join(root, "client/public/ArduinoMega.svg"), `${board}\n`);
writeFileSync(join(root, "client/public/ArduinoMega-overlay.svg"), overlay);
dom.window.close();
console.log(`wrote supplied Mega artwork and overlay (${pins.size} pins + ${aliases.length} SDA/SCL sockets, viewBox ${viewBox})`);
