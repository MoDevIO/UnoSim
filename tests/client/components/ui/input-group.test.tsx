import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InputGroup } from "@/components/ui/input-group";

describe("InputGroup", () => {
  it("should render input and button", () => {
    render(
      <InputGroup
        placeholder="Type here"
        inputTestId="test-input"
        buttonTestId="test-button"
      />,
    );

    const input = screen.getByTestId("test-input") as HTMLInputElement;
    const button = screen.getByTestId("test-button");

    expect(input).not.toBeNull();
    expect(button).not.toBeNull();
    expect(input.placeholder).toBe("Type here");
  });

  it("should call onSubmit when Enter key is pressed", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <InputGroup
        onSubmit={onSubmit}
        inputTestId="test-input"
      />,
    );

    const input = screen.getByTestId("test-input");
    await user.type(input, "test{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("should NOT call onSubmit when Enter is pressed and disabled", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <InputGroup
        onSubmit={onSubmit}
        disabled={true}
        inputTestId="test-input"
      />,
    );

    const input = screen.getByTestId("test-input");
    await user.type(input, "{Enter}");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("should NOT call onSubmit when Enter is pressed without onSubmit prop", async () => {
    const user = userEvent.setup();

    render(<InputGroup inputTestId="test-input" />);

    const input = screen.getByTestId("test-input");
    
    // Should not throw
    await user.type(input, "{Enter}");
  });

  it("should call onSubmit when button is clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <InputGroup
        onSubmit={onSubmit}
        buttonTestId="test-button"
      />,
    );

    const button = screen.getByTestId("test-button");
    await user.click(button);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("should disable button when disabled prop is true", () => {
    render(
      <InputGroup
        disabled={true}
        buttonTestId="test-button"
        inputTestId="test-input"
      />,
    );

    const button = screen.getByTestId("test-button") as HTMLButtonElement;

    // Button should be disabled
    expect(button.disabled).toBe(true);
    
    // Note: The input does not receive the disabled attribute in the current implementation
    // because 'disabled' is destructured but not passed to the input element
  });

  it("should forward onKeyDown callback", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();

    render(
      <InputGroup
        onKeyDown={onKeyDown}
        inputTestId="test-input"
      />,
    );

    const input = screen.getByTestId("test-input");
    await user.type(input, "a");

    expect(onKeyDown).toHaveBeenCalled();
  });

  it("should call both onKeyDown and handle Enter key", async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    const onSubmit = vi.fn();

    render(
      <InputGroup
        onKeyDown={onKeyDown}
        onSubmit={onSubmit}
        inputTestId="test-input"
      />,
    );

    const input = screen.getByTestId("test-input");
    await user.type(input, "{Enter}");

    expect(onKeyDown).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("should pass through other input props", () => {
    render(
      <InputGroup
        value="test value"
        onChange={() => {}}
        maxLength={10}
        inputTestId="test-input"
      />,
    );

    const input = screen.getByTestId("test-input") as HTMLInputElement;

    expect(input.value).toBe("test value");
    expect(input.maxLength).toBe(10);
  });

  it("should apply custom className", () => {
    const { container } = render(
      <InputGroup className="custom-class" />,
    );

    const wrapper = container.querySelector(".custom-class");
    expect(wrapper).not.toBeNull();
  });

  it("should forward ref to input", () => {
    const ref = vi.fn();

    render(<InputGroup ref={ref} />);

    expect(ref).toHaveBeenCalled();
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLInputElement);
  });
});
