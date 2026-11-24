import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../www/js/engine.js';

test('the playhead follows the output timestamp even if the latency estimate jumps', () => {
  const engine = new Engine({});
  engine.ctx = {
    state: 'running', currentTime: 1.25, outputLatency: 0.1,
    getOutputTimestamp: () => ({ contextTime: 1, performanceTime: performance.now() }),
  };
  assert.ok(Math.abs(engine.heardTime - 1) < 0.01);
  engine.ctx.outputLatency = 0.27;
  assert.ok(Math.abs(engine.heardTime - 1) < 0.01);
  engine.ctx.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 });
  assert.equal(engine.heardTime, 0.98);
});

test('a recording and its trim tail use the same capture offset', async () => {
  const engine = new Engine({ bpm: 120, beatsPerBar: 4, loopBars: 1 });
  engine.ctx = { currentTime: 1, sampleRate: 1000, baseLatency: 0.02, outputLatency: 0.1 };
  engine.ensureMic = async () => {};
  engine.rebuild = () => {};
  const ranges = [];
  engine.micRange = (from, to) => {
    ranges.push([from, to]);
    return new Float32Array(to - from);
  };
  const pad = engine.pads[0];
  await engine.record(pad);
  pad.state = 'processing';
  engine.ctx.outputLatency = 0.25;
  engine.micUntil = 3230;
  engine.collect(pad);
  assert.equal(pad.state, 'ready');
  engine.ctx.outputLatency = 0.05;
  engine.micUntil = 5230;
  engine.collect(pad);
  assert.deepEqual(ranges, [[230, 3230], [230, 5230]]);
  assert.equal(pad.rec, null);
});
