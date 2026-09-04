import * as React from "react";
import { cn } from "@/lib/utils";

type ScrollOrientation = "horizontal" | "vertical" | "both";
type ScrollbarVisibility = "hover" | "always";

interface ScrollMetrics {
  horizontal: { visible: boolean; size: number; offset: number };
  vertical: { visible: boolean; size: number; offset: number };
}

interface UnifiedScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly orientation?: ScrollOrientation;
  readonly scrollbarVisibility?: ScrollbarVisibility;
  readonly viewportClassName?: string;
  readonly viewportProps?: React.HTMLAttributes<HTMLDivElement>;
  readonly viewportRef?: React.Ref<HTMLDivElement>;
  readonly viewportTestId?: string;
  readonly shiftWheelHorizontal?: boolean;
}

const EMPTY_METRICS: ScrollMetrics = {
  horizontal: { visible: false, size: 100, offset: 0 },
  vertical: { visible: false, size: 100, offset: 0 },
};

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = value;
}

function readMetrics(viewport: HTMLDivElement): ScrollMetrics {
  const horizontalMax = viewport.scrollWidth - viewport.clientWidth;
  const verticalMax = viewport.scrollHeight - viewport.clientHeight;
  const horizontalVisible = horizontalMax > 1;
  const verticalVisible = verticalMax > 1;
  const horizontalSize = horizontalVisible
    ? Math.max(8, (viewport.clientWidth / viewport.scrollWidth) * 100)
    : 100;
  const verticalSize = verticalVisible
    ? Math.max(8, (viewport.clientHeight / viewport.scrollHeight) * 100)
    : 100;

  return {
    horizontal: {
      visible: horizontalVisible,
      size: horizontalSize,
      offset: horizontalVisible
        ? (viewport.scrollLeft / horizontalMax) * (100 - horizontalSize)
        : 0,
    },
    vertical: {
      visible: verticalVisible,
      size: verticalSize,
      offset: verticalVisible
        ? (viewport.scrollTop / verticalMax) * (100 - verticalSize)
        : 0,
    },
  };
}

interface UnifiedScrollbarProps {
  readonly orientation: "horizontal" | "vertical";
  readonly viewport: HTMLDivElement | null;
  readonly metric: ScrollMetrics["horizontal"];
}

function UnifiedScrollbar({ orientation, viewport, metric }: UnifiedScrollbarProps) {
  const dragOffsetRef = React.useRef(0);
  const draggingRef = React.useRef(false);
  if (!metric.visible) return null;

  const isHorizontal = orientation === "horizontal";
  const moveToPointer = (event: React.PointerEvent<HTMLDivElement>, preserveOffset: boolean) => {
    if (!viewport) return;
    const track = event.currentTarget;
    const rect = track.getBoundingClientRect();
    const trackSize = isHorizontal ? rect.width : rect.height;
    const thumbSize = trackSize * metric.size / 100;
    const coordinate = isHorizontal ? event.clientX - rect.left : event.clientY - rect.top;
    const offset = preserveOffset ? dragOffsetRef.current : thumbSize / 2;
    const ratio = Math.max(0, Math.min(1, (coordinate - offset) / Math.max(1, trackSize - thumbSize)));
    if (isHorizontal) viewport.scrollLeft = ratio * (viewport.scrollWidth - viewport.clientWidth);
    else viewport.scrollTop = ratio * (viewport.scrollHeight - viewport.clientHeight);
  };

  return (
    <div
      aria-hidden="true"
      className={cn("unified-scrollbar", `unified-scrollbar--${orientation}`)}
      onPointerDown={(event) => {
        event.preventDefault();
        const thumb = (event.target as HTMLElement).closest(".unified-scrollbar__thumb");
        const rect = event.currentTarget.getBoundingClientRect();
        const thumbStart = (isHorizontal ? rect.width : rect.height) * metric.offset / 100;
        const coordinate = isHorizontal ? event.clientX - rect.left : event.clientY - rect.top;
        dragOffsetRef.current = thumb ? coordinate - thumbStart : 0;
        draggingRef.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        moveToPointer(event, Boolean(thumb));
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) moveToPointer(event, true);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
      }}
      onPointerCancel={() => { draggingRef.current = false; }}
    >
      <span
        className="unified-scrollbar__thumb"
        style={isHorizontal
          ? { left: `${metric.offset}%`, width: `${metric.size}%` }
          : { height: `${metric.size}%`, top: `${metric.offset}%` }}
      />
    </div>
  );
}

export const UnifiedScrollArea = React.forwardRef<HTMLDivElement, UnifiedScrollAreaProps>(
  function UnifiedScrollArea(
    {
      children,
      className,
      orientation = "both",
      scrollbarVisibility = "hover",
      shiftWheelHorizontal = true,
      viewportClassName,
      viewportProps,
      viewportRef,
      viewportTestId,
      ...rootProps
    },
    forwardedRef,
  ) {
    const internalViewportRef = React.useRef<HTMLDivElement | null>(null);
    const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
    const [metrics, setMetrics] = React.useState<ScrollMetrics>(EMPTY_METRICS);
    const updateMetrics = React.useCallback(() => {
      if (internalViewportRef.current) setMetrics(readMetrics(internalViewportRef.current));
    }, []);
    const setViewportRef = React.useCallback((node: HTMLDivElement | null) => {
      internalViewportRef.current = node;
      setViewport(node);
      assignRef(viewportRef, node);
    }, [viewportRef]);

    React.useLayoutEffect(() => {
      if (!viewport) return;
      updateMetrics();
      const resizeObserver = typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateMetrics);
      resizeObserver?.observe(viewport);
      if (viewport.firstElementChild) resizeObserver?.observe(viewport.firstElementChild);
      const mutationObserver = typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(updateMetrics);
      mutationObserver?.observe(viewport, { childList: true, subtree: true, characterData: true });
      globalThis.addEventListener("resize", updateMetrics);
      return () => {
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        globalThis.removeEventListener("resize", updateMetrics);
      };
    }, [children, updateMetrics, viewport]);

    const allowHorizontal = orientation !== "vertical";
    const allowVertical = orientation !== "horizontal";
    const { onScroll, onWheel, className: viewportPropsClassName, ...restViewportProps } = viewportProps ?? {};

    return (
      <div
        ref={forwardedRef}
        className={cn("unified-scroll-area", className)}
        data-scrollbar-visibility={scrollbarVisibility}
        {...rootProps}
      >
        <div
          ref={setViewportRef}
          data-testid={viewportTestId}
          className={cn("unified-scroll-area__viewport", viewportClassName, viewportPropsClassName)}
          onScroll={(event) => {
            updateMetrics();
            onScroll?.(event);
          }}
          onWheel={(event) => {
            onWheel?.(event);
            if (event.defaultPrevented || !allowHorizontal || !shiftWheelHorizontal || !event.shiftKey) return;
            event.currentTarget.scrollLeft += event.deltaY || event.deltaX;
            event.preventDefault();
            event.stopPropagation();
            updateMetrics();
          }}
          {...restViewportProps}
        >
          {children}
        </div>
        {allowHorizontal && <UnifiedScrollbar orientation="horizontal" viewport={viewport} metric={metrics.horizontal} />}
        {allowVertical && <UnifiedScrollbar orientation="vertical" viewport={viewport} metric={metrics.vertical} />}
      </div>
    );
  },
);
