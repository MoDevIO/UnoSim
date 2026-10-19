import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InputGroup } from "@/components/ui/input-group";

describe("InputGroup", () => {
  it("keeps the field editable while only the send action is disabled, so an empty field can be typed into", () => {
    const onSubmit = vi.fn();
    render(<InputGroup placeholder="Send" value="" onChange={() => undefined} onSubmit={onSubmit} submitDisabled buttonTestId="send" />);

    const field = screen.getByPlaceholderText("Send");
    expect(field).toBeEnabled();
    expect(screen.getByTestId("send")).toBeDisabled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends on Enter and on the button when nothing is disabled", () => {
    const onSubmit = vi.fn();
    render(<InputGroup placeholder="Send" value="hi" onChange={() => undefined} onSubmit={onSubmit} buttonTestId="send" />);

    fireEvent.keyDown(screen.getByPlaceholderText("Send"), { key: "Enter" });
    fireEvent.click(screen.getByTestId("send"));

    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("disables the field, the button and Enter together with disabled", () => {
    const onSubmit = vi.fn();
    render(<InputGroup placeholder="Send" value="hi" onChange={() => undefined} onSubmit={onSubmit} disabled buttonTestId="send" />);

    expect(screen.getByPlaceholderText("Send")).toBeDisabled();
    expect(screen.getByTestId("send")).toBeDisabled();
    fireEvent.keyDown(screen.getByPlaceholderText("Send"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
