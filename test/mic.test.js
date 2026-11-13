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
