// A soundboard as a single file (.loopsy): every pad's audio plus its settings and the
// song, so it can be backed up, sent to another phone and opened again.
//
// Layout: "LOOPSY1\n" + "<header length>\n" + header JSON + 16-bit PCM for each pad,
// back to back, in the order listed in the header.

const MAGIC = 'LOOPSY1\n';

export async function encodeBoard(board) {
  const pads = [];
  const chunks = [];
  for (const p of board.pads ?? []) {
    if (!p?.raw) {
      pads.push(null);
      continue;
    }
    const { raw, ...meta } = p;
    const pcm = new Int16Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const v = Math.max(-1, Math.min(1, raw[i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    pads.push({ ...meta, samples: raw.length });
    chunks.push(pcm);
  }
  const header = JSON.stringify({ name: board.name, settings: board.settings, song: board.song, pads });
  const headerBytes = new TextEncoder().encode(header);
  return new Blob([MAGIC, `${headerBytes.length}\n`, headerBytes, ...chunks], { type: 'application/octet-stream' });
}

export async function decodeBoard(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder();
  if (dec.decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) throw new Error('Not a Loopsy Doopsy soundboard');
  let i = MAGIC.length;
  let j = i;
  while (bytes[j] !== 10) j++;
  const len = Number(dec.decode(bytes.subarray(i, j)));
  const header = JSON.parse(dec.decode(bytes.subarray(j + 1, j + 1 + len)));
  let off = j + 1 + len;
  const pads = header.pads.map((p) => {
    if (!p) return null;
    const { samples, ...meta } = p;
    // Copy out so the Int16 view is aligned regardless of where it sits in the file.
    const pcm = new Int16Array(bytes.slice(off, off + samples * 2).buffer);
    off += samples * 2;
    const raw = new Float32Array(samples);
    for (let k = 0; k < samples; k++) raw[k] = pcm[k] / (pcm[k] < 0 ? 0x8000 : 0x7fff);
    return { ...meta, raw };
  });
  return { name: header.name, settings: header.settings, song: header.song, pads };
}
