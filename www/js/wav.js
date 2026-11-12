// Encode mono Float32 samples as a 16-bit PCM WAV blob.
//
// `meta` (optional) is stored as JSON in a private "lpsy" chunk: the tempo and length a pad
// sound was made at, so another Loopsy Doopsy can load it straight onto the grid. Other
// players skip chunks they don't know, so the file still plays anywhere.
export function encodeWav(samples, sampleRate, meta = null) {
  let extra = new Uint8Array(0);
  if (meta) {
    const json = new TextEncoder().encode(JSON.stringify(meta));
    extra = new Uint8Array(8 + json.length + (json.length & 1));
    const ev = new DataView(extra.buffer);
    'lpsy'.split('').forEach((c, i) => ev.setUint8(i, c.charCodeAt(0)));
    ev.setUint32(4, json.length, true);
    extra.set(json, 8);
  }
  const dataLen = samples.length * 2;
  const buf = new ArrayBuffer(44 + extra.length + dataLen);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + extra.length + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  new Uint8Array(buf).set(extra, 36);
  const d = 36 + extra.length;
  str(d, 'data');
  v.setUint32(d + 4, dataLen, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(d + 8 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// The "lpsy" metadata from a WAV file's bytes, or null if it hasn't any.
export function readWavMeta(arrayBuffer) {
  const v = new DataView(arrayBuffer);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (v.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let o = 12;
  while (o + 8 <= v.byteLength) {
    const id = tag(o);
    const len = v.getUint32(o + 4, true);
    if (id === 'lpsy') {
      try {
        return JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, o + 8, Math.min(len, v.byteLength - o - 8))));
      } catch {
        return null;
      }
    }
    o += 8 + len + (len & 1);
  }
  return null;
}
