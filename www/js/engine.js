import { applyEdits, barDur, beatDur, findOnset, median, mod, nextBoundary, peaks, phaseAt, renderLoop, rotate } from './timing.js';
import { blockPitch, pitchRange, pitchTrack } from './pitch.js';

export const PAD_COUNT = 8;
export const PEAK_BINS = 180;
export const LOOP_LENGTHS = [1, 2, 4, 8]; // bars; powers of two so every loop lines up
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
    this.startBar = 0; // bar of the loop grid the take began on (the loop is turned so it stays in place)
    this.edits = []; // silenced / moved parts of the capture, in `raw` samples (see applyEdits)
    this.raw = null; // full capture: pre-roll + take + overrun
    this.sampleRate = 0;
    this.trimStart = 0; // samples into raw where the loop starts
    this.lengthSamples = 0;
    this.defaultStart = 0; // trimStart as captured, for "Reset" in the trim editor
    this.buffer = null;
    this.peaks = null;
    this.pitchTrack = null; // MIDI note per ~40 ms of the loop (NaN = no clear pitch)
    this.pitchRange = null;
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
    this.pitches = new Float32Array(160).fill(NaN); // recent mic pitch, same clock as levels
    this.session = null;
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
    const opts = { latencyHint: 'interactive' };
    if (this.contextRate) opts.sampleRate = this.contextRate;
    const ctx = new (window.AudioContext || window.webkitAudioContext)(opts);
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

  // Open the microphone. The browser is asked straight away, in the same moment as the tap
  // that called this (some browsers, Brave among them, only show their question then);
  // the audio engine starts alongside.
  ensureMic() {
    if (this.mic) return Promise.resolve(this.mic);
    this.micP ??= this.openMic().finally(() => (this.micP = null));
    return this.micP;
  }

  async openMic() {
    const streamP = this.openStream();
    const initP = this.init();
    let stream;
    try {
      stream = await streamP;
    } finally {
      await initP.catch(() => {});
    }
    await initP;
    return this.connectMic(stream);
  }

  async openStream() {
    const audio = {
      echoCancellation: !!this.settings.echoCancel,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    };
    // The microphone chosen in Settings (kept per device, not in soundboards); if it has been
    // unplugged or switched off, fall back to the default one.
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no getUserMedia'), { name: 'Unsupported' });
    // Some devices refuse particular settings; step down to "any microphone" rather than fail.
    const tries = [this.micId ? { ...audio, deviceId: { exact: this.micId } } : null, audio, true].filter(Boolean);
    let stream;
    for (let i = 0; i < tries.length; i++) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: tries[i] });
        break;
      } catch (e) {
        if (e.name === 'NotAllowedError' || e.name === 'SecurityError' || i === tries.length - 1) throw e;
      }
    }
    return stream;
  }

  async connectMic(stream) {
    let src;
    try {
      src = this.ctx.createMediaStreamSource(stream);
    } catch (e) {
      // Firefox can't connect a microphone running at a different sample rate from the
      // audio engine (Chrome and Safari convert). Restart the engine at the mic's rate.
      const rate = stream.getAudioTracks()[0]?.getSettings?.().sampleRate;
      if (e.name !== 'NotSupportedError' || !rate || rate === this.ctx.sampleRate) {
        stream.getTracks().forEach((t) => t.stop());
        throw e;
      }
      await this.restartAt(rate);
      src = this.ctx.createMediaStreamSource(stream);
    }
    const ctx = this.ctx;
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

  // Rebuild the audio engine at another sample rate. Sounds are kept (audio buffers don't
  // belong to an engine); anything playing stops.
  async restartAt(rate) {
    this.stopTransport();
    clearInterval(this.timer);
    for (const pad of this.pads) pad.source = null;
    try {
      await this.ctx.close();
    } catch {
      /* already closed */
    }
    this.micChunks = [];
    this.micUntil = 0;
    this.contextRate = rate;
    this.initP = this.setup();
    await this.initP;
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
    this.pitches.copyWithin(0, 1);
    this.pitches[this.pitches.length - 1] = blockPitch(samples, this.ctx.sampleRate);
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
  //
  // Every loop is 1, 2, 4 or 8 bars and its first sample sits on the grid that starts at
  // `origin`. Loops always start from their beginning, at the moment the loops already
  // playing come back round to theirs, so everything stays lined up as recorded.

  // `origin` is where bar 1 lands; enabled loops start (from their beginning) at `startAt`.
  startTransport(origin = this.now + 0.06, startAt = origin) {
    this.origin = origin;
    this.running = true;
    for (const pad of this.pads) {
      if (pad.enabled && pad.hasSound && pad.mode === 'loop') {
        const at = Math.max(startAt, this.now + 0.02);
        this.startLoopAt(pad, at, phaseAt(at, origin, pad.buffer.duration));
      }
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

  // Loops that are playing (or about to), other than `except`.
  sounding(except) {
    return this.pads.filter((p) => p !== except && p.enabled && p.source && p.mode === 'loop');
  }

  // Length in bars of the longest loop playing: the cycle new things line up with.
  cycleBars(playing = this.sounding()) {
    return Math.max(0, ...playing.map((p) => p.bars || 1));
  }

  tick() {
    if (!this.ctx) return;
    const now = this.now;
    for (const pad of this.pads) this.updatePad(pad, now);
  }

  // ---------- count-in ----------

  beep(when, accent) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.8, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(g).connect(this.clickBus);
    osc.start(when);
    osc.stop(when + 0.06);
    return osc;
  }

  // Optional beeps for the bar before a recording. Never on the downbeat itself, so
  // nothing ends up in the take.
  countInBeeps(start) {
    if (!this.settings.countInBeeps) return [];
    const bpb = this.settings.beatsPerBar;
    const out = [];
    for (let i = bpb; i >= 1; i--) {
      const t = start - i * this.beat;
      if (t > this.now + 0.01) out.push(this.beep(t, i === bpb));
    }
    return out;
  }

  // ---------- recording ----------

  async record(pad) {
    await this.ensureMic();
    const bar = this.bar;
    const bars = this.settings.loopBars;
    const now = this.now;
    this.stopSource(pad, now);
    const lead = this.settings.countIn ? bar : 0;
    const playing = this.sounding(pad);
    let start;
    if (!this.running) {
      // Count in, then record; any loops switched on come in with you, from the top.
      start = now + 0.1 + lead;
      this.startTransport(start);
    } else if (!playing.length) {
      start = now + 0.1 + lead;
      this.origin = start;
    } else {
      // Start where the loops do: at the top of the playing loops (or, for a shorter take, at
      // the next point they line up with it), so new layers begin together with the old ones.
      // The pad only counts in for the last bar; before that it just waits.
      const unit = Math.min(bars, this.cycleBars(playing)) * bar;
      start = nextBoundary(now + Math.max(0.15, lead * 0.75), this.origin, unit);
    }
    pad.reset();
    pad.bars = bars;
    pad.state = 'armed';
    pad.rec = { start, end: start + bars * bar, plannedEnd: start + bars * bar, beeps: this.countInBeeps(start) };
    pad.livePeaks = new Float32Array(PEAK_BINS);
    this.emit('change', pad);
  }

  // Tap while recording: finish early, at the next 1 / 2 / 4 bar mark so it still lines up.
  finishEarly(pad) {
    if (pad.state !== 'recording') return;
    const elapsed = this.now + 0.05 - pad.rec.start;
    const bars = LOOP_LENGTHS.find((b) => b < pad.bars && b * this.bar >= elapsed);
    if (!bars) return;
    const end = pad.rec.start + bars * this.bar;
    // Squash the live waveform so the circle now represents the shorter loop.
    const ratio = (end - pad.rec.start) / (pad.rec.plannedEnd - pad.rec.start);
    const old = pad.livePeaks;
    pad.livePeaks = old.map((_, b) => old[Math.min(old.length - 1, Math.floor(b * ratio))]);
    pad.rec.end = end;
    pad.rec.plannedEnd = end;
    pad.bars = bars;
    this.emit('change', pad);
  }

  cancelRecording(pad) {
    for (const b of pad.rec?.beeps ?? []) {
      try {
        b.stop();
      } catch {
        /* already played */
      }
    }
    pad.reset();
    this.emit('change', pad);
  }

  updatePad(pad, now) {
    if (pad.state === 'armed' && now >= pad.rec.start) {
      // With nothing else playing, this take sets the grid everything else lines up with.
      if (!this.sounding(pad).length) this.origin = pad.rec.start;
      pad.rec.gridBar = Math.round((pad.rec.start - this.origin) / this.bar);
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
      pad.startBar = pad.rec.gridBar ?? 0;
      pad.mode = 'loop';
      this.rebuild(pad);
      pad.state = 'ready';
      pad.livePeaks = null;
      if (this.settings.autoPlay) {
        pad.enabled = true;
        // The loop's second time round began when recording ended; join it there.
        const at = this.now + 0.02;
        if (this.running) this.startLoopAt(pad, at, phaseAt(at, this.origin, pad.buffer.duration));
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
    const src = pad.edits?.length ? this.editedRaw(pad) : pad.raw;
    let data = renderLoop(src, pad.trimStart, pad.lengthSamples, {
      fade: Math.round(EDGE_FADE * sr),
      fold: pad.fold && !pad.free ? Math.round(Math.min(this.bar / 2, 1.5) * sr) : 0,
    });
    // A take that began partway through the loop cycle is turned so its first sample sits at
    // the top of the cycle; then "from the beginning" still lines up with the other loops.
    const turn = pad.free || !pad.bars ? 0 : mod(pad.startBar || 0, pad.bars);
    if (turn) data = rotate(data, Math.round((turn * pad.lengthSamples) / pad.bars));
    if (this.ctx) {
      const buf = this.ctx.createBuffer(1, data.length, sr);
      buf.copyToChannel(data, 0);
      pad.buffer = buf;
    }
    // Real loudness (not stretched to fill the pad), the same scale as the live view while
    // recording; the pad's volume is applied when it's drawn.
    pad.peaks = peaks(data, PEAK_BINS);
    // Pitch contour for the pitch strip; a little heavier, so off the critical path.
    clearTimeout(pad.pitchTimer);
    pad.pitchTimer = setTimeout(() => {
      pad.pitchTrack = pitchTrack(data, sr);
      pad.pitchRange = pitchRange(pad.pitchTrack);
    }, 30);
    if (pad.state === 'empty') pad.state = 'ready';
  }

  // The capture with its silences and moved parts applied.
  editedRaw(pad) {
    return applyEdits(pad.raw, pad.edits, Math.round(EDGE_FADE * pad.sampleRate));
  }

  // Re-render after a trim/fold change and swap it in at the next bar without a gap.
  replaceBuffer(pad) {
    this.rebuild(pad);
    if (pad.source && pad.mode === 'loop' && this.running) {
      const at = nextBoundary(this.now + 0.03, this.origin, this.bar);
      const offset = phaseAt(at, pad.playFrom, pad.buffer.duration);
      this.stopSource(pad, at);
      this.startLoopAt(pad, at, offset);
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
        const at = nextBoundary(now + 0.03, this.origin, this.bar);
        this.stopSource(pad, at);
        pad.pending = { type: 'stop', at };
      }
    } else {
      pad.enabled = true;
      const playing = this.sounding(pad);
      const busy = this.pads.some((p) => p.state === 'armed' || p.state === 'recording');
      if (!this.running) {
        this.startTransport(now + 0.04);
      } else if (!playing.length && !busy) {
        // Nothing else playing: start right away, from the top.
        const at = now + 0.04;
        this.origin = at;
        this.startLoopAt(pad, at);
      } else {
        // Come in from the top when the other loops next come round.
        const cycle = this.cycleBars(playing) || pad.bars;
        const at = nextBoundary(now + 0.03, this.origin, Math.min(pad.bars, cycle) * this.bar);
        if (pad.bars > cycle) this.origin = at; // a new longest loop: the grid restarts with it
        this.startLoopAt(pad, at);
        if (at > now + 0.05) pad.pending = { type: 'start', at };
      }
    }
    this.emit('change', pad);
  }

  // Start a loop at `when`, `offset` seconds into it (0 = from the beginning).
  startLoopAt(pad, when, offset = 0) {
    if (!pad.buffer) return;
    if (pad.source) this.stopSource(pad, when);
    const src = this.ctx.createBufferSource();
    src.buffer = pad.buffer;
    src.loop = true;
    src.connect(pad.gain);
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
    src.start(now);
    pad.source = src;
    pad.playFrom = now;
    pad.oneshotEnd = now + pad.buffer.duration;
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
      startBar: pad.startBar,
      edits: pad.edits.map((e) => ({ ...e })),
      raw: pad.raw,
      sampleRate: pad.sampleRate,
      trimStart: pad.trimStart,
      lengthSamples: pad.lengthSamples,
      defaultStart: pad.defaultStart,
    };
  }

  restore(pad, s) {
    this.stopSource(pad, this.now);
    pad.reset();
    const { anchorBars, gridBar, ...rest } = s; // fields from older saves
    Object.assign(pad, rest);
    // (Silences from before edits existed were saved as `mutes`.)
    pad.edits = (rest.edits || (rest.mutes || []).map(([a, b]) => ({ type: 'mute', a, b }))).map((e) => ({ ...e }));
    delete pad.mutes;
    if (pad.gain) pad.gain.gain.value = pad.volume;
    if (pad.raw) {
      pad.state = 'ready';
      this.rebuild(pad);
    }
    this.emit('change', pad);
  }

  // Put a sound from a file on a pad. `bars` locks it to the grid as a loop; without it the
  // sound becomes a free-length one-shot (it can be trimmed to a length later).
  loadSound(pad, samples, sampleRate, bars) {
    this.stopSource(pad, this.now);
    pad.reset();
    pad.raw = samples;
    pad.sampleRate = sampleRate;
    if (bars) {
      pad.bars = bars;
      pad.lengthSamples = Math.round(bars * this.bar * sampleRate);
      pad.mode = 'loop';
    } else {
      pad.free = true;
      pad.bars = this.settings.loopBars;
      pad.lengthSamples = samples.length;
      pad.mode = 'oneshot';
    }
    pad.state = 'ready';
    this.rebuild(pad);
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
