// Record a real take in the real app on the phone, with a loop playing, and count holes.
// Usage: node drive-app.mjs [appQuery] [runs]
const PORT = process.env.CDP_PORT || 9333;
const BASE = 'http://localhost:8222';
const url = `${BASE}/www/?lab${process.argv[2] ? `&${process.argv[2]}` : ''}`;
const RUNS = Number(process.argv[3] || 2);

const version = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const rpc = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', m.params.exceptionDetails.exception?.description);
};
await new Promise((r) => (ws.onopen = r));
await rpc('Browser.grantPermissions', { origin: BASE, permissions: ['audioCapture'] }).catch(() => {});
const { targetInfos } = await rpc('Target.getTargets');
let t = targetInfos.find((x) => x.type === 'page' && x.url.startsWith(BASE));
const targetId = t ? t.targetId : (await rpc('Target.createTarget', { url })).targetId;
await rpc('Target.activateTarget', { targetId });
const { sessionId } = await rpc('Target.attachToTarget', { targetId, flatten: true });
await rpc('Runtime.enable', {}, sessionId);
await rpc('Network.enable', {}, sessionId);
await rpc('Network.setBypassServiceWorker', { bypass: true }, sessionId);
await rpc('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
await rpc('Page.enable', {}, sessionId);
await rpc('Page.navigate', { url }, sessionId);
await new Promise((r) => setTimeout(r, 3500));

const scenario = `(async () => {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  const e = window.loopsyEngine;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  e.settings.countIn = false;
  e.settings.loopBars = 2;
  await e.ensureMic();
  const sr = e.ctx.sampleRate;
  // A quiet loop on pad 1 so the speaker and the mixer are busy, as when layering.
  const n = Math.round(e.bar * 2 * sr);
  const loop = new Float32Array(n);
  for (let i = 0; i < n; i++) loop[i] = 0.02 * (Math.sin(2 * Math.PI * 220 * i / sr) + Math.sin(2 * Math.PI * 330 * i / sr));
  e.loadSound(e.pads[0], loop, sr, 2);
  e.pads[0].enabled = true;
  if (!e.running) e.startTransport();
  const out = { rate: sr, base: e.ctx.baseLatency, mode: e.latencyMode, mic: e.mic.track.getSettings().sampleRate, takes: [] };
  for (let k = 0; k < ${RUNS}; k++) {
    const pad = e.pads[1 + k];
    await e.record(pad);
    while (!pad.raw || pad.rec) await sleep(200);
    const x = pad.raw;
    const minRun = Math.round(sr * 0.0005);
    const where = []; let runs = 0, zeroed = 0;
    const from = Math.round(0.05 * sr);
    for (let i = from; i < x.length; i++) {
      if (x[i] !== 0) continue;
      const s = i; while (i < x.length && x[i] === 0) i++;
      if (i - s >= minRun) { runs++; zeroed += i - s; if (where.length < 15) where.push((s / sr).toFixed(2) + 's:' + ((i - s) / sr * 1000).toFixed(1) + 'ms'); }
    }
    out.takes.push({ seconds: +(x.length / sr).toFixed(2), holes: runs, silentPct: +(100 * zeroed / x.length).toFixed(2), where: where.join(' ') });
  }
  e.stopTransport();
  return JSON.stringify(out, null, 1);
})()`;
const res = await rpc('Runtime.evaluate', { expression: scenario, awaitPromise: true, userGesture: true, timeout: 300000 }, sessionId);
console.log(res.result?.value ?? JSON.stringify(res));
ws.close();
