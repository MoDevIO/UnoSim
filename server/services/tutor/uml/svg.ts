import { SaxesParser, type SaxesTagNS } from "saxes";
import { TUTOR_UML_LIMITS, type TutorUmlKind } from "@shared/tutor-uml-profile";
import { UmlRenderError, UML_RENDERER_REVISION } from "./limits";

export interface RenderedUmlImage {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly rendererRevision: string;
}
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const TAGS = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "polygon",
  "polyline",
  "rect",
  "circle",
  "ellipse",
  "line",
  "text",
  "tspan",
  "clipPath",
  "marker",
  "title",
  "desc",
]);
const ATTRS = new Set([
  "xmlns",
  "version",
  "width",
  "height",
  "viewBox",
  "zoomAndPan",
  "preserveAspectRatio",
  "contentStyleType",
  "style",
  "id",
  "class",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "rx",
  "ry",
  "r",
  "cx",
  "cy",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "textLength",
  "lengthAdjust",
  "text-anchor",
  "dominant-baseline",
  "transform",
  "clip-path",
  "marker-end",
  "marker-start",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
  "orient",
  "markerUnits",
]);
const CSS_PROPERTIES = new Set([
  "width",
  "height",
  "background",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linejoin",
  "stroke-miterlimit",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
]);
const invalid = (): never => {
  throw new UmlRenderError("render-output-invalid");
};
const escapeXml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
function dimension(value: string | undefined, maximum: number): number {
  if (!value || !/^\d+(?:\.\d+)?(?:px)?$/.test(value)) return invalid();
  const number = Number.parseFloat(value);
  return number > 0 && number <= maximum ? number : invalid();
}
function paint(value: string): boolean {
  return /^(?:#[a-fA-F0-9]{3,8}|[a-zA-Z]+|rgba?\([0-9.,% ]+\)|url\(#[A-Za-z_][A-Za-z0-9_.-]*\))$/.test(
    value,
  );
}
function checkedStyle(style: string, tag: SaxesTagNS): string {
  return style
    .split(";")
    .filter(Boolean)
    .map((entry) => {
      const colon = entry.indexOf(":");
      const key = entry.slice(0, colon).trim();
      const value = entry.slice(colon + 1).trim();
      if (
        colon < 0 ||
        !CSS_PROPERTIES.has(key) ||
        !/^[A-Za-z0-9#.,% -]+$/.test(value)
      )
        return invalid();
      if (
        key === "font-size" &&
        dimension(value, 128) < TUTOR_UML_LIMITS.fontSize
      )
        return invalid();
      if (
        (key === "width" || key === "height") &&
        (tag.local !== "svg" || value !== tag.attributes[key]?.value)
      )
        return invalid();
      if (["fill", "stroke", "background"].includes(key) && !paint(value))
        return invalid();
      return `${key}:${key === "font-family" ? "sans-serif" : value}`;
    })
    .join(";");
}
function attributes(tag: SaxesTagNS): string {
  return Object.values(tag.attributes)
    .flatMap(({ name, value }) => {
      if (name.startsWith("data-") || name === "xmlns:xlink") return [];
      if (
        !ATTRS.has(name) ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/.test(
          value,
        )
      )
        return invalid();
      if (
        /(?:https?:|file:|javascript:|data:)/i.test(value) &&
        name !== "xmlns"
      )
        return invalid();
      if (
        /url\s*\(/i.test(value) &&
        !/^url\(#[A-Za-z_][A-Za-z0-9_.-]*\)$/.test(value)
      )
        return invalid();
      if (["fill", "stroke"].includes(name) && !paint(value)) return invalid();
      if (name === "transform") return invalid();
      if (
        name === "font-size" &&
        dimension(value, 128) < TUTOR_UML_LIMITS.fontSize
      )
        return invalid();
      const normalized = name === "style" ? checkedStyle(value, tag) : value;
      return [
        ` ${name}="${escapeXml(name === "font-family" ? "sans-serif" : normalized)}"`,
      ];
    })
    .join("");
}

/** Parses XML without entity resolution; rejects active output rather than silently dropping visible nodes. */
export function validateTutorUmlSvg(
  svg: string,
  kind: TutorUmlKind,
): RenderedUmlImage {
  if (Buffer.byteLength(svg) > TUTOR_UML_LIMITS.imageBytes) return invalid();
  const output: string[] = [];
  let width = 0;
  let height = 0;
  let depth = 0;
  let roots = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", invalid);
  parser.on("processinginstruction", ({ target, body }) => {
    if (target !== "plantuml" || body !== "1.2026.10") invalid();
  });
  parser.on("error", invalid);
  parser.on("opentag", (tag) => {
    if (!TAGS.has(tag.local) || tag.uri !== SVG_NAMESPACE) return invalid();
    if (depth++ === 0) {
      if (
        ++roots !== 1 ||
        tag.local !== "svg" ||
        tag.attributes["data-diagram-type"]?.value !== kind.toUpperCase()
      )
        return invalid();
      width = dimension(tag.attributes.width?.value, TUTOR_UML_LIMITS.width);
      height = dimension(tag.attributes.height?.value, TUTOR_UML_LIMITS.height);
      const box = tag.attributes.viewBox?.value.split(/\s+/).map(Number);
      if (
        box?.length !== 4 ||
        !box.every(Number.isFinite) ||
        box[0] !== 0 ||
        box[1] !== 0 ||
        Math.abs(box[2] - width) > 1 ||
        Math.abs(box[3] - height) > 1
      )
        return invalid();
    }
    output.push(`<${tag.local}${attributes(tag)}>`);
  });
  parser.on("closetag", (tag) => {
    depth--;
    output.push(`</${tag.local}>`);
  });
  parser.on("text", (text) => {
    if (depth > 0) output.push(escapeXml(text));
  });
  parser.on("cdata", (text) => {
    if (depth > 0) output.push(escapeXml(text));
  });
  try {
    parser.write(svg).close();
  } catch (error) {
    if (error instanceof UmlRenderError) {
      throw error;
    }
    return invalid();
  }
  if (!width || !height || roots !== 1 || depth !== 0) return invalid();
  const normalized = output.join("");
  if (Buffer.byteLength(normalized) > TUTOR_UML_LIMITS.imageBytes)
    return invalid();
  return {
    svg: normalized,
    width,
    height,
    bytes: Buffer.byteLength(normalized),
    rendererRevision: UML_RENDERER_REVISION,
  };
}
