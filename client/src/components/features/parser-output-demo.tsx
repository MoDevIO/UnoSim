import { ParserOutput } from '@/components/features/parser-output';
import type { ParserMessage } from '@shared/schema';

export default function ParserOutputDemo() {
  const mockMessages: ParserMessage[] = [
    {
      id: '1',
      type: 'parser',
      category: 'serial',
      severity: 2,
      line: 5,
      column: 8,
      message: 'Serial.begin() uses non-standard baudrate',
      suggestion: 'Use standard baudrate like 115200 instead of 9600',
    },
    {
      id: '2',
      type: 'parser',
      category: 'hardware',
      severity: 3,
      line: 12,
      column: 15,
      message: 'analogWrite() used on non-PWM pin',
      suggestion: 'Use pin 3, 5, 6, 9, 10, or 11 for PWM output',
    },
    {
      id: '3',
      type: 'parser',
      category: 'pins',
      severity: 2,
      line: 18,
      column: 5,
      message: 'Pin conflict: A0 used as both digital and analog',
      suggestion: 'Use separate pins for digital and analog operations',
    },
    {
      id: '4',
      type: 'parser',
      category: 'performance',
      severity: 1,
      line: 25,
      column: 3,
      message: 'Infinite loop detected in setup()',
      suggestion: 'Move loop logic to loop() function instead',
    },
  ];

  return (
    <div className="w-full h-screen bg-gray-100 p-4">
      <div className="bg-white rounded-lg shadow-lg overflow-hidden" style={{ height: '500px' }}>
        <ParserOutput
          messages={mockMessages}
          onClear={() => console.log('Clear')}
          onGoToLine={(line) => console.log('Go to line:', line)}
        />
      </div>
    </div>
  );
}
