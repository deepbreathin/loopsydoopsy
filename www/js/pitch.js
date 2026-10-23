// Voice pitch detection (YIN). Pure functions so they can be unit-tested in Node.
// Audio is first decimated to ~12 kHz, which is plenty for singing (70 Hz – 1.1 kHz) and
// keeps the cost low enough to run live on a phone.

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiName = (m) => {
  const n = Math.round(m);
  return NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
};
export const isNatural = (m) => !NAMES[((Math.round(m) % 12) + 12) % 12].includes('♯');

// Average every `factor` samples (a crude low-pass + downsample).
export function decimate(x, factor) {
  if (factor <= 1) return x;
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let j = 0; j < factor; j++) s += x[i * factor + j];
    out[i] = s / factor;
  }
  return out;
}

export const decimationFor = (sr) => Math.max(1, Math.round(sr / 12000));

// Pitch of a (decimated) frame in Hz, or 0 if it's unvoiced / too quiet.
export function detectPitch(x, sr, { minF = 70, maxF = 1100, threshold = 0.15, minRms = 0.008 } = {}) {
  const maxTau = Math.min(Math.floor(sr / minF), Math.floor(x.length / 2));
  const minTau = Math.max(2, Math.floor(sr / maxF));
  const W = x.length - maxTau;
  if (W < minTau * 2) return 0;
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  if (Math.sqrt(e / x.length) < minRms) return 0;

  // Difference function and its cumulative-mean-normalised form.
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const v = x[i] - x[i + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  let run = 0;
  d[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    run += d[tau];
    d[tau] = run ? (d[tau] * tau) / run : 1;
  }
  // First dip under the threshold (then walk to its bottom).
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return 0;
  // Parabolic interpolation for sub-sample accuracy.
  const a = d[tau - 1];
  const b = d[tau];
  const c = tau + 1 <= maxTau ? d[tau + 1] : b;
  const den = a + c - 2 * b;
  const shift = den ? (a - c) / (2 * den) : 0;
  return sr / (tau + shift);
}

// Pitch (as MIDI note number, NaN when unvoiced) of one block of raw audio.
export function blockPitch(samples, sr) {
  const k = decimationFor(sr);
  const f = detectPitch(decimate(samples, k), sr / k);
  return f ? freqToMidi(f) : NaN;
}

// Pitch contour of a whole buffer: one value every `hop` seconds.
export function pitchTrack(data, sr, hop = 0.04) {
  const k = decimationFor(sr);
  const x = decimate(data, k);
  const dsr = sr / k;
  const step = Math.round(hop * dsr);
  const win = Math.round(0.045 * dsr);
  const n = Math.max(1, Math.floor(x.length / step));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * step;
    const f = s + win <= x.length ? detectPitch(x.subarray(s, s + win), dsr) : 0;
    out[i] = f ? freqToMidi(f) : NaN;
  }
  return smoothTrack(out);
}

// Drop one-frame blips and octave jumps so the display doesn't flicker.
export function smoothTrack(t) {
  const out = Float32Array.from(t);
  for (let i = 1; i < t.length - 1; i++) {
    const [a, b, c] = [t[i - 1], t[i], t[i + 1]];
    if (Number.isNaN(a) && Number.isNaN(c)) out[i] = NaN;
    else if (!Number.isNaN(a) && !Number.isNaN(c) && Math.abs(b - a) > 9 && Math.abs(b - c) > 9) out[i] = (a + c) / 2;
  }
  return out;
}

// Low / high note worth showing for a track (at least an octave so small wobbles stay small).
export function pitchRange(track) {
  const v = [...track].filter((m) => !Number.isNaN(m)).sort((a, b) => a - b);
  if (!v.length) return null;
  let lo = v[Math.floor(v.length * 0.05)];
  let hi = v[Math.floor(v.length * 0.95)];
  const mid = (lo + hi) / 2;
  if (hi - lo < 12) [lo, hi] = [mid - 6, mid + 6];
  return { lo: lo - 1, hi: hi + 1 };
}
