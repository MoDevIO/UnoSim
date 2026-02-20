import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MobileLayout, MobilePanel } from "../../client/src/components/features/mobile-layout";

// simple placeholder components
const Code = () => <div data-testid="slot-code">CODE</div>;
const Compile = () => <div data-testid="slot-compile">COMPILE</div>;
const Serial = () => <div data-testid="slot-serial">SERIAL</div>;
const Board = () => <div data-testid="slot-board">BOARD</div>;

describe("MobileLayout component", () => {
  it("renders nothing when not mobile and no panel", () => {
    const { container } = render(
      <MobileLayout
        isMobile={false}
        mobilePanel={null}
        setMobilePanel={vi.fn()}
        headerHeight={0}
        overlayZ={0}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows correct slot and calls setMobilePanel when buttons clicked", () => {
    const setMobile = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <MobileLayout
        isMobile={true}
        mobilePanel={null}
        setMobilePanel={setMobile}
        headerHeight={10}
        overlayZ={50}
        codeSlot={<Code />}
        compileSlot={<Compile />}
        serialSlot={<Serial />}
        boardSlot={<Board />}
        onOpenPanel={onOpen}
        onClosePanel={onClose}
      />,
    );

    // no overlay initially
    expect(screen.queryByTestId("slot-code")).toBeNull();

    // Buttons exist via portal
    const codeBtn = screen.getByLabelText("Code Editor");
    const compileBtn = screen.getByLabelText("Compilation Output");
    const serialBtn = screen.getByLabelText("Serial Output");
    const boardBtn = screen.getByLabelText("Arduino Board");

    // click code button
    fireEvent.click(codeBtn);
    // setMobilePanel is invoked with a functional updater; verify behaviour
    const updater = setMobile.mock.calls[0][0] as (prev: MobilePanel) => MobilePanel;
    expect(updater(null)).toBe("code");
    expect(onOpen).toHaveBeenCalledWith("code");

    // simulate parent updating prop
    rerender(
      <MobileLayout
        isMobile={true}
        mobilePanel="code"
        setMobilePanel={setMobile}
        headerHeight={10}
        overlayZ={50}
        codeSlot={<Code />}
        compileSlot={<Compile />}
        serialSlot={<Serial />}
        boardSlot={<Board />}
        onOpenPanel={onOpen}
        onClosePanel={onClose}
      />,
    );

    // now code slot visible
    expect(screen.getByTestId("slot-code")).toBeInTheDocument();

    // click again to close
    fireEvent.click(codeBtn);
    // second call updater should close panel
    const updater2 = setMobile.mock.calls[1][0] as (prev: MobilePanel) => MobilePanel;
    expect(updater2("code")).toBe(null);
    expect(onClose).toHaveBeenCalled();
  });
});