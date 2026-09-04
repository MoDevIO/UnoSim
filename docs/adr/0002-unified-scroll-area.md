# ADR 0002: Unified scroll areas

## Status

Accepted

## Context

UnoSim previously mixed native browser scrollbars, Radix scrollbars and local
overlay implementations. Their dimensions and behavior differed across tabs,
Serial Output, Compiler, Messages and Registry, especially on macOS.

## Decision

These five areas use `UnifiedScrollArea` from
`client/src/components/ui/unified-scroll-area.tsx`.

The component owns:

- horizontal and vertical overflow detection;
- browser-independent overlay tracks and draggable thumbs;
- click-to-position behavior;
- Shift+mouse-wheel horizontal scrolling;
- resize and dynamic-content observation;
- the shared `--ui-scrollbar-size` design token;
- consistent hover/focus visibility and colors.

Consumers select `horizontal`, `vertical` or `both`, provide viewport classes,
and may receive the viewport DOM ref for virtualized or imperative rendering.
They must not add their own native or Radix scrollbar around the same content.

Monaco remains an exception because its virtualized editor owns scrolling and
scrollbar rendering internally. Layout splitters are resize handles rather than
content scrollbars and are also outside this component.

## Consequences

Scrollbar appearance and interaction are implemented once and tested centrally.
New scrollable UnoSim panels should use `UnifiedScrollArea`. Changes to width or
color are made through shared design tokens instead of panel-specific CSS.
