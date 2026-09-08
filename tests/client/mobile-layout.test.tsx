import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MobileLayout } from "../../client/src/components/features/mobile-layout";

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
});
