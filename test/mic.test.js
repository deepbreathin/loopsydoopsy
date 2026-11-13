import { test } from 'node:test';
import assert from 'node:assert/strict';

// mic.js only touches the page when it's used; give it just enough to import.
globalThis.matchMedia = () => ({ matches: false });
globalThis.navigator ??= { userAgent: 'Mozilla/5.0 (Linux; Android 14)' };
const { explain } = await import('../www/js/mic.js');

test('each microphone problem gets a plain explanation', () => {
  assert.match(explain({ name: 'NotAllowedError' }).title, /blocked/);
  assert.ok(explain({ name: 'NotAllowedError' }).steps.length >= 2, 'with steps to unblock it');
  assert.match(explain({ name: 'NotReadableError' }).title, /busy/);
  assert.match(explain({ name: 'NotFoundError' }).title, /No microphone/);
  assert.match(explain({ name: 'Unsupported' }).text, /another app/);
  assert.match(explain(new Error('?')).title, /Couldn’t open/);
});

test('the browser is recognised from its user agent', async () => {
  const { browserFrom, INSTALL, MIC_UNBLOCK } = await import('../www/js/device.js');
  const cases = {
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36': 'samsung',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36': 'android-chrome',
    'Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0': 'android-firefox',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36 Instagram 300.0': 'inapp',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36': 'inapp',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1': 'ios-safari',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1': 'ios-chrome',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0': 'desktop-edge',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15': 'mac-safari',
  };
  assert.equal(browserFrom('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36', { brave: true }), 'android-brave');
  assert.ok(INSTALL['android-brave'].length && MIC_UNBLOCK['android-brave'].length);
  for (const [ua, want] of Object.entries(cases)) {
    const got = browserFrom(ua);
    assert.equal(got, want, ua);
    assert.ok(INSTALL[got]?.length && MIC_UNBLOCK[got]?.length, `steps for ${got}`);
  }
});
