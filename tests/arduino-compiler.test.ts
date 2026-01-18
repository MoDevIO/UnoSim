import { ArduinoCompiler } from '../server/services/arduino-compiler';

describe('ArduinoCompiler', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('succeeds for a valid sketch and embeds headers', async () => {
    jest.spyOn(ArduinoCompiler.prototype, 'compileWithArduinoCli').mockResolvedValue({
      success: true,
      output: 'Sketch uses 123 bytes.\nGlobal variables use 10 bytes.\n\nBoard: Arduino UNO',
    } as any);

    const compiler = await ArduinoCompiler.create();

    const code = `#include "myh.h"\nvoid setup() { Serial.begin(115200); }\nvoid loop() {}`;
    const headers = [{ name: 'myh.h', content: '// header content\n#define FOO 1' }];

    const result = await compiler.compile(code, headers);

    expect(result.success).toBe(true);
    expect(result.arduinoCliStatus).toBe('success');
    expect(result.output).toContain('Board: Arduino UNO');
    expect(result.processedCode).toContain('// --- Start of myh.h ---');
    expect(result.processedCode).toContain('// header content');
  });

  it('returns error when arduino-cli reports compilation failures', async () => {
    // simulate compileWithArduinoCli returning errors (already cleaned)
    jest.spyOn(ArduinoCompiler.prototype, 'compileWithArduinoCli').mockResolvedValue({
      success: false,
      errors: 'sketch.ino:10: error: expected \';\' before \'}\n',
    } as any);

    const compiler = await ArduinoCompiler.create();
    const code = 'void setup() {}\nvoid loop() {}';

    const result = await compiler.compile(code);

    expect(result.success).toBe(false);
    expect(result.arduinoCliStatus).toBe('error');
    expect(result.errors).toBeTruthy();
    expect(result.errors).toContain('sketch.ino');
  });

  it('rejects invalid sketch missing setup or loop', async () => {
    const compileSpy = jest.spyOn(ArduinoCompiler.prototype, 'compileWithArduinoCli');

    const compiler = await ArduinoCompiler.create();
    const code = 'void setup() {} // missing loop';

    const result = await compiler.compile(code);

    // should never call compileWithArduinoCli because validation fails early
    expect(compileSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Missing Arduino functions');
    expect(result.arduinoCliStatus).toBe('error');
  });

  it('handles arduino-cli not available (spawn error)', async () => {
    jest.spyOn(ArduinoCompiler.prototype, 'compileWithArduinoCli').mockResolvedValue(null as any);

    const compiler = await ArduinoCompiler.create();
    const code = 'void setup() {}\nvoid loop() {}';

    const result = await compiler.compile(code);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Arduino CLI not available');
    expect(result.arduinoCliStatus).toBe('error');
  });
});
