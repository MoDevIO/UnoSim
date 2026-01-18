import { render, screen } from '@testing-library/react';
import { SerialMonitor } from '@/components/features/serial-monitor';

describe('SerialMonitor UI', () => {
  const baseProps = {
    isConnected: true,
    isSimulationRunning: true,
    onSendMessage: jest.fn(),
    onClear: jest.fn(),
  };

  it('displays the Serial frame and renders placeholder without output', async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        autoScrollEnabled
        output={[]}
      />
    );

    expect(screen.getByTestId('serial-output')).toBeInTheDocument();
    expect(await screen.findByText('Serial output will appear here...')).toBeInTheDocument();
  });

  it('hides the Serial frame when showMonitor=false is set', () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor={false}
        output={[]}
      />
    );

    expect(screen.queryByTestId('serial-output')).toBeNull();
  });

  it('displays received Serial text in the frame', async () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor
        output={[{ text: 'Hello World!', complete: true }]}
      />
    );

    expect(await screen.findByText('Hello World!')).toBeInTheDocument();
  });
});
