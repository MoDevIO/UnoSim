import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FLOATING_NAVIGATION_ATTRIBUTE, MobileLayout } from "../../client/src/components/features/mobile-layout";

describe("MobileLayout component", () => {
  it("renders nothing when not mobile", () => {
    const { container } = render(
      <MobileLayout
        isMobile={false}
        mobilePanel="code"
        setMobilePanel={vi.fn()}
        overlayZ={0}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["phone", true, false, false, true],
    ["tablet with the Tutor", false, true, true, true],
    ["tablet without the Tutor", false, true, false, false],
    ["desktop", false, false, true, false],
  ] as const)("marks the page while the floating navigation is shown (%s), so content keeps its room free", (_name, isMobile, isTablet, showTutor, shown) => {
    const { unmount } = render(
      <MobileLayout isMobile={isMobile} isTablet={isTablet} showTutor={showTutor} mobilePanel="tutor" setMobilePanel={vi.fn()} overlayZ={50} />,
    );
    expect(document.documentElement.hasAttribute(FLOATING_NAVIGATION_ATTRIBUTE)).toBe(shown);
    expect(screen.queryByTestId("mobile-fab-container") !== null).toBe(shown);
    unmount();
    expect(document.documentElement.hasAttribute(FLOATING_NAVIGATION_ATTRIBUTE)).toBe(false);
  });

  it("keeps the panel selection non-null and routes button clicks", () => {
    const setMobile = vi.fn();
    const onOpen = vi.fn();

    render(
      <MobileLayout
        isMobile={true}
        mobilePanel="code"
        setMobilePanel={setMobile}
        overlayZ={50}
        onOpenPanel={onOpen}
      />,
    );

    const codeBtn = screen.getByLabelText("Code Editor");
    const compileBtn = screen.getByLabelText("Compilation Output");

    fireEvent.click(codeBtn);
    expect(setMobile).toHaveBeenCalledWith("code");

    fireEvent.click(compileBtn);
    expect(setMobile).toHaveBeenCalledWith("compile");
    expect(onOpen).toHaveBeenCalledWith("compile");
  });

  it("exposes enlarged mobile toolbar targets", () => {
    render(
      <MobileLayout
        isMobile={true}
        mobilePanel="code"
        setMobilePanel={vi.fn()}
        overlayZ={50}
      />,
    );

    expect(screen.getByTestId("mobile-fab-container")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-fab-container").querySelectorAll("[data-mobile-fab-button]")).toHaveLength(4);
    expect(screen.getByTestId("mobile-fab-container").querySelector("[data-mobile-fab-toolbar]")).toHaveClass("p-2", "space-y-3");
    expect(screen.getByLabelText("Code Editor").querySelector("svg")).toHaveClass("!w-10", "!h-10");
  });

  it("offers the tutor as an additional compact view when enabled", () => {
    const setMobile = vi.fn();
    render(
      <MobileLayout
        isMobile={true}
        showTutor={true}
        mobilePanel="code"
        setMobilePanel={setMobile}
        overlayZ={50}
      />,
    );

    expect(screen.getByLabelText("Tutor")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Tutor"));
    expect(setMobile).toHaveBeenCalledWith("tutor");
  });
});
