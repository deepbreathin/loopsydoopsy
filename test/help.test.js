import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAQ, formTarget, searchFaq } from '../www/js/help.js';

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

test('a Google Form pre-filled link gives where to post and the field', () => {
  const t = formTarget('https://docs.google.com/forms/d/e/1FAIpQLSabc-123_x/viewform?usp=pp_url&entry.1234567890=hello');
  assert.deepEqual(t, { action: 'https://docs.google.com/forms/d/e/1FAIpQLSabc-123_x/formResponse', field: 'entry.1234567890' });
  assert.equal(formTarget(''), null);
  assert.equal(formTarget('https://example.com'), null);
});
