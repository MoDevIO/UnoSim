import type { TutorResponse } from "@shared/tutor";
import type { TutorUmlImage } from "@shared/tutor-uml";
import { TUTOR_UML_LIMITS } from "@shared/tutor-uml-profile";

const SVG_NS = "http://www.w3.org/2000/svg";
const TAGS = new Set(["svg", "g", "defs", "path", "polygon", "polyline", "rect", "circle", "ellipse", "line", "text", "tspan", "clipPath", "marker", "title", "desc"]);
const ATTRS = new Set(["xmlns", "version", "width", "height", "viewBox", "zoomAndPan", "preserveAspectRatio", "contentStyleType", "style", "id", "class", "x", "y", "x1", "x2", "y1", "y2", "rx", "ry", "r", "cx", "cy", "d", "points", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "opacity", "font-family", "font-size", "font-weight", "font-style", "textLength", "lengthAdjust", "text-anchor", "dominant-baseline", "clip-path", "marker-end", "marker-start", "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits"]);
const CSS = new Set(["width", "height", "background", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linejoin", "stroke-miterlimit", "opacity", "font-family", "font-size", "font-weight", "font-style"]);
const bytes = (value: string) => new TextEncoder().encode(value).length;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const dimension = (value: string | null): number => value && /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? Number.parseFloat(value) : Number.NaN;

function validDimension(value: unknown, maximum: number): value is number {
  return typeof value === "number" && value > 0 && value <= maximum;
}

function readableFont(value: string): boolean {
  const size = dimension(value);
  return Number.isFinite(size) && size >= TUTOR_UML_LIMITS.fontSize;
}

function imageMetadata(value: unknown): value is TutorUmlImage {
  if (!record(value)) return false;
  return typeof value.svg === "string" && value.svg.length > 0
    && bytes(value.svg) === value.bytes && Number(value.bytes) <= TUTOR_UML_LIMITS.imageBytes
    && validDimension(value.width, TUTOR_UML_LIMITS.width)
    && validDimension(value.height, TUTOR_UML_LIMITS.height)
    && typeof value.rendererRevision === "string" && value.rendererRevision.length > 0 && value.rendererRevision.length <= 160;
}

function validRoot(doc: Document, image: TutorUmlImage): boolean {
  const root = doc.documentElement;
  return root.localName === "svg" && root.namespaceURI === SVG_NS && !doc.querySelector("parsererror")
    && dimension(root.getAttribute("width")) === image.width
    && dimension(root.getAttribute("height")) === image.height
    && root.getAttribute("viewBox")?.trim().split(/\s+/).map(Number).join(" ") === `0 0 ${image.width} ${image.height}`;
}

function validStyleEntry(entry: string, node: Element, root: Element): boolean {
  const colon = entry.indexOf(":");
  const property = entry.slice(0, colon).trim();
  const content = entry.slice(colon + 1).trim();
  if (colon < 0 || !CSS.has(property) || !/^[A-Za-z0-9#.,% -]+$/.test(content)) return false;
  if (property === "font-size" && !readableFont(content)) return false;
  if (["width", "height"].includes(property)) return node === root && content === root.getAttribute(property);
  return true;
}

function validAttribute({ name, value }: Attr, node: Element, root: Element): boolean {
  if (!ATTRS.has(name)) return false;
  if (name === "xmlns") return value === SVG_NS;
  if (/(?:https?:|file:|javascript:|data:)/i.test(value)) return false;
  if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z_][A-Za-z0-9_.-]*\)$/.test(value)) return false;
  if (name === "font-size" && !readableFont(value)) return false;
  return name !== "style" || value.split(";").filter(Boolean).every((entry) => validStyleEntry(entry, node, root));
}

function validElement(node: Element, root: Element): boolean {
  return node.namespaceURI === SVG_NS && TAGS.has(node.localName)
    && [...node.attributes].every((attribute) => validAttribute(attribute, node, root));
}

/** Defense in depth before a server image is passed to a browser image decoder. Never inserts SVG into the document. */
export function acceptTutorUmlImage(value: unknown, usedBytes: number): value is TutorUmlImage {
  if (!imageMetadata(value) || usedBytes + bytes(JSON.stringify(value)) > TUTOR_UML_LIMITS.browserBytes || /<!|<\?/.test(value.svg)) return false;
  const doc = new DOMParser().parseFromString(value.svg, "image/svg+xml");
  if (!validRoot(doc, value)) return false;
  const root = doc.documentElement;
  return [root, ...root.querySelectorAll("*")].every((node) => validElement(node, root));
}

/** Optional image failures must not invalidate a useful learning step. Metadata still goes through its strict schema. */
export function normalizeTutorUmlPayload(payload: unknown, graphicsProfile?: string | null): unknown {
  if (!record(payload)) return payload;
  let result = payload;
  if (record(payload.diagram)) {
    const diagram = payload.diagram;
    if ("image" in diagram && !acceptTutorUmlImage(diagram.image, bytes(JSON.stringify({ ...diagram, image: undefined })))) {
      result = { ...result, diagram: { ...diagram, image: undefined } };
    }
  }
  if ((graphicsProfile || payload.diagram) && "mermaid" in result) {
    result = { ...result, mermaid: undefined, ...(!payload.diagram && payload.graphicStatus === "provided" ? { graphicStatus: "unavailable" } : {}) };
  }
  return result;
}

/** Visible and held questions are the only image owners; older turns contain text only. */
export function boundTutorUmlResponse(response: TutorResponse, retained: readonly (TutorResponse | null)[]): TutorResponse {
  if (!response.diagram?.image) return response;
  const owners = new Set(retained.filter((item) => item !== null && item !== response));
  const used = [...owners].reduce((sum, item) => sum + (item?.diagram?.image ? bytes(JSON.stringify(item.diagram)) : 0), 0);
  if (used + bytes(JSON.stringify(response.diagram)) <= TUTOR_UML_LIMITS.browserBytes) return response;
  return { ...response, diagram: { ...response.diagram, image: undefined } };
}
