// AudioWorklet that taps its input and posts batches of samples to the main thread,
// stamped with the context frame they were rendered at. This lets the main thread
// cut recordings at exact, grid-aligned sample positions.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels = options.processorOptions?.channels ?? 1;
    this.batch = options.processorOptions?.batch ?? 2048;
    this.bufs = Array.from({ length: this.channels }, () => new Float32Array(this.batch));
    this.fill = 0;
    this.startFrame = 0;
    this.active = options.processorOptions?.active ?? true;
    this.port.onmessage = (e) => {
      if (e.data.type === 'active') {
        this.active = e.data.value;
        this.fill = 0;
      }
    };
  }

  process(inputs) {
    if (!this.active) return true;
    const input = inputs[0];
    const n = input[0]?.length ?? 128;
    if (this.fill === 0) this.startFrame = currentFrame;
    for (let c = 0; c < this.channels; c++) {
      const src = input[c] ?? input[0];
      const dst = this.bufs[c];
      if (src) dst.set(src, this.fill);
      else dst.fill(0, this.fill, this.fill + n);
    }
    this.fill += n;
    if (this.fill >= this.batch) {
      const out = this.bufs.map((b) => b.slice(0, this.fill));
      this.port.postMessage({ frame: this.startFrame, data: out }, out.map((b) => b.buffer));
      this.fill = 0;
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
