import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockPitch, midiName, pitchRange, pitchTrack } from '../www/js/pitch.js';

const tone = (f, sr, secs, amp = 0.3) => {
  const x = new Float32Array(Math.round(sr * secs));
  // A voice-ish tone: fundamental plus a couple of harmonics.
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    x[i] = amp * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
  }
  return x;
};

test('detects sung notes across the vocal range', () => {
  for (const [f, name] of [
    [110, 'A2'],
    [196, 'G3'],
    [261.63, 'C4'],
    [440, 'A4'],
    [698.46, 'F5'],
  ]) {
    const m = blockPitch(tone(f, 48000, 2048 / 48000), 48000);
    assert.equal(midiName(m), name, `${f} Hz`);
  }
});

test('silence is unvoiced', () => {
  assert.ok(Number.isNaN(blockPitch(new Float32Array(2048), 48000)));
});

test('pitch track follows a melody and gives a sensible range', () => {
  const sr = 44100;
  const a = tone(220, sr, 0.5);
  const b = tone(330, sr, 0.5);
  const x = new Float32Array(a.length + b.length);
  x.set(a);
  x.set(b, a.length);
  const t = pitchTrack(x, sr);
  assert.equal(midiName(t[3]), 'A3');
  assert.equal(midiName(t[t.length - 3]), 'E4');
  const r = pitchRange(t);
  assert.ok(r.lo < 57 && r.hi > 64);
});
