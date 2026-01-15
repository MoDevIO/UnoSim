import { describe, it, expect } from '@jest/globals';

// Helper function to extract pinMode data (extracted from parser-output.tsx)
function extractPinModeData(operations: Array<{ line: number; operation: string }>) {
  const pinModes = operations
    .filter(u => u.operation.includes('pinMode'))
    .map(u => {
      const match = u.operation.match(/pinMode:(\d+)/);
      const mode = match ? parseInt(match[1]) : -1;
      return mode === 0 ? 'INPUT' : mode === 1 ? 'OUTPUT' : mode === 2 ? 'INPUT_PULLUP' : 'UNKNOWN';
    });
  
  const uniqueModes = [...new Set(pinModes)];
  const hasMultipleModes = uniqueModes.length > 1;
  
  return { pinModes, uniqueModes, hasMultipleModes };
}

describe('ParserOutput - pinMode Detection', () => {
  describe('extractPinModeData', () => {
    it('should parse single pinMode:0 as INPUT', () => {
      const operations = [{ line: 0, operation: 'pinMode:0' }];
      const result = extractPinModeData(operations);
      
      expect(result.pinModes).toEqual(['INPUT']);
      expect(result.uniqueModes).toEqual(['INPUT']);
      expect(result.hasMultipleModes).toBe(false);
    });

    it('should parse single pinMode:1 as OUTPUT', () => {
      const operations = [{ line: 0, operation: 'pinMode:1' }];
      const result = extractPinModeData(operations);
      
      expect(result.pinModes).toEqual(['OUTPUT']);
      expect(result.uniqueModes).toEqual(['OUTPUT']);
      expect(result.hasMultipleModes).toBe(false);
    });

    it('should parse single pinMode:2 as INPUT_PULLUP', () => {
      const operations = [{ line: 0, operation: 'pinMode:2' }];
      const result = extractPinModeData(operations);
      
      expect(result.pinModes).toEqual(['INPUT_PULLUP']);
      expect(result.uniqueModes).toEqual(['INPUT_PULLUP']);
      expect(result.hasMultipleModes).toBe(false);
    });

    it('should detect multiple different modes (conflict)', () => {
      const operations = [
        { line: 0, operation: 'pinMode:1' },
        { line: 0, operation: 'pinMode:0' }
      ];
      const result = extractPinModeData(operations);
      
      expect(result.pinModes).toEqual(['OUTPUT', 'INPUT']);
      expect(result.uniqueModes).toEqual(['OUTPUT', 'INPUT']);
      expect(result.hasMultipleModes).toBe(true);
    });

    it('should detect same mode repeated', () => {
      const operations = [
        { line: 0, operation: 'pinMode:0' },
        { line: 0, operation: 'pinMode:0' },
        { line: 0, operation: 'pinMode:0' }
      ];
      const result = extractPinModeData(operations);
      
      expect(result.pinModes).toEqual(['INPUT', 'INPUT', 'INPUT']);
      expect(result.uniqueModes).toEqual(['INPUT']);
      expect(result.hasMultipleModes).toBe(false);
    });

    it('should handle mixed operations and extract only pinMode', () => {
      const operations = [
        { line: 5, operation: 'digitalWrite' },
        { line: 0, operation: 'pinMode:1' },
        { line: 8, operation: 'digitalRead' },
        { line: 0, operation: 'pinMode:0' }
      ];
      const result = extractPinModeData(operations);
      
      expect(result.pinModes).toEqual(['OUTPUT', 'INPUT']);
      expect(result.uniqueModes).toEqual(['OUTPUT', 'INPUT']);
      expect(result.hasMultipleModes).toBe(true);
    });

    it('should return UNKNOWN for invalid mode numbers', () => {
      const operations = [{ line: 0, operation: 'pinMode:99' }];
      const result = extractPinModeData(operations);
      
      expect(result.pinModes).toEqual(['UNKNOWN']);
      expect(result.uniqueModes).toEqual(['UNKNOWN']);
      expect(result.hasMultipleModes).toBe(false);
    });

    it('should return UNKNOWN for malformed pinMode operation', () => {
      const operations = [{ line: 0, operation: 'pinMode' }];
      const result = extractPinModeData(operations);
      
      expect(result.pinModes).toEqual(['UNKNOWN']);
      expect(result.uniqueModes).toEqual(['UNKNOWN']);
      expect(result.hasMultipleModes).toBe(false);
    });

    it('should handle empty operations array', () => {
      const operations: Array<{ line: number; operation: string }> = [];
      const result = extractPinModeData(operations);
      
      expect(result.pinModes).toEqual([]);
      expect(result.uniqueModes).toEqual([]);
      expect(result.hasMultipleModes).toBe(false);
    });

    it('should handle complex scenario with conflicts and repeats', () => {
      const operations = [
        { line: 0, operation: 'pinMode:1' },
        { line: 0, operation: 'pinMode:1' },
        { line: 0, operation: 'pinMode:0' },
        { line: 0, operation: 'pinMode:1' }
      ];
      const result = extractPinModeData(operations);
      
      expect(result.pinModes).toEqual(['OUTPUT', 'OUTPUT', 'INPUT', 'OUTPUT']);
      expect(result.uniqueModes).toEqual(['OUTPUT', 'INPUT']);
      expect(result.hasMultipleModes).toBe(true);
    });
  });

  describe('pinMode count logic', () => {
    it('should correctly count occurrences of each mode', () => {
      const pinModes = ['INPUT', 'INPUT', 'OUTPUT', 'INPUT'];
      const uniqueModes = [...new Set(pinModes)];
      
      const inputCount = pinModes.filter(m => m === 'INPUT').length;
      const outputCount = pinModes.filter(m => m === 'OUTPUT').length;
      
      expect(uniqueModes).toEqual(['INPUT', 'OUTPUT']);
      expect(inputCount).toBe(3);
      expect(outputCount).toBe(1);
    });
  });
});

describe('I/O Registry - pinMode Operation Format', () => {
  it('should match pinMode:0 format', () => {
    const operation = 'pinMode:0';
    const match = operation.match(/pinMode:(\d+)/);
    
    expect(match).not.toBeNull();
    expect(match![1]).toBe('0');
  });

  it('should match pinMode:1 format', () => {
    const operation = 'pinMode:1';
    const match = operation.match(/pinMode:(\d+)/);
    
    expect(match).not.toBeNull();
    expect(match![1]).toBe('1');
  });

  it('should match pinMode:2 format', () => {
    const operation = 'pinMode:2';
    const match = operation.match(/pinMode:(\d+)/);
    
    expect(match).not.toBeNull();
    expect(match![1]).toBe('2');
  });

  it('should not match plain pinMode without colon', () => {
    const operation = 'pinMode';
    const match = operation.match(/pinMode:(\d+)/);
    
    expect(match).toBeNull();
  });

  it('should not match pinMode with non-numeric mode', () => {
    const operation = 'pinMode:INPUT';
    const match = operation.match(/pinMode:(\d+)/);
    
    expect(match).toBeNull();
  });
});
