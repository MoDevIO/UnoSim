import { useState, useEffect } from "react";
import { Logger } from "@shared/logger";

const logger = new Logger("MobileLayout");

export function useMobileLayout() {
  const isClient = globalThis.window !== undefined;
  const mqQuery = "(max-width: 768px)";
  const initialIsMobile = isClient ? globalThis.matchMedia(mqQuery).matches : false;
  const [isMobile, setIsMobile] = useState<boolean>(initialIsMobile);
  const [mobilePanel, setMobilePanel] = useState<"code" | "compile" | "serial" | "board" | null>(
    initialIsMobile ? "code" : null,
  );
  const [headerHeight, setHeaderHeight] = useState<number>(40);
  const [overlayZ, setOverlayZ] = useState<number>(30);

  // Media query listener for responsive layout
  useEffect(() => {
    if (!isClient) return;
    const mq = globalThis.matchMedia(mqQuery);
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const matches = "matches" in e ? e.matches : mq.matches;
      setIsMobile(matches);
      // If switching into mobile mode, open code panel immediately
      if (matches && !mobilePanel) setMobilePanel("code");
      // If switching out of mobile, close any mobile panel
      if (!matches) setMobilePanel(null);
    };
    // Modern browsers: addEventListener
    mq.addEventListener("change", onChange as any);
    return () => {
      mq.removeEventListener("change", onChange as any);
    };
  }, [isClient, mobilePanel]);

  // Prevent body scroll when mobile panel is open
  useEffect(() => {
    if (!isClient) return;
    const prev = document.body.style.overflow;
    if (mobilePanel) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = prev || "";
    }
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [mobilePanel, isClient]);

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
        `[mobile overlay] header detect: ${hdr} headerHeight=${h} overlayZ=${chosenZ}`,
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
    mobilePanel,
    setMobilePanel,
    headerHeight,
    overlayZ,
  };
}

