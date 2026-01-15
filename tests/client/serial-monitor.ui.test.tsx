import { render, screen } from '@testing-library/react';
import { SerialMonitor } from '@/components/features/serial-monitor';

describe('SerialMonitor UI', () => {
  const baseProps = {
    isConnected: true,
    isSimulationRunning: true,
    onSendMessage: jest.fn(),
    onClear: jest.fn(),
  };

  it('zeigt den Serial-Frame an und rendert den Platzhalter ohne Output', async () => {
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

  it('blendet den Serial-Frame aus, wenn showMonitor=false gesetzt ist', () => {
    render(
      <SerialMonitor
        {...baseProps}
        showMonitor={false}
        output={[]}
      />
    );

    expect(screen.queryByTestId('serial-output')).toBeNull();
  });

  it('zeigt empfangenen Serial-Text im Frame an', async () => {
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
