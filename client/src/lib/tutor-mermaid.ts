const IDENTIFIER = "[A-Za-z][A-Za-z0-9_-]*";
const UNSAFE_MERMAID_PATTERNS = [
  /https?:\/\//i,
  /javascript:/i,
  /\bclick\b/i,
  /%%\{/i,
  /classDef/i,
  /linkStyle/i,
];

function containsMarkup(source: string): boolean {
  let start = source.indexOf("<");
  while (start >= 0) {
    let cursor = start + 1;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] === "/") cursor += 1;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (/[A-Za-z]/.test(source[cursor] ?? "") && source.slice(cursor + 1).includes(">")) return true;
    start = source.indexOf("<", start + 1);
  }
  return false;
}

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
  const { nodeLabels, edges } = parseFlowLines(lines);
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
  for (const node of nodes) {
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

function parseFlowLines(lines: string[]): {
  nodeLabels: Map<string, string>;
  edges: Array<{ from: string; to: string; label?: string }>;
} {
  const nodeLabels = new Map<string, string>();
  const edges: Array<{ from: string; to: string; label?: string }> = [];
  const nodePattern = new RegExp(String.raw`(${IDENTIFIER})\s*(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})`, "g");
  const edgePattern = new RegExp(String.raw`((?:${IDENTIFIER})|\[\*\])\s*(?:\[[^\]]+\]|\((?:[^)]+)\)|\{[^}]+\})?\s*(?:-+>|-+|==>)\s*(?:\|([^|]+)\|\s*)?((?:${IDENTIFIER})|\[\*\])\s*(?:\[[^\]]+\]|\((?:[^)]+)\)|\{[^}]+\})?`, "g");

  for (const line of lines) {
    addFlowNodes(line, nodePattern, nodeLabels);
    addFlowEdges(line, edgePattern, nodeLabels, edges);
  }
  return { nodeLabels, edges };
}

function addFlowNodes(line: string, pattern: RegExp, nodeLabels: Map<string, string>): void {
  for (const match of line.matchAll(pattern)) {
    nodeLabels.set(match[1], displayLabel(match[2] ?? match[3] ?? match[4], match[1]));
  }
}

function addFlowEdges(
  line: string,
  pattern: RegExp,
  nodeLabels: Map<string, string>,
  edges: Array<{ from: string; to: string; label?: string }>,
): void {
  for (const match of line.matchAll(pattern)) {
    const from = match[1] === "[*]" ? "__start" : match[1];
    const to = match[3] === "[*]" ? "__end" : match[3];
    nodeLabels.set(from, nodeLabels.get(from) ?? from);
    nodeLabels.set(to, nodeLabels.get(to) ?? to);
    if (from === "__start") nodeLabels.set(from, "Start");
    if (to === "__end") nodeLabels.set(to, "Ende");
    edges.push({ from, to, label: match[2] ? displayLabel(match[2], "") : undefined });
  }
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
  const participantPattern = new RegExp(String.raw`^\s*(?:participant|actor)\s+(${IDENTIFIER})`, "i");
  const messagePattern = new RegExp(String.raw`(${IDENTIFIER})\s*-+>+\s*(${IDENTIFIER})\s*:\s*(.+)$`);
  for (const line of lines) {
    const participant = participantPattern.exec(line)?.[1];
    if (participant) participants.add(participant);
    const message = messagePattern.exec(line);
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

export function renderMermaidSubset(source: string, markerId: string): string | null {
  if (containsMarkup(source) || UNSAFE_MERMAID_PATTERNS.some((pattern) => pattern.test(source))) return null;
  const sourceLines = source.trim().split(/\r?\n/);
  const lines = sourceLines.slice(1).map((line) => line.trim()).filter(Boolean);
  const headerParts = sourceLines[0]?.trim().split(/\s+/) ?? [];
  const header = headerParts[0]?.toLowerCase();
  const direction = headerParts[1]?.toUpperCase() ?? "LR";
  if (header === "sequencediagram") return renderSequenceDiagram(lines, markerId);
  if (header === "flowchart" || header === "graph" || header === "statediagram-v2") {
    return renderFlowDiagram(lines, markerId, direction);
  }
  return null;
}
