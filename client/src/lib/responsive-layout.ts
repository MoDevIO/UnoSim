export const RESPONSIVE_BREAKPOINTS = {
  mobileMax: 767,
  tabletMin: 768,
  tabletMax: 1023,
  desktopMin: 1024,
} as const;

export const RESPONSIVE_MEDIA_QUERIES = {
  mobile: `(max-width: ${RESPONSIVE_BREAKPOINTS.mobileMax}px)`,
  tablet: `(min-width: ${RESPONSIVE_BREAKPOINTS.tabletMin}px) and (max-width: ${RESPONSIVE_BREAKPOINTS.tabletMax}px)`,
  desktop: `(min-width: ${RESPONSIVE_BREAKPOINTS.desktopMin}px)`,
} as const;

export type ResponsiveLayoutMode = "mobile" | "tablet" | "desktop";

export function getResponsiveLayoutMode(
  mobileMatches: boolean,
  tabletMatches: boolean,
): ResponsiveLayoutMode {
  if (mobileMatches) return "mobile";
  if (tabletMatches) return "tablet";
  return "desktop";
}
