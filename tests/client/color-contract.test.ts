import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The color contract of the style guide (client/src/STYLE_GUIDE.md): tokens that exist, contrast of the role
 * pairs computed from the token values, red only for errors, and error surfaces only in the error role.
 * The browser side (computed colors at rest and on hover) is e2e/color-contrast.spec.ts.
 */

const ROOT = process.cwd();
const CSS = ["client/src/index.css", "client/src/styles/theme-tokens.css"].map((file) => readFileSync(path.join(ROOT, file), "utf8")).join("\n");
const TAILWIND = readFileSync(path.join(ROOT, "tailwind.config.ts"), "utf8");

function tokens(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name, value] of CSS.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) map.set(name!, value!.trim());
  return map;
}

type Rgb = readonly [number, number, number];

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** A token's color, following `var()` references; hex and hsl, as index.css writes them. */
function color(name: string, map = tokens(), depth = 0): Rgb {
  const value = map.get(name);
  if (value === undefined || depth > 5) throw new Error(`${name} is not defined`);
  const reference = /^var\((--[a-z0-9-]+)\)$/i.exec(value);
  if (reference) return color(reference[1]!, map, depth + 1);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((index) => Number.parseInt(hex[1]!.slice(index, index + 2), 16)) as unknown as Rgb;
  const hsl = /^hsl\((\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)%[ ,]+(\d+(?:\.\d+)?)%\)$/i.exec(value);
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  throw new Error(`${name}: unsupported color ${value}`);
}

function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground: Rgb, background: Rgb): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

const WHITE: Rgb = [255, 255, 255];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry) ? [full] : [];
  });
}

const SOURCES = sourceFiles(path.join(ROOT, "client/src")).map((file) => ({ file: path.relative(ROOT, file), text: readFileSync(file, "utf8") }));

describe("color contract: tokens", () => {
  it("defines every color variable that tailwind.config.ts maps, so no class falls back silently", () => {
    const defined = tokens();
    const mapped = [...TAILWIND.matchAll(/var\((--[a-z0-9-]+)\)/gi)].map((match) => match[1]!);
    const missing = [...new Set(mapped)].filter((name) => /^--(color-|plot-|chart-|primary|destructive|accent|ring|muted|card|popover|secondary|background|foreground|border|input|sidebar)/.test(name) && !defined.has(name));
    expect(missing).toEqual([]);
  });
});

describe("color contract: contrast of the role pairs (style guide, section 2)", () => {
  const map = tokens();
  const background = color("--background", map);
  const card = color("--card", map);

  it.each([
    ["primary action text", "--primary-foreground", "--primary"],
    ["primary action text on hover", "--primary-foreground", "--primary-hover"],
    ["text on the hover surface", "--accent-foreground", "--accent"],
    ["error toast text", "--destructive-foreground", "--destructive"],
  ])("%s reaches 4.5:1", (_name, foreground, surface) => {
    expect(contrast(color(foreground, map), color(surface, map))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["--color-run-stop", "--color-run-stop-hover"])("white on %s (Stop) reaches 4.5:1", (surface) => {
    expect(contrast(WHITE, color(surface, map))).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    "--foreground", "--muted-foreground", "--color-status-success", "--color-status-warning", "--color-status-error",
    "--color-accent-cyan", "--color-rating", "--color-data-rx", "--color-data-tx",
  ])("%s as text reaches 4.5:1 on the background and on panels", (token) => {
    expect(contrast(color(token, map), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color(token, map), card)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the focus ring at 3:1 against the background", () => {
    expect(contrast(color("--ring", map), background)).toBeGreaterThanOrEqual(3);
  });

  it("keeps red out of the data and plot colors: no default series or active pin in the error hue", () => {
    const hue = ([r, g, b]: Rgb) => {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      return (h * 60 + 360) % 360;
    };
    const reddish = (rgb: Rgb) => hue(rgb) < 15 || hue(rgb) > 345;
    const data = ["--color-data-rx", "--color-data-tx", "--color-data-pin-active", ...Array.from({ length: 8 }, (_, index) => `--plot-${index + 1}`)];
    expect(data.filter((token) => reddish(color(token, map)))).toEqual([]);
    expect(reddish(color("--color-status-error", map))).toBe(true);
  });
});

describe("color contract: red means error (style guide, rules 1 and 2)", () => {
  it("uses no raw red or rose palette utilities; error red comes from the status tokens", () => {
    const raw = /(?:^|[\s"'`:!])(?:[a-z-]+:)*(?:text|bg|border|ring|fill|stroke|from|via|to|outline|decoration|shadow|divide|accent|caret)-(?:red|rose)-\d{2,3}\b/;
    expect(SOURCES.filter(({ text }) => raw.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it("puts the error surface only on error toasts, never on a button or a menu entry", () => {
    const surface = /\b(?:bg|text|border)-destructive\b/;
    expect(SOURCES.filter(({ text }) => surface.test(text)).map(({ file }) => file)).toEqual(["client/src/components/ui/toast.tsx"]);
  });

  it("offers no red button variant", () => {
    const button = SOURCES.find(({ file }) => file.endsWith("components/ui/button.tsx"))!.text;
    expect(button).not.toMatch(/destructive/);
  });
});
