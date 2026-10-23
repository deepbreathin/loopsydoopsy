import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUp, songBars } from '../www/js/song.js';

const playing = (sec) => sec.pads.flatMap((on, i) => (on ? [i] : []));

test('build-up brings pads in one at a time, breaks down and ends on the first', () => {
  const s = buildUp([
    { index: 0, bars: 4 },
    { index: 2, bars: 2 },
    { index: 5, bars: 4 },
  ]);
  assert.deepEqual(s.map(playing), [[0], [0, 2], [0, 2, 5], [0, 2, 5], [0, 2], [0, 2, 5], [0]]);
  assert.ok(s.every((sec) => sec.bars === 4));
  assert.equal(songBars(s), 28);
});

test('sections are at least as long as the longest loop', () => {
  assert.equal(buildUp([{ index: 1, bars: 8 }])[0].bars, 8);
  assert.equal(buildUp([{ index: 1, bars: 1 }])[0].bars, 4);
});

test('nothing to arrange', () => {
  assert.deepEqual(buildUp([]), []);
});
