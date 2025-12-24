import { getCharDelayMs } from '../../../server/services/arduino-runner';

describe('ArduinoRunner helpers', () => {
  test('getCharDelayMs returns expected delays for ranges', () => {
    expect(getCharDelayMs(100)).toBe(33);
    expect(getCharDelayMs(600)).toBe(8);
    expect(getCharDelayMs(1800)).toBe(4);
    expect(getCharDelayMs(3600)).toBe(2);
    expect(getCharDelayMs(9600)).toBe(1);
  });
});
