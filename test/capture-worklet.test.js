import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

test('capture batches keep frame positions and silence across render quanta', () => {
  const messages = [];
  const worklet = createContext({
    currentFrame: 100,
    AudioWorkletProcessor: class {
      port = { postMessage: (message, transfer) => messages.push(structuredClone(message, { transfer })) };
    },
    registerProcessor: (_, Processor) => {
      worklet.processor = new Processor({ processorOptions: { channels: 2, batch: 4 } });
    },
  });
  runInContext(readFileSync(new URL('../www/js/capture-worklet.js', import.meta.url), 'utf8'), worklet);

  const render = (frame, count, ...channels) => {
    worklet.currentFrame = frame;
    worklet.processor.process([channels.map((values) => Float32Array.from(values))], [[new Float32Array(count)]]);
  };
  render(100, 3, [1, 2, 3], [11, 12, 13]);
  render(103, 3, [4, 5, 6]);
  render(106, 2);

  assert.deepEqual(messages, [
    { frame: 100, data: [Float32Array.of(1, 2, 3, 4), Float32Array.of(11, 12, 13, 0)] },
    { frame: 104, data: [Float32Array.of(5, 6, 0, 0), Float32Array.of(0, 0, 0, 0)] },
  ]);
});
