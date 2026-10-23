import {
  barDur,
  beatDur,
  findOnset,
  loopOffset,
  median,
  mod,
  nextBoundary,
  peaks,
  phaseAt,
  recordStartTime,
  renderLoop,
} from './timing.js';

export const PAD_COUNT = 8;
export const PEAK_BINS = 180;
const LOOKAHEAD = 0.12; // seconds of metronome clicks scheduled ahead
const KEEP_SECONDS = 45; // how much mic history to keep for pre-roll / tails
const EDGE_FADE = 0.004; // seconds faded at loop seams

// A single pad. Plain data plus the live Web Audio nodes it owns.
class Pad {
  constructor(index) {
    this.index = index;
    this.reset();
    this.mode = 'loop';
    this.volume = 0.9;
  }
  reset() {
    this.state = 'empty'; // empty | armed | recording | processing | ready
    this.bars = null;
    this.free = false; // free-length (one-shot only), not locked to the grid
    this.fold = false; // wrap the overrun tail back onto the start of the loop
    this.raw = null; // full capture: pre-roll + take + overrun
    this.sampleRate = 0;
    this.trimStart = 0; // samples into raw where the loop starts
    this.lengthSamples = 0;
    this.gridBar = 0; // bar number (mod 840, divisible by 1..8) the take started on
    this.anchorBars = 0; // which bar of the loop's own cycle sample 0 lands on
    this.defaultStart = 0; // trimStart as captured, for "Reset" in the trim editor
    this.buffer = null;
    this.peaks = null;
    this.livePeaks = null;
    this.rec = null;
    this.enabled = false; // loop is switched on (plays whenever the transport runs)
    this.source = null;
    this.playFrom = 0; // context time at which buffer offset 0 played (for the playhead)
    this.pending = null; // { type: 'start'|'stop', at }
  }
  get hasSound() {
    return !!this.buffer;
  }
}

