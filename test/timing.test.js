import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barDur,
  findOnset,
  loopOffset,
  nextBoundary,
  peaks,
  phaseAt,
  recordStartTime,
  renderLoop,
  tapTempo,
} from '../js/timing.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('bar length', () => {
  close(barDur(120, 4), 2);
  close(barDur(90, 3), 2);
});

test('nextBoundary lands on or after t', () => {
  close(nextBoundary(10, 10, 2), 10);
  close(nextBoundary(10.001, 10, 2), 12);
  close(nextBoundary(9, 10, 2), 10);
  close(nextBoundary(3, 10, 2), 4); // origin in the future still works
});

test('recordStartTime gives at least the lead time', () => {
  // 120bpm 4/4: bars every 2s from origin 0. At t=1.9 with 0.5s lead, next bar after 2.4 is 4.
  close(recordStartTime(1.9, 0, 2, 0.5), 4);
  close(recordStartTime(1.2, 0, 2, 0.5), 2);
});

test('loops stay phase-locked to the grid', () => {
  // A 2-bar loop (4s) whose sample 0 was recorded on bar 2 (anchor 2s).
  const origin = 100;
  close(loopOffset(origin + 2, origin, 2, 4), 0); // bar 2: start of the loop
  close(loopOffset(origin + 4, origin, 2, 4), 2); // bar 3: halfway
  close(loopOffset(origin + 6, origin, 2, 4), 0); // bar 4: round again
  close(phaseAt(origin - 1, origin, 4), 3);
});

test('peaks bins max abs', () => {
  const d = new Float32Array([0, 0.5, -1, 0.2, 0, 0, 0.1, -0.3]);
  assert.deepEqual([...peaks(d, 4)].map((v) => +v.toFixed(2)), [0.5, 1, 0, 0.3]);
});

test('renderLoop cuts exact length and cuts off overrun', () => {
  const raw = new Float32Array(100).map((_, i) => (i >= 10 && i < 60 ? 1 : 0.5));
  const out = renderLoop(raw, 10, 50);
  assert.equal(out.length, 50);
  assert.ok(out.every((v) => v === 1));
});

test('renderLoop folds the overrun onto the start, fading out', () => {
  const raw = new Float32Array(30);
  raw.fill(0, 0, 20);
  raw.fill(1, 20, 30); // overrun after a 10-sample loop starting at 10
  const out = renderLoop(raw, 10, 10, { fold: 10 });
  close(out[0], 1);
  assert.ok(out[5] < out[1] && out[5] > 0);
});

test('renderLoop pads with silence past the capture', () => {
  const out = renderLoop(new Float32Array([1, 1, 1]), 1, 5);
  assert.deepEqual([...out], [1, 1, 0, 0, 0]);
});

test('findOnset finds a click after silence', () => {
  const d = new Float32Array(2000);
  for (let i = 0; i < d.length; i++) d[i] = (Math.sin(i) * 0.001);
  d[1500] = 0.5;
  assert.equal(findOnset(d, 0), 1500);
});

test('tap tempo', () => {
  assert.equal(tapTempo([0]), null);
  assert.equal(tapTempo([0, 0.5, 1, 1.5, 2]), 120);
  assert.equal(tapTempo([0, 0.6, 1.2]), 100);
});
