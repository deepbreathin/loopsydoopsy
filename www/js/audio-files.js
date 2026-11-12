// Audio files in and out: MP3 export of takes, and reading any audio file (WAV, MP3, M4A from
// an iPhone voice memo…) into samples a pad can use.
import { readWavMeta } from './wav.js';

// MP3 encoders only take these rates; anything else is resampled first.
const MP3_RATES = [48000, 44100, 32000, 24000, 22050, 16000];

export async function toMp3(samples, sampleRate, kbps = 128) {
  if (!MP3_RATES.includes(sampleRate)) {
    const to = 44100;
    const off = new OfflineAudioContext(1, Math.ceil((samples.length * to) / sampleRate), to);
    const b = off.createBuffer(1, samples.length, sampleRate);
    b.copyToChannel(samples, 0);
    const src = off.createBufferSource();
    src.buffer = b;
    src.connect(off.destination);
    src.start();
    samples = (await off.startRendering()).getChannelData(0);
    sampleRate = to;
  }
  const worker = new Worker(new URL('./mp3-worker.js', import.meta.url));
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => reject(e.error || new Error(e.message || 'MP3 encoding failed'));
      worker.postMessage({ samples, sampleRate, kbps });
    });
  } finally {
    worker.terminate();
  }
}

// Decode a WAV blob back to samples (the takes are stored as WAV).
export async function decodeWavBlob(ctx, blob) {
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  return { samples: mono(buf), sampleRate: buf.sampleRate };
}

// Read an audio file for a pad: mono samples at the app's rate, plus Loopsy metadata if it
// was sent from another Loopsy Doopsy.
export async function readAudioFile(ctx, file) {
  const bytes = await file.arrayBuffer();
  const meta = readWavMeta(bytes);
  const buf = await new Promise((resolve, reject) => {
    // Older Safari only has the callback form.
    const p = ctx.decodeAudioData(bytes.slice(0), resolve, reject);
    p?.catch?.(reject);
  });
  return { samples: mono(buf), sampleRate: buf.sampleRate, meta };
}

function mono(buf) {
  if (buf.numberOfChannels === 1) return new Float32Array(buf.getChannelData(0));
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}
