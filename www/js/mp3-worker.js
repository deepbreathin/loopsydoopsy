// Encodes mono audio to MP3 off the main thread, so the app stays smooth while it works.
/* global lamejs */
importScripts('../vendor/lame.min.js');

self.onmessage = ({ data: { samples, sampleRate, kbps } }) => {
  const enc = new lamejs.Mp3Encoder(1, sampleRate, kbps);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const parts = [];
  const step = 1152 * 20;
  for (let i = 0; i < pcm.length; i += step) {
    const out = enc.encodeBuffer(pcm.subarray(i, i + step));
    if (out.length) parts.push(out);
  }
  const end = enc.flush();
  if (end.length) parts.push(end);
  self.postMessage(new Blob(parts, { type: 'audio/mpeg' }));
};
