import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnifiedScrollArea } from "@/components/ui/unified-scroll-area";

function defineScrollGeometry(viewport: HTMLElement): void {
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 200 },
    clientHeight: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 400 },
    scrollLeft: { configurable: true, writable: true, value: 0 },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
}

describe("UnifiedScrollArea", () => {
  it("renders matching horizontal and vertical overlay scrollbars", () => {
    const { container } = render(
      <UnifiedScrollArea viewportTestId="viewport">
        <div>oversized content</div>
      </UnifiedScrollArea>,
    );
    const viewport = screen.getByTestId("viewport");
    defineScrollGeometry(viewport);

    fireEvent.scroll(viewport);

    expect(container.querySelector(".unified-scrollbar--horizontal")).not.toBeNull();
    expect(container.querySelector(".unified-scrollbar--vertical")).not.toBeNull();
  });

  it("maps Shift+mouse wheel to horizontal scrolling", () => {
    render(
      <UnifiedScrollArea viewportTestId="viewport" orientation="horizontal">
        <div>oversized content</div>
      </UnifiedScrollArea>,
    );
    const viewport = screen.getByTestId("viewport");
    defineScrollGeometry(viewport);

    fireEvent.wheel(viewport, { shiftKey: true, deltaY: 80 });

    expect(viewport.scrollLeft).toBe(80);
  });

  it("moves the viewport when the horizontal track is clicked", () => {
    const { container } = render(
      <UnifiedScrollArea viewportTestId="viewport" orientation="horizontal">
        <div>oversized content</div>
      </UnifiedScrollArea>,
    );
    const viewport = screen.getByTestId("viewport");
    defineScrollGeometry(viewport);
    fireEvent.scroll(viewport);
    const track = container.querySelector<HTMLElement>(".unified-scrollbar--horizontal");
    expect(track).not.toBeNull();
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 200 });
    track!.getBoundingClientRect = () => ({
      bottom: 8, height: 8, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(track!, { clientX: 150, pointerId: 1 });

    expect(viewport.scrollLeft).toBeGreaterThan(0);
  });
});
