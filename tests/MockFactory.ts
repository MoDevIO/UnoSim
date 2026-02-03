// MockFactory.ts
// Centralized factory for complex hardware state mocks

export function createArduinoMockState(options?: Partial<{
  serialBuffer: string;
  pinStates: Record<string, number>;
  registry: any;
}>): any {
  // Example: return a mock state object for Arduino
  return {
    serialBuffer: options?.serialBuffer || '',
    pinStates: options?.pinStates || {},
    registry: options?.registry || {},
    // Extend with more properties as needed
  };
}
