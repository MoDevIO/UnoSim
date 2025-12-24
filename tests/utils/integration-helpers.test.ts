import { jest } from '@jest/globals';

describe('integration-helpers', () => {
  test('isServerRunningSync -> true when execSync succeeds', () => {
    jest.isolateModules(() => {
      const child_process = require('child_process');
      jest.spyOn(child_process, 'execSync').mockImplementation(() => Buffer.from('ok'));
      const mod = require('../../tests/utils/integration-helpers');
      expect(mod.isServerRunningSync()).toBe(true);
    });
  });

  test('isServerRunningSync -> false when execSync throws', () => {
    jest.isolateModules(() => {
      const child_process = require('child_process');
      jest.spyOn(child_process, 'execSync').mockImplementation(() => { throw new Error('no'); });
      const mod = require('../../tests/utils/integration-helpers');
      expect(mod.isServerRunningSync()).toBe(false);
    });
  });

  test('isServerRunning (async) resolves true when http.request returns 200', async () => {
    const http = require('http');
    const events = require('events');

    jest.spyOn(http, 'request').mockImplementation((opts: any, cb: any) => {
      const res = { statusCode: 200 };
      if (typeof cb === 'function') cb(res);
      const req = new events.EventEmitter();
      req.end = () => {};
      req.on = req.addListener;
      return req;
    });

    const mod = require('../../tests/utils/integration-helpers');
    await expect(mod.isServerRunning()).resolves.toBe(true);
  });
});
