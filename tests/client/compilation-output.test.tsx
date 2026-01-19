import { render, screen, fireEvent } from '@testing-library/react';
import { CompilationOutput } from '@/components/features/compilation-output';

describe('CompilationOutput', () => {
  it('should render output text', () => {
    render(
      <CompilationOutput
        output="Sketch uses 736 bytes (2%) of program storage space."
        onClear={jest.fn()}
      />
    );

    expect(screen.getByText(/Sketch uses 736 bytes/i)).toBeInTheDocument();
  });

  it('should render error message', () => {
    render(
      <CompilationOutput
        output="error: 'digitalWrit' was not declared in this scope"
        onClear={jest.fn()}
      />
    );

    expect(screen.getByText(/digitalWrit/i)).toBeInTheDocument();
  });

  it('should show placeholder when no output', () => {
    render(
      <CompilationOutput
        output=""
        onClear={jest.fn()}
      />
    );

    expect(screen.getByText(/Compilation output will appear here/i)).toBeInTheDocument();
  });

  it('should call onClear when clear button is clicked', () => {
    const onClear = jest.fn();
    render(
      <CompilationOutput
        output="Some output"
        onClear={onClear}
      />
    );

    const clearButton = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clearButton);

    expect(onClear).toHaveBeenCalled();
  });

  it('should handle multi-line output', () => {
    const multiLineOutput = `Sketch uses 736 bytes (2%) of program storage space.
Global variables use 9 bytes (0%) of dynamic memory.`;

    render(
      <CompilationOutput
        output={multiLineOutput}
        onClear={jest.fn()}
      />
    );

    expect(screen.getByTestId('compilation-text')).toHaveTextContent(/Sketch uses 736 bytes/i);
    expect(screen.getByTestId('compilation-text')).toHaveTextContent(/Global variables use 9 bytes/i);
  });
});