export class Engine extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.ctx = null;
    this.running = false;
    this.origin = 0;
    this.pads = Array.from({ length: PAD_COUNT }, (_, i) => new Pad(i));
    this.mic = null;
    this.micChunks = [];
    this.micUntil = 0; // last captured frame (exclusive)
    this.inputLevel = 0;
    this.levels = new Float32Array(160); // recent mic loudness, newest last (one per ~43 ms)
    this.session = null;
    this.nextClick = 0;
    this.clickIndex = 0;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get bar() {
    return barDur(this.settings.bpm, this.settings.beatsPerBar);
  }
  get beat() {
    return beatDur(this.settings.bpm);
  }
  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }
  // What the listener is hearing right now (the output path adds delay).
  get heardTime() {
    if (!this.ctx) return 0;
    return this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }

  // Round-trip latency in seconds: the time between scheduling a sound and the mic
  // capturing someone playing along with it.
  get latency() {
    if (this.settings.latencyMs != null) return this.settings.latencyMs / 1000;
    if (!this.ctx) return 0;
    const out = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    const inp = this.mic?.track.getSettings?.().latency || 0.01;
    return out + inp;
  }

  // Safe to call from every gesture: creates the context once (synchronously, so iOS
  // counts it as user-initiated) and resumes it if the OS suspended it.
  async init() {
    if (!this.initP) this.initP = this.setup();
    else if (this.ctx.state !== 'running') this.ctx.resume();
    await this.initP;
  }

  async setup() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;
    ctx.resume();
    await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    this.master = ctx.createGain();
    // Stacking several vocal loops easily goes over full scale; a fast limiter keeps it clean.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.master.connect(this.limiter).connect(ctx.destination);
    this.clickBus = ctx.createGain();
    this.clickBus.gain.value = 0.5;
    this.clickBus.connect(ctx.destination);
    this.sink = ctx.createGain(); // keeps capture worklets pulled without making sound
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);
    for (const pad of this.pads) {
      pad.gain = ctx.createGain();
      pad.gain.gain.value = pad.volume;
      pad.gain.connect(this.master);
      if (pad.raw && !pad.buffer) this.rebuild(pad);
    }
    this.timer = setInterval(() => this.tick(), 25);
  }

  // ---------- microphone ----------

  async ensureMic() {
    await this.init();
    if (this.mic) return this.mic;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: !!this.settings.echoCancel,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const ctx = this.ctx;
    const src = ctx.createMediaStreamSource(stream);
    // Mic boost: humming is quiet, so allow up to +12 dB before anything is captured.
    const boost = ctx.createGain();
    boost.gain.value = this.settings.micBoost ?? 1;
    src.connect(boost);
    const node = new AudioWorkletNode(ctx, 'capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { channels: 1 },
    });
    node.port.onmessage = (e) => this.onMicChunk(e.data);
    boost.connect(node);
    node.connect(this.sink);
    // Live vocals: mic -> live gain -> (session recorder, optional monitor)
    const live = ctx.createGain();
    live.gain.value = this.settings.liveMic ? 1 : 0;
    boost.connect(live);
    const monitor = ctx.createGain();
    monitor.gain.value = this.settings.monitor ? 1 : 0;
    live.connect(monitor);
    monitor.connect(ctx.destination);
    this.mic = { stream, track: stream.getAudioTracks()[0], src, boost, node, live, monitor };
    if (this.session) live.connect(this.session.merger, 0, 1);
    return this.mic;
  }

  async reopenMic() {
    if (!this.mic) return;
    const m = this.mic;
    this.mic = null;
    m.stream.getTracks().forEach((t) => t.stop());
    m.src.disconnect();
    m.boost.disconnect();
    m.node.disconnect();
    m.live.disconnect();
    m.monitor.disconnect();
    this.micChunks = [];
    await this.ensureMic();
  }

  applyLiveSettings() {
    if (!this.mic) return;
    const t = this.now;
    this.mic.live.gain.setTargetAtTime(this.settings.liveMic ? 1 : 0, t, 0.01);
    this.mic.monitor.gain.setTargetAtTime(this.settings.monitor ? 1 : 0, t, 0.01);
    this.mic.boost.gain.setTargetAtTime(this.settings.micBoost ?? 1, t, 0.01);
  }

  onMicChunk({ frame, data }) {
    const samples = data[0];
    this.micChunks.push({ frame, samples });
    this.micUntil = frame + samples.length;
    const keep = Math.max(KEEP_SECONDS, this.bar * 9 + 5) * this.ctx.sampleRate;
    while (this.micChunks.length && this.micChunks[0].frame + this.micChunks[0].samples.length < this.micUntil - keep) {
      this.micChunks.shift();
    }
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    this.inputLevel = Math.max(rms, this.inputLevel * 0.8);
    this.levels.copyWithin(0, 1);
    this.levels[this.levels.length - 1] = rms;
    // Feed the live waveform of any pad that is recording.
    const sr = this.ctx.sampleRate;
    const lat = this.latency;
    for (const pad of this.pads) {
      if (!pad.rec || !pad.livePeaks || (pad.state !== 'recording' && pad.state !== 'processing' && pad.state !== 'armed')) continue;
      const s = Math.round((pad.rec.start + lat) * sr);
      const len = Math.round((pad.rec.plannedEnd - pad.rec.start) * sr);
      const bins = pad.livePeaks.length;
      for (let i = 0; i < samples.length; i++) {
        const k = frame + i - s;
        if (k < 0 || k >= len) continue;
        const b = Math.floor((k / len) * bins);
        const v = Math.abs(samples[i]);
        if (v > pad.livePeaks[b]) pad.livePeaks[b] = v;
      }
    }
  }

  // Copy captured mic audio for frames [from, to) into a new array (zeros where missing).
  micRange(from, to) {
    const out = new Float32Array(Math.max(0, to - from));
    for (const { frame, samples } of this.micChunks) {
      const s = Math.max(from, frame);
      const e = Math.min(to, frame + samples.length);
      if (e > s) out.set(samples.subarray(s - frame, e - frame), s - from);
    }
    return out;
  }

  // ---------- transport ----------

  // `origin` is where bar 1 lands; enabled loops join from `startAt` (which may be later).
  startTransport(origin = this.now + 0.06, startAt = origin) {
    this.origin = origin;
    this.running = true;
    this.nextClick = origin;
    this.clickIndex = 0;
    for (const pad of this.pads) {
      if (pad.enabled && pad.hasSound && pad.mode === 'loop') this.startLoopAt(pad, Math.max(startAt, this.now + 0.02));
    }
    this.emit('transport');
  }

  stopTransport() {
    this.running = false;
    for (const pad of this.pads) {
      this.stopSource(pad, this.now);
      pad.pending = null;
      if (pad.state === 'armed' || pad.state === 'recording') this.cancelRecording(pad);
    }
    this.emit('transport');
  }

  // Bar:beat position for the display.
  position() {
    if (!this.running) return null;
    const t = this.heardTime - this.origin;
    if (t < 0) return { bar: 0, beat: Math.floor(t / this.beat), countIn: true };
    const beats = Math.floor(t / this.beat);
    return { bar: Math.floor(beats / this.settings.beatsPerBar) + 1, beat: (beats % this.settings.beatsPerBar) + 1, frac: mod(t, this.beat) / this.beat };
  }

  quantizedTime() {
    const now = this.now + 0.03;
    const q = this.settings.quantize;
    if (!this.running || q === 'off') return now;
    return nextBoundary(now, this.origin, q === 'beat' ? this.beat : this.bar);
  }

  // ---------- metronome / scheduler ----------

  tick() {
    if (!this.ctx) return;
    const now = this.now;
    if (this.running) {
      const counting = this.pads.some((p) => p.state === 'armed');
      const recording = this.pads.some((p) => p.state === 'recording');
      while (this.nextClick < now + LOOKAHEAD) {
        if (this.nextClick >= now - 0.01 && (this.settings.metronome || counting || (recording && this.settings.clickWhileRecording))) {
          this.click(this.nextClick, this.clickIndex % this.settings.beatsPerBar === 0, counting);
        }
        this.clickIndex++;
        this.nextClick = this.origin + this.clickIndex * this.beat;
      }
    }
    for (const pad of this.pads) this.updatePad(pad, now);
  }

  click(when, accent, loud) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(loud ? 1 : 0.6, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(g).connect(this.clickBus);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  // ---------- recording ----------

  async record(pad) {
    await this.ensureMic();
    const bar = this.bar;
    const bars = this.settings.loopBars;
    let start;
    if (!this.running) {
      const origin = this.now + 0.1;
      this.startTransport(origin);
      start = origin + (this.settings.countIn ? bar : 0);
    } else {
      start = recordStartTime(this.now, this.origin, bar, this.settings.countIn ? this.beat : 0.05);
    }
    this.stopSource(pad, this.now);
    pad.reset();
    pad.bars = bars;
    pad.state = 'armed';
    pad.rec = { start, end: start + bars * bar, plannedEnd: start + bars * bar };
    pad.gridBar = mod(Math.round((start - this.origin) / bar), 840);
    pad.anchorBars = pad.gridBar % bars;
    pad.livePeaks = new Float32Array(PEAK_BINS);
    this.emit('change', pad);
  }

  // Tap while recording: finish at the next bar line (shortens the loop to whole bars).
  finishEarly(pad) {
    if (pad.state !== 'recording') return;
    const end = Math.max(pad.rec.start + this.bar, nextBoundary(this.now + 0.05, pad.rec.start, this.bar));
    if (end >= pad.rec.end) return;
    // Squash the live waveform so the circle now represents the shorter loop.
    const ratio = (end - pad.rec.start) / (pad.rec.plannedEnd - pad.rec.start);
    const old = pad.livePeaks;
    pad.livePeaks = old.map((_, b) => old[Math.min(old.length - 1, Math.floor(b * ratio))]);
    pad.rec.end = end;
    pad.rec.plannedEnd = end;
    pad.bars = Math.round((end - pad.rec.start) / this.bar);
    pad.anchorBars = pad.gridBar % pad.bars;
    this.emit('change', pad);
  }

  cancelRecording(pad) {
    pad.reset();
    this.emit('change', pad);
  }

  updatePad(pad, now) {
    if (pad.state === 'armed' && now >= pad.rec.start) {
      pad.state = 'recording';
      this.emit('change', pad);
    }
    if (pad.state === 'recording' && now >= pad.rec.end) {
      pad.state = 'processing';
      this.emit('change', pad);
    }
    if (pad.rec && (pad.state === 'processing' || pad.state === 'ready')) this.collect(pad);
    // Pending start/stop bookkeeping (the audio itself is already scheduled).
    if (pad.pending && now >= pad.pending.at) {
      pad.pending = null;
      this.emit('change', pad);
    }
    if (pad.source && pad.mode === 'oneshot' && pad.oneshotEnd && now > pad.oneshotEnd) {
      pad.source = null;
      pad.oneshotEnd = 0;
      this.emit('change', pad);
    }
  }

  // Pull the finished take out of the mic history. Runs twice: once as soon as the take
  // itself is captured (so the loop can start straight away), then again once the overrun
  // tail is in, so the trim editor can use it.
  collect(pad) {
    const sr = this.ctx.sampleRate;
    const lat = this.latency;
    const { start, end } = pad.rec;
    const pre = Math.min(this.bar / 2, 1);
    const tail = Math.min(this.bar, 3);
    const from = Math.round((start + lat - pre) * sr);
    const takeEnd = Math.round((end + lat) * sr);
    const tailEnd = Math.round((end + lat + tail) * sr);
    if (!pad.raw && this.micUntil >= takeEnd) {
      pad.raw = this.micRange(from, takeEnd);
      pad.sampleRate = sr;
      pad.trimStart = Math.round(pre * sr);
      pad.defaultStart = pad.trimStart;
      pad.lengthSamples = Math.round(pad.bars * this.bar * sr);
      pad.mode = 'loop';
      this.rebuild(pad);
      pad.state = 'ready';
      pad.livePeaks = null;
      if (this.settings.autoPlay) {
        pad.enabled = true;
        // Join the loop already in progress, locked to the grid.
        if (this.running) this.startLoopAt(pad, this.now + 0.02);
      }
      this.emit('change', pad);
      this.emit('recorded', pad);
    }
    if (pad.raw && pad.rec && this.micUntil >= tailEnd) {
      pad.raw = this.micRange(from, tailEnd);
      pad.rec = null;
      if (pad.fold) this.replaceBuffer(pad);
      this.emit('saved', pad);
    }
  }

  // ---------- buffers ----------

  rebuild(pad) {
    if (!pad.raw) return;
    const sr = pad.sampleRate;
    const data = renderLoop(pad.raw, pad.trimStart, pad.lengthSamples, {
      fade: Math.round(EDGE_FADE * sr),
      fold: pad.fold && !pad.free ? Math.round(Math.min(this.bar / 2, 1.5) * sr) : 0,
    });
    if (this.ctx) {
      const buf = this.ctx.createBuffer(1, data.length, sr);
      buf.copyToChannel(data, 0);
      pad.buffer = buf;
    }
    const p = peaks(data, PEAK_BINS);
    let max = 0.05;
    for (const v of p) max = Math.max(max, v);
    pad.peaks = p.map((v) => v / max);
    if (pad.state === 'empty') pad.state = 'ready';
  }

  // Re-render after a trim/fold change and swap it in at the next bar without a gap.
  replaceBuffer(pad) {
    this.rebuild(pad);
    if (pad.source && pad.mode === 'loop' && this.running) {
      const at = nextBoundary(this.now + 0.03, this.origin, this.bar);
      this.stopSource(pad, at);
      this.startLoopAt(pad, at);
    }
    this.emit('change', pad);
  }

  // Change a pad's length: a whole number of bars (stays locked to the grid) or 'free'
  // (any length, one-shot only).
  setLength(pad, len) {
    if (len === 'free') {
      pad.free = true;
      if (pad.mode === 'loop') this.setMode(pad, 'oneshot');
    } else {
      pad.free = false;
      pad.bars = len;
      pad.lengthSamples = Math.round(len * this.bar * pad.sampleRate);
      pad.anchorBars = pad.gridBar % len;
    }
  }

  // ---------- playback ----------

  // Tap on a pad with a sound.
  async trigger(pad) {
    await this.init();
    if (!pad.hasSound) return;
    if (pad.mode === 'oneshot') return this.playOneShot(pad);
    const now = this.now;
    if (pad.enabled) {
      pad.enabled = false;
      if (!this.running || !pad.source) {
        pad.pending = null;
        this.stopSource(pad, now);
      } else {
        const at = this.quantizedTime();
        this.stopSource(pad, at);
        pad.pending = { type: 'stop', at };
      }
    } else {
      pad.enabled = true;
      if (!this.running) {
        // Start the transport so this loop's first sample lands on "now".
        const when = now + 0.04;
        this.startTransport(when - pad.anchorBars * this.bar, when);
      } else {
        const at = this.quantizedTime();
        this.startLoopAt(pad, at);
        if (at > now + 0.05) pad.pending = { type: 'start', at };
      }
    }
    this.emit('change', pad);
  }

  startLoopAt(pad, when) {
    if (!pad.buffer) return;
    if (pad.source) this.stopSource(pad, when);
    const src = this.ctx.createBufferSource();
    src.buffer = pad.buffer;
    src.loop = true;
    src.connect(pad.gain);
    const len = pad.buffer.duration;
    const anchor = pad.anchorBars * this.bar;
    const offset = loopOffset(when, this.origin, anchor, len);
    src.start(when, offset);
    pad.source = src;
    pad.playFrom = when - offset;
    pad.loopStartAt = when;
  }

  playOneShot(pad) {
    const now = this.now;
    if (pad.source) this.stopSource(pad, now);
    const src = this.ctx.createBufferSource();
    src.buffer = pad.buffer;
    src.connect(pad.gain);
    const when = this.settings.quantizeOneShots && this.running ? this.quantizedTime() : now;
    src.start(when);
    pad.source = src;
    pad.playFrom = when;
    pad.oneshotEnd = when + pad.buffer.duration;
    this.emit('change', pad);
  }

  stopSource(pad, when) {
    const src = pad.source;
    if (!src) return;
    try {
      src.stop(Math.max(when, this.now));
    } catch {
      /* already stopped */
    }
    if (when <= this.now + 0.005) pad.source = null;
    else
      src.onended = () => {
        if (pad.source === src) pad.source = null;
        this.emit('change', pad);
      };
  }

  // 0..1 position of the pad's playhead (what you hear), or null when silent.
  playhead(pad) {
    if (!pad.source || !pad.buffer) return null;
    const t = this.heardTime;
    const len = pad.buffer.duration;
    if (t < (pad.mode === 'loop' ? pad.loopStartAt : pad.playFrom)) return null;
    if (pad.mode === 'oneshot') {
      const p = (t - pad.playFrom) / len;
      return p >= 0 && p <= 1 ? p : null;
    }
    return phaseAt(t, pad.playFrom, len) / len;
  }

  setVolume(pad, v) {
    pad.volume = v;
    if (pad.gain) pad.gain.gain.setTargetAtTime(v, this.now, 0.02);
  }

  setMode(pad, mode) {
    if (pad.mode === mode || (mode === 'loop' && pad.free)) return;
    this.stopSource(pad, this.now);
    pad.pending = null;
    pad.enabled = false;
    pad.mode = mode;
    this.emit('change', pad);
  }

  clear(pad) {
    this.stopSource(pad, this.now);
    const snapshot = this.snapshot(pad);
    pad.reset();
    this.emit('change', pad);
    return snapshot;
  }

  snapshot(pad) {
    return {
      mode: pad.mode,
      volume: pad.volume,
      bars: pad.bars,
      free: pad.free,
      fold: pad.fold,
      raw: pad.raw,
      sampleRate: pad.sampleRate,
      trimStart: pad.trimStart,
      lengthSamples: pad.lengthSamples,
      anchorBars: pad.anchorBars,
      gridBar: pad.gridBar,
      defaultStart: pad.defaultStart,
    };
  }

  restore(pad, s) {
    this.stopSource(pad, this.now);
    pad.reset();
    Object.assign(pad, s);
    if (pad.gain) pad.gain.gain.value = pad.volume;
    if (pad.raw) {
      pad.state = 'ready';
      this.rebuild(pad);
    }
    this.emit('change', pad);
  }

  anyRecorded() {
    return this.pads.some((p) => p.raw || p.state !== 'empty');
  }

  // ---------- session (performance) recording ----------

  async startSession() {
    await this.init();
    if (this.settings.liveMic) await this.ensureMic();
    const ctx = this.ctx;
    const merger = ctx.createChannelMerger(2);
    const node = new AudioWorkletNode(ctx, 'capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions: { channels: 2 },
    });
    const chunks = [];
    node.port.onmessage = (e) => chunks.push(e.data);
    this.limiter.connect(merger, 0, 0);
    if (this.mic) this.mic.live.connect(merger, 0, 1);
    merger.connect(node);
    node.connect(this.sink);
    this.session = { merger, node, chunks, startedAt: this.now, latency: this.latency };
    this.emit('session');
  }

  async stopSession() {
    const s = this.session;
    if (!s) return null;
    this.session = null;
    this.emit('session');
    await new Promise((r) => setTimeout(r, 120 + s.latency * 1000)); // let the last batches land
    s.node.port.postMessage({ type: 'active', value: false });
    try {
      this.limiter.disconnect(s.merger);
    } catch {
      /* not connected */
    }
    if (this.mic) {
      try {
        this.mic.live.disconnect(s.merger);
      } catch {
        /* not connected */
      }
    }
    s.node.disconnect();
    if (!s.chunks.length) return null;
    const first = s.chunks[0].frame;
    const last = s.chunks.at(-1);
    const total = last.frame + last.data[0].length - first;
    const mix = new Float32Array(total);
    const voice = new Float32Array(total);
    for (const { frame, data } of s.chunks) {
      mix.set(data[0], frame - first);
      voice.set(data[1], frame - first);
    }
    // The voice was sung along to what the performer heard, so it arrives one round-trip
    // late relative to the pads. Pull it back into time before mixing.
    const shift = Math.round(s.latency * this.ctx.sampleRate);
    const length = Math.max(1, total - shift);
    const out = new Float32Array(length);
    let peak = 0;
    for (let i = 0; i < length; i++) {
      const v = mix[i] + voice[i + shift];
      out[i] = v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    if (peak > 0.99) for (let i = 0; i < length; i++) out[i] *= 0.99 / peak;
    return { samples: out, sampleRate: this.ctx.sampleRate };
  }

  // ---------- latency calibration ----------

  // Plays a few clicks through the speaker and listens for them with the mic.
  async calibrate() {
    await this.ensureMic();
    const ctx = this.ctx;
    const t0 = this.now + 0.4;
    const gap = 0.45;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const when = t0 + i * gap;
      const src = ctx.createBufferSource();
      const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.01), ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * (1 - j / d.length);
      src.buffer = b;
      src.connect(ctx.destination);
      src.start(when);
    }
    const sr = ctx.sampleRate;
    const endFrame = Math.round((t0 + n * gap + 0.2) * sr);
    while (this.micUntil < endFrame) await new Promise((r) => setTimeout(r, 50));
    const from = Math.round(t0 * sr);
    const data = this.micRange(from, endFrame);
    const found = [];
    for (let i = 0; i < n; i++) {
      const s = Math.round(i * gap * sr);
      const k = findOnset(data, s, Math.min(data.length, s + Math.round(0.4 * sr)));
      if (k >= 0) found.push((k - s) / sr);
    }
    if (found.length < n / 2) return null;
    return Math.round(median(found) * 1000);
  }
}
