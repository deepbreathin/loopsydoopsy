import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, readWavMeta } from '../www/js/wav.js';
import { fitBars, rotate } from '../www/js/timing.js';

test('a pad WAV carries its tempo and length, and still reads as a normal WAV', async () => {
  const samples = Float32Array.from({ length: 101 }, (_, i) => Math.sin(i / 5) * 0.5);
  const meta = { app: 'loopsy', v: 1, bpm: 92.5, beatsPerBar: 3, bars: 2, free: false, mode: 'loop' };
  const buf = await encodeWav(samples, 48000, meta).arrayBuffer();
  assert.deepEqual(readWavMeta(buf), meta);
  const v = new DataView(buf);
  assert.equal(v.getUint32(4, true), buf.byteLength - 8, 'RIFF size covers every chunk');
  // The data chunk is still found by walking the chunks, as a player would.
  let o = 12;
  let found = null;
  while (o + 8 <= buf.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(buf, o, 4));
    const len = v.getUint32(o + 4, true);
    if (id === 'data') found = { o: o + 8, len };
    o += 8 + len + (len & 1);
  }
  assert.equal(found.len, samples.length * 2);
  assert.ok(Math.abs(v.getInt16(found.o + 2 * 10, true) / 0x7fff - samples[10]) < 1e-4);
});

test('plain WAVs have no metadata', async () => {
  const buf = await encodeWav(new Float32Array(10), 44100).arrayBuffer();
  assert.equal(readWavMeta(buf), null);
  assert.equal(readWavMeta(new ArrayBuffer(4)), null);
});

test('rotate turns a loop round, wrapping', () => {
  const d = Float32Array.from([0, 1, 2, 3, 4, 5]);
  assert.deepEqual([...rotate(d, 2)], [4, 5, 0, 1, 2, 3]);
  assert.deepEqual([...rotate(d, -1)], [1, 2, 3, 4, 5, 0]);
  assert.equal(rotate(d, 6), d);
});

test('fitBars recognises whole-bar loops', () => {
  assert.equal(fitBars(8.02, 2, [1, 2, 4, 8]), 4);
  assert.equal(fitBars(2, 2, [1, 2, 4, 8]), 1);
  assert.equal(fitBars(5, 2, [1, 2, 4, 8]), null);
});
