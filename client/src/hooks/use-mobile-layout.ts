import { useState, useEffect, useRef } from "react";
import { Logger } from "@shared/logger";
import {
  getResponsiveLayoutMode,
  RESPONSIVE_MEDIA_QUERIES,
  type ResponsiveLayoutMode,
} from "@/lib/responsive-layout";

const logger = new Logger("MobileLayout");
export type MobilePanel = "code" | "compile" | "serial" | "board";

export function useMobileLayout() {
  const isClient = globalThis.window !== undefined;
  const getInitialMode = (): ResponsiveLayoutMode => {
    if (!isClient) return "desktop";
    return getResponsiveLayoutMode(
      globalThis.matchMedia(RESPONSIVE_MEDIA_QUERIES.mobile).matches,
      globalThis.matchMedia(RESPONSIVE_MEDIA_QUERIES.tablet).matches,
    );
  };
  const [layoutMode, setLayoutMode] = useState<ResponsiveLayoutMode>(getInitialMode);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("code");
  const previousModeRef = useRef<ResponsiveLayoutMode>(layoutMode);
  const [headerHeight, setHeaderHeight] = useState<number>(40);
  const [overlayZ, setOverlayZ] = useState<number>(30);

  // Keep all layout boundaries in sync with the shared responsive contract.
  useEffect(() => {
    if (!isClient) return;
    const mobileQuery = globalThis.matchMedia(RESPONSIVE_MEDIA_QUERIES.mobile);
    const tabletQuery = globalThis.matchMedia(RESPONSIVE_MEDIA_QUERIES.tablet);

    const applyLayoutMode = (mobileMatches: boolean, tabletMatches: boolean) => {
      const nextMode = getResponsiveLayoutMode(
        mobileMatches,
        tabletMatches,
      );
      if (nextMode === "mobile" && previousModeRef.current !== "mobile") {
        setMobilePanel("code");
      }
      previousModeRef.current = nextMode;
      setLayoutMode(nextMode);
    };

    const onMobileChange = (event: MediaQueryListEvent) => {
      applyLayoutMode(event.matches, tabletQuery.matches);
    };
    const onTabletChange = (event: MediaQueryListEvent) => {
      applyLayoutMode(mobileQuery.matches, event.matches);
    };

    mobileQuery.addEventListener("change", onMobileChange);
    tabletQuery.addEventListener("change", onTabletChange);
    return () => {
      mobileQuery.removeEventListener("change", onMobileChange);
      tabletQuery.removeEventListener("change", onTabletChange);
    };
  }, [isClient]);

  const isMobile = layoutMode === "mobile";
  const isTablet = layoutMode === "tablet";
  const isDesktop = layoutMode === "desktop";

  // Prevent document scroll while the mobile workspace owns the viewport.
  useEffect(() => {
    if (!isClient) return;
    const prev = document.body.style.overflow;
    if (isMobile) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [isMobile, isClient]);

  // Compute header height and overlay z-index
  useEffect(() => {
    if (!isClient) return;
    const measure = () => {
      // First try to find our mobile header by data attribute
      let hdr: Element | null = document.querySelector("[data-mobile-header]");
      // Fallback to <header> tag
      hdr ??= document.querySelector("header");
      if (!hdr) {
        const all = Array.from<HTMLElement>(
          document.body.querySelectorAll<HTMLElement>("*"),
        );
        hdr =
          all.find((el) => {
            if (!el) return false;
            // ignore html/body
            if (el === document.body || el === document.documentElement)
              return false;
            const style = getComputedStyle(el);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              Number(style.opacity) === 0
            )
              return false;
            const r = el.getBoundingClientRect();
            // must be near the top and reasonably small (not full-page)
            if (r.top < -5 || r.top > 48) return false;
            if (r.height < 24 || r.height > globalThis.innerHeight / 2)
              return false;
            return true;
          }) || null;
      }

      if (hdr === document.body || hdr === document.documentElement) hdr = null;

      let h = 40;
      if (hdr) {
        const rect = (hdr as HTMLElement).getBoundingClientRect();
        if (rect.height > 0 && rect.height < globalThis.innerHeight / 2)
          h = Math.ceil(rect.height);
      }
      setHeaderHeight(h);

      let z = 0;
      if (hdr) {
        const zStr = getComputedStyle(hdr as HTMLElement).zIndex;
        const zNum = Number.parseInt(zStr || "", 10);
        z = Number.isFinite(zNum) ? zNum : 0;
      }
      const chosenZ = z > 0 ? Math.max(z - 1, 5) : 30;
      setOverlayZ(chosenZ);
      logger.debug(
        `[mobile overlay] header detect: ${hdr?.tagName ?? "null"} headerHeight=${h} overlayZ=${chosenZ}`,
      );
    };

    measure();
    globalThis.addEventListener("resize", measure);
    const hdr = document.querySelector("header");
    if (hdr) {
      const obs = new MutationObserver(measure);
      obs.observe(hdr, { attributes: true, childList: true, subtree: true });
      return () => {
        globalThis.removeEventListener("resize", measure);
        obs.disconnect();
      };
    }
    return () => {
      globalThis.removeEventListener("resize", measure);
    };
  }, [isClient]);

  return {
    isMobile,
    isTablet,
    isDesktop,
    layoutMode,
    mobilePanel,
    setMobilePanel,
    headerHeight,
    overlayZ,
  };
}
