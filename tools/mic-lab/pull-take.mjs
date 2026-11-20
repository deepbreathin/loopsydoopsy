// Pull the most recently recorded pad (raw capture) out of Loopsy's IndexedDB on the phone.
const v = await (await fetch('http://localhost:9333/json/version')).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const P = new Map();
const rpc = (m, params = {}, sessionId) => new Promise((res, rej) => { const n = ++id; P.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params, sessionId })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && P.has(m.id)) { const q = P.get(m.id); P.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const { targetInfos } = await rpc('Target.getTargets');
const t = targetInfos.find((x) => x.type === 'page' && x.url.includes('loopsydoopsy'));
const { sessionId } = await rpc('Target.attachToTarget', { targetId: t.targetId, flatten: true });
const r = await rpc('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
  const db = await new Promise((res, rej) => { const q = indexedDB.open('loopsydoopsy'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const all = await new Promise((res) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => res(q.result); });
  all.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const p = all[0];
  const pads = (p.pads || []).map((x, i) => ({ i, x })).filter(({ x }) => x && x.raw);
  const pick = pads.at(-1);
  if (!pick) return { project: p.name, pads: 0 };
  const raw = pick.x.raw instanceof Float32Array ? pick.x.raw : new Float32Array(pick.x.raw.buffer || pick.x.raw);
  // base64 of the float32 bytes
  const u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength); let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return { project: p.name, updated: p.updated, pad: pick.i, sampleRate: pick.x.sampleRate, trimStart: pick.x.trimStart, lengthSamples: pick.x.lengthSamples, keys: Object.keys(pick.x), b64: btoa(s) };
})()` }, sessionId);
const val = r.result.value;
if (!val?.b64) { console.log(JSON.stringify(val ?? r)); process.exit(1); }
const fs = await import('node:fs');
const name = `results/${new Date().toISOString().replace(/[:.]/g, '-')}-owen-app-take.f32`;
fs.writeFileSync(name, Buffer.from(val.b64, 'base64'));
delete val.b64;
console.log(name, JSON.stringify(val));
ws.close();
