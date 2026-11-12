// Pure timing / DSP helpers. No DOM or Web Audio here so they can be unit-tested in Node.

export const beatDur = (bpm) => 60 / bpm;
export const barDur = (bpm, beatsPerBar) => beatDur(bpm) * beatsPerBar;

// Positive modulo.
export const mod = (a, n) => ((a % n) + n) % n;

// First grid point (origin + k * period) at or after `t`.
export function nextBoundary(t, origin, period) {
  const k = Math.ceil((t - origin) / period - 1e-9);
  return origin + k * period;
}

// Position (seconds) within a repeating cycle of `period` that started at `origin`.
export const phaseAt = (t, origin, period) => mod(t - origin, period);

// Time to start a recording: the next bar line, with at least `minLead` seconds of warning.
export function recordStartTime(now, origin, bar, minLead) {
  return nextBoundary(now + minLead, origin, bar);
}

// Where a loop should start playing from (seconds into its buffer) when launched at `when`,
// so it stays locked to the global grid. `anchor` is how far into the grid cycle the
// loop's sample 0 sits (in seconds).
export function loopOffset(when, origin, anchor, loopLen) {
  return phaseAt(when - anchor, origin, loopLen);
}

// Peak envelope: max |sample| per bin, from `start` for `length` samples.
export function peaks(data, bins, start = 0, length = data.length - start) {
  const out = new Float32Array(bins);
  if (length <= 0) return out;
  const per = length / bins;
  for (let b = 0; b < bins; b++) {
    const s = start + Math.floor(b * per);
    const e = Math.min(start + Math.floor((b + 1) * per), start + length, data.length);
    let m = 0;
    for (let i = Math.max(0, s); i < e; i++) {
      const v = data[i] < 0 ? -data[i] : data[i];
      if (v > m) m = v;
    }
    out[b] = m;
  }
  return out;
}

// Cut a fixed-length loop out of a raw capture.
//  raw       Float32Array of the full capture (pre-roll + take + overrun tail)
//  start     sample index where the loop begins
//  length    loop length in samples
//  opts.fade   edge fade in samples (removes clicks at the loop seam)
//  opts.fold   samples of overrun after the loop end to wrap back onto the start, faded out
export function renderLoop(raw, start, length, { fade = 0, fold = 0 } = {}) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const j = start + i;
    out[i] = j >= 0 && j < raw.length ? raw[j] : 0;
  }
  const f = Math.min(fade, Math.floor(length / 2));
  for (let i = 0; i < f; i++) out[i] *= i / f;
  const n = Math.min(fold, length, Math.max(0, raw.length - (start + length)));
  if (n > 0) {
    // The overrun is the natural continuation of the loop's last sample, so wrapping it
    // onto the start keeps the seam continuous; it fades out so it doesn't build up.
    for (let i = 0; i < n; i++) out[i] += raw[start + length + i] * (1 - i / n);
  } else {
    for (let i = 0; i < f; i++) out[length - 1 - i] *= i / f;
  }
  return out;
}

// Turn a loop round by `shift` samples: out[j] = data[j - shift] (wrapping).
export function rotate(data, shift) {
  const n = data.length;
  const k = mod(Math.round(shift), n || 1);
  if (!k) return data;
  const out = new Float32Array(n);
  out.set(data.subarray(n - k), 0);
  out.set(data.subarray(0, n - k), k);
  return out;
}

// A copy of `raw` with each [from, to) range silenced, fading in and out over `fade` samples
// at the edges so there are no clicks. The length never changes.
export function applyMutes(raw, ranges, fade = 0) {
  const out = new Float32Array(raw);
  for (const [a0, b0] of ranges) {
    const a = Math.max(0, Math.min(a0, b0));
    const b = Math.min(raw.length, Math.max(a0, b0));
    if (b <= a) continue;
    const f = Math.min(fade, Math.floor((b - a) / 2));
    for (let i = a; i < b; i++) {
      const edge = Math.min(i - a, b - 1 - i);
      out[i] *= f && edge < f ? 1 - (edge + 1) / (f + 1) : 0;
    }
  }
  return out;
}

// Where a buffer position (sample index into a rendered loop) came from in the raw capture,
// undoing the turn applied to takes that began partway through the loop cycle.
export const rawIndex = (i, trimStart, length, shift) => trimStart + mod(i - shift, length);

// How many bars a sound of `seconds` is, if it's (very nearly) one of `lengths`; else null.
export function fitBars(seconds, bar, lengths, tolerance = 0.03) {
  for (const n of lengths) if (Math.abs(seconds / bar - n) <= n * tolerance) return n;
  return null;
}

// Median of a numeric array (used for latency calibration).
export function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Find the first onset in `data` after `from`, using a threshold relative to the noise floor.
// Returns a sample index or -1.
export function findOnset(data, from = 0, to = data.length, ratio = 6, minAbs = 0.02) {
  let floor = 0;
  const probe = Math.min(to, from + 256);
  for (let i = from; i < probe; i++) floor += Math.abs(data[i]);
  floor /= Math.max(1, probe - from);
  const thr = Math.max(minAbs, floor * ratio);
  for (let i = from; i < to; i++) if (Math.abs(data[i]) > thr) return i;
  return -1;
}

// Tap-tempo: BPM from a list of tap timestamps (seconds). Uses the last few intervals.
export function tapTempo(taps) {
  if (taps.length < 2) return null;
  const recent = taps.slice(-6);
  const iv = [];
  for (let i = 1; i < recent.length; i++) iv.push(recent[i] - recent[i - 1]);
  const bpm = 60 / median(iv);
  return Number.isFinite(bpm) ? Math.round(Math.min(240, Math.max(40, bpm)) * 10) / 10 : null;
}
