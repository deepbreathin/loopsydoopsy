import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseLayout } from '../www/js/layout.js';

test('narrow phone / OnePlus Open cover screen uses 2×4 with the Sing strip', () => {
  assert.equal(chooseLayout(352, 650, 10).kind, '2x4');
});

test('landscape phone uses 4×2 with the Sing strip', () => {
  assert.equal(chooseLayout(800, 280, 10).kind, '4x2');
});

test('near-square unfolded screen uses 3×3 with Sing as the ninth tile', () => {
  const l = chooseLayout(900, 700, 10); // OnePlus Open inner screen, landscape
  assert.equal(l.kind, '3x3');
  assert.equal(l.areas[8], '3 / 3');
  assert.equal(chooseLayout(820, 760, 10).kind, '3x3'); // inner screen, portrait
});

test('3×3 gives bigger pads than the alternatives on the inner screen', () => {
  const sq = chooseLayout(900, 700, 10).size;
  assert.ok(sq > 220, `pads are ${sq}px`);
});

test('book posture keeps pads off the fold', () => {
  const l = chooseLayout(900, 700, 10, { start: 445, end: 455 });
  assert.equal(l.kind, 'hinge');
  // Pads 1-4 in the two columns left of the hinge track, 5-8 right of it.
  for (let i = 0; i < 4; i++) assert.match(l.areas[i], / \/ [12]$/);
  for (let i = 4; i < 8; i++) assert.match(l.areas[i], / \/ [45]$/);
  const [cl] = l.columns.split(' ').map(parseFloat);
  assert.ok(2 * cl + 10 <= 445 - 10 + 0.01, 'left pads end a gap before the fold');
});
