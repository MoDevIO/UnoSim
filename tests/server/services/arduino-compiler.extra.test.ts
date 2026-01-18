import { ArduinoCompiler } from '../../../server/services/arduino-compiler';

describe('ArduinoCompiler - additional', () => {
  jest.setTimeout(10000);

  test('returns error when setup or loop missing', async () => {
    const compiler = await ArduinoCompiler.create();
    const res = await compiler.compile('int main() {}');
    expect(res.success).toBe(false);
    expect(res.errors).toMatch(/Missing Arduino functions/);
  });

  test('processes header includes and returns processedCode', async () => {
    const spy = jest.spyOn(ArduinoCompiler.prototype as any, 'compileWithArduinoCli')
      .mockResolvedValue({ success: true, output: 'Board: Arduino UNO' });

    const compiler = await ArduinoCompiler.create();
    const code = `#include "myheader.h"\nvoid setup(){}\nvoid loop(){}\nSerial.println("x");`;
    const headers = [{ name: 'myheader.h', content: 'int foo(){return 1; }' }];

    const res = await compiler.compile(code, headers);
    expect(res.success).toBe(true);
    expect(res.processedCode).toMatch(/myheader.h/);
    expect(res.output).toMatch(/Board: Arduino UNO/);

    spy.mockRestore();
  });
});
