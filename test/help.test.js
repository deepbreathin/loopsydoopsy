import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAQ, searchFaq } from '../www/js/help.js';

test('the built-in guide finds sensible answers', () => {
  assert.match(searchFaq('how do I save as mp3')[0].q, /MP3/);
  assert.match(searchFaq('my microphone is blocked')[0].q, /microphone/i);
  assert.match(searchFaq('send to a friend')[0].q, /friend/);
  assert.match(searchFaq('are my projects saved on the phone?')[0].q, /saved/);
  assert.deepEqual(searchFaq('??'), []);
});

test('every guide entry has a question, keywords and an answer', () => {
  for (const f of FAQ) assert.ok(f.q && f.k && f.a.length > 20, f.q);
});
