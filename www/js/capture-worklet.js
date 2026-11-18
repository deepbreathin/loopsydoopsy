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

  process(inputs, outputs) {
    if (!this.active) return true;
    const input = inputs[0];
    const frames = outputs[0][0].length;
    let offset = 0;
    while (offset < frames) {
      if (this.fill === 0) this.startFrame = currentFrame + offset;
      const count = Math.min(frames - offset, this.batch - this.fill);
      for (let c = 0; c < this.channels; c++) {
        const src = input[c];
        const dst = this.bufs[c];
        if (!src) dst.fill(0, this.fill, this.fill + count);
        else dst.set(count === frames ? src : src.subarray(offset, offset + count), this.fill);
      }
      this.fill += count;
      offset += count;
      if (this.fill === this.batch) {
        // Hand off the full batch directly to avoid a second PCM copy on the audio thread.
        const data = this.bufs;
        this.bufs = Array.from({ length: this.channels }, () => new Float32Array(this.batch));
        this.port.postMessage({ frame: this.startFrame, data }, data.map((b) => b.buffer));
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
