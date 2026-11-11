import { checkTutorMermaid, type TutorMermaidRejection } from "@shared/tutor-mermaid-rules";

const IDENTIFIER = "[A-Za-z](?:[A-Za-z0-9_]|-(?![-=>]))*";

function escapeSvg(value: string): string {
  return value.replaceAll(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function displayLabel(value: string | undefined, fallback: string): string {
  const label = (value ?? fallback).trim().replaceAll(/\s+/g, " ");
  return label.length > 48 ? `${label.slice(0, 45)}…` : label;
}

function renderSvg(content: string, width: number, height: number, markerId: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mermaid diagram" class="max-w-full" style="display:block;width:100%;min-width:${Math.min(width, 320)}px;height:auto"><defs><marker id="${markerId}" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,5 L0,10 Z" fill="currentColor"/></marker></defs><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${content}</g></svg>`;
}

function estimateNodeWidth(label: string): number {
  return Math.min(220, Math.max(120, label.length * 7.2 + 36));
}

function renderFlowDiagram(lines: string[], markerId: string, direction: string): string | null {
  const parsed = parseFlowLines(lines);
  if (!parsed) return null;
  const { nodeLabels, edges } = parsed;
  if (nodeLabels.size < 2 || edges.length === 0) return null;

  const nodes = [...nodeLabels.entries()].map(([id, label]) => ({
    id,
    label,
    width: estimateNodeWidth(label),
    height: 52,
  }));
  const vertical = direction === "TD" || direction === "TB" || direction === "BT";
  const gap = 72;
  const sidePadding = 28;
  const contentWidth = vertical
    ? Math.max(...nodes.map(({ width }) => width))
    : nodes.reduce((sum, { width }) => sum + width, 0) + Math.max(0, nodes.length - 1) * gap;
  const contentHeight = vertical
    ? nodes.reduce((sum, { height }) => sum + height, 0) + Math.max(0, nodes.length - 1) * gap
    : Math.max(...nodes.map(({ height }) => height));
  const width = Math.max(360, contentWidth + sidePadding * 2);
  const height = Math.max(130, contentHeight + sidePadding * 2);
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  let cursor = sidePadding;
  const layoutNodes = direction === "RL" || direction === "BT" ? [...nodes].reverse() : nodes;
  for (const node of layoutNodes) {
    positions.set(node.id, {
      x: vertical ? width / 2 : cursor + node.width / 2,
      y: vertical ? cursor + node.height / 2 : height / 2,
      width: node.width,
      height: node.height,
    });
    cursor += (vertical ? node.height : node.width) + gap;
  }
  const content = edges.map(({ from, to, label }) => {
    const start = positions.get(from)!;
    const end = positions.get(to)!;
    const { startX, endX, startY, endY } = getFlowEdgeCoordinates(start, end, vertical);
    const midpointX = (startX + endX) / 2;
    const midpointY = (startY + endY) / 2;
    const text = label
      ? `<text x="${midpointX}" y="${midpointY - 8}" text-anchor="middle" fill="currentColor" stroke="var(--background)" stroke-width="5" paint-order="stroke" font-size="12">${escapeSvg(label)}</text>`
      : "";
    return `<path d="M${startX},${startY} L${endX},${endY}" marker-end="url(#${markerId})"/>${text}`;
  }).join("");
  const boxes = nodes.map((node) => {
    const position = positions.get(node.id)!;
    return `<rect x="${position.x - position.width / 2}" y="${position.y - position.height / 2}" width="${position.width}" height="${position.height}" rx="10" fill="var(--background)" stroke="currentColor" stroke-width="1.5"/><text x="${position.x}" y="${position.y + 5}" text-anchor="middle" fill="currentColor" stroke="none" font-size="14">${escapeSvg(node.label)}</text>`;
  }).join("");
  return renderSvg(`${content}${boxes}`, width, height, markerId);
}

type FlowEdge = { from: string; to: string; label?: string };
type FlowNodeRead = { id: string; rest: string };
type FlowConnectorRead = { label?: string; rest: string };

const FLOW_NODE_PATTERN = new RegExp(String.raw`^(${IDENTIFIER}|\[\*\])\s*(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})?\s*`);
const FLOW_ARROW_PATTERN = /^(?:-->|==>|--)\s*/;

/** `[*]` is the start state as a source and the end state as a target. */
function flowNodeId(rawId: string, target: boolean): string {
  if (rawId !== "[*]") return rawId;
  return target ? "__end" : "__start";
}

function flowNodeFallbackLabel(id: string): string {
  if (id === "__start") return "Start";
  if (id === "__end") return "Ende";
  return id;
}

function readFlowNode(text: string, target: boolean, nodeLabels: Map<string, string>): FlowNodeRead | null {
  const match = FLOW_NODE_PATTERN.exec(text);
  if (!match) return null;
  const id = flowNodeId(match[1], target);
  const label = (match[2] ?? match[3] ?? match[4])?.replace(/^"(.*)"$/, "$1");
  if (label !== undefined || !nodeLabels.has(id)) nodeLabels.set(id, displayLabel(label, flowNodeFallbackLabel(id)));
  return { id, rest: text.slice(match[0].length).trim() };
}

/**
 * `-- text --> B`: the label runs to the first `-->` that follows whitespace. Scanning with indexOf
 * instead of a lazy pattern keeps the cost linear in the line length.
 */
function readShorthandConnector(text: string): FlowConnectorRead | null {
  if (!/^--\s/.test(text)) return null;
  let close = text.indexOf("-->", 4);
  while (close >= 0 && !/\s/.test(text[close - 1])) close = text.indexOf("-->", close + 1);
  const label = close < 0 ? "" : text.slice(2, close).trim();
  if (!label) return null;
  return { label, rest: text.slice(close + 3).trimStart() };
}

/** `-->`, `==>` or `--`, optionally followed by a `|label|`. */
function readArrowConnector(text: string): FlowConnectorRead | null {
  const arrow = FLOW_ARROW_PATTERN.exec(text);
  if (!arrow) return null;
  const rest = text.slice(arrow[0].length);
  if (!rest.startsWith("|")) return { rest };
  const closing = rest.indexOf("|", 1);
  if (closing < 0) return null;
  return { label: rest.slice(1, closing), rest: rest.slice(closing + 1).trim() };
}

/** A state transition may carry its label after the target (`A --> B : label`), but not twice. */
function readTransitionLabel(next: FlowNodeRead, label: string | undefined): string | undefined | null {
  if (!next.rest.startsWith(":")) return label;
  if (label !== undefined || next.rest.length < 2) return null;
  const transitionLabel = next.rest.slice(1).trim();
  next.rest = "";
  return transitionLabel;
}

/** Reads one line completely; any construct it does not understand rejects the whole diagram. */
function parseFlowLine(line: string, nodeLabels: Map<string, string>, edges: FlowEdge[]): boolean {
  let current = readFlowNode(line, false, nodeLabels);
  if (!current) return false;
  while (current.rest) {
    const connector = readShorthandConnector(current.rest) ?? readArrowConnector(current.rest);
    if (!connector) return false;
    const next = readFlowNode(connector.rest, true, nodeLabels);
    if (!next) return false;
    const label = readTransitionLabel(next, connector.label);
    if (label === null) return false;
    edges.push({ from: current.id, to: next.id, ...(label ? { label: displayLabel(label, "") } : {}) });
    current = next;
  }
  return true;
}

function parseFlowLines(lines: string[]): { nodeLabels: Map<string, string>; edges: FlowEdge[] } | null {
  const nodeLabels = new Map<string, string>();
  const edges: FlowEdge[] = [];
  for (const line of lines) {
    if (!parseFlowLine(line, nodeLabels, edges)) return null;
  }
  return { nodeLabels, edges };
}

function getFlowEdgeCoordinates(
  start: { x: number; y: number; width: number; height: number },
  end: { x: number; y: number; width: number; height: number },
  vertical: boolean,
) {
  const forwardX = end.x >= start.x;
  const forwardY = end.y >= start.y;
  return {
    startX: getFlowEdgeCoordinate(start.x, start.width, !vertical, forwardX, true),
    endX: getFlowEdgeCoordinate(end.x, end.width, !vertical, forwardX, false),
    startY: getFlowEdgeCoordinate(start.y, start.height, vertical, forwardY, true),
    endY: getFlowEdgeCoordinate(end.y, end.height, vertical, forwardY, false),
  };
}

function getFlowEdgeCoordinate(
  coordinate: number,
  size: number,
  isEdgeAxis: boolean,
  forward: boolean,
  fromStart: boolean,
): number {
  if (!isEdgeAxis) return coordinate;
  const direction = forward === fromStart ? 1 : -1;
  return coordinate + direction * size / 2;
}

function renderSequenceDiagram(lines: string[], markerId: string): string | null {
  const participants = new Set<string>();
  const messages: Array<{ from: string; to: string; text: string }> = [];
  const participantPattern = new RegExp(String.raw`^\s*(?:participant|actor)\s+(${IDENTIFIER})\s*$`, "i");
  const messagePattern = new RegExp(String.raw`^(${IDENTIFIER})\s*->>?\s*(${IDENTIFIER})\s*:\s*(.+)$`);
  for (const line of lines) {
    const participant = participantPattern.exec(line)?.[1];
    if (participant) { participants.add(participant); continue; }
    const message = messagePattern.exec(line);
    if (!message) return null;
    if (message) {
      participants.add(message[1]);
      participants.add(message[2]);
      messages.push({ from: message[1], to: message[2], text: displayLabel(message[3], "") });
    }
  }
  if (participants.size < 2 || messages.length === 0) return null;
  const actors = [...participants];
  const width = Math.max(360, actors.length * 170);
  const positions = new Map(actors.map((actor, index) => [actor, 85 + index * 160]));
  const height = 100 + messages.length * 46;
  const content: string[] = [];
  actors.forEach((actor) => {
    const x = positions.get(actor)!;
    content.push(
      `<line x1="${x}" y1="36" x2="${x}" y2="${height - 18}" stroke-dasharray="4 4" opacity="0.55"/>`,
      `<text x="${x}" y="20" text-anchor="middle" fill="currentColor" stroke="none" font-size="12">${escapeSvg(displayLabel(actor, actor))}</text>`,
    );
  });
  messages.forEach(({ from, to, text }, index) => {
    const y = 62 + index * 46;
    const start = positions.get(from)!;
    const end = positions.get(to)!;
    content.push(
      `<line x1="${start}" y1="${y}" x2="${end}" y2="${y}" marker-end="url(#${markerId})"/>`,
      `<text x="${(start + end) / 2}" y="${y - 8}" text-anchor="middle" fill="currentColor" stroke="none" font-size="12">${escapeSvg(text)}</text>`,
    );
  });
  return renderSvg(content.join(""), width, height, markerId);
}

export type MermaidRenderResult =
  | { readonly status: "rendered"; readonly svg: string }
  | { readonly status: "rejected"; readonly reason: TutorMermaidRejection };

export function renderMermaidDiagram(source: string, markerId: string): MermaidRenderResult {
  const rejection = checkTutorMermaid(source);
  if (rejection) return { status: "rejected", reason: rejection };
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(markerId)) return { status: "rejected", reason: "invalid-marker-id" };
  const sourceLines = source.trim().split(/\r?\n/);
  const lines = sourceLines.slice(1).map((line) => line.trim()).filter((line) => line && !line.startsWith("%%"));
  const headerParts = sourceLines[0]?.trim().split(/\s+/) ?? [];
  const header = headerParts[0]?.toLowerCase();
  const direction = headerParts[1]?.toUpperCase() ?? "LR";
  if (headerParts.length > 2 || !["LR", "RL", "TD", "TB", "BT"].includes(direction)) {
    return { status: "rejected", reason: "syntax-unsupported" };
  }
  const svg = header === "sequencediagram"
    ? renderSequenceDiagram(lines, markerId)
    : renderFlowDiagram(lines, markerId, direction);
  return svg ? { status: "rendered", svg } : { status: "rejected", reason: lines.length ? "syntax-unsupported" : "no-renderable-graph" };
}

/** Compatibility for callers that only need a graphic or a text-only fallback. */
export function renderMermaidSubset(source: string, markerId: string): string | null {
  const result = renderMermaidDiagram(source, markerId);
  return result.status === "rendered" ? result.svg : null;
}
