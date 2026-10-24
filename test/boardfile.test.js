import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBoard, encodeBoard } from '../www/js/boardfile.js';

test('a soundboard survives export and import', async () => {
  const raw = Float32Array.from({ length: 1001 }, (_, i) => Math.sin(i / 10) * 0.8);
  const board = {
    name: 'Hums',
    settings: { bpm: 84, beatsPerBar: 4 },
    song: { sections: [{ bars: 4, pads: [true, false, false, false, false, false, false, false] }] },
    pads: [null, { mode: 'loop', bars: 2, raw, sampleRate: 48000, trimStart: 10, lengthSamples: 900 }, null],
  };
  const back = await decodeBoard(await encodeBoard(board));
  assert.equal(back.name, 'Hums');
  assert.equal(back.settings.bpm, 84);
  assert.deepEqual(back.song, board.song);
  assert.equal(back.pads[0], null);
  const p = back.pads[1];
  assert.equal(p.trimStart, 10);
  assert.equal(p.raw.length, raw.length);
  assert.ok(p.raw.every((v, i) => Math.abs(v - raw[i]) < 1e-4), 'audio round-trips at 16-bit precision');
});

test('rejects other files', async () => {
  await assert.rejects(decodeBoard(new Blob(['hello'])), /Not a Loopsy/);
});
