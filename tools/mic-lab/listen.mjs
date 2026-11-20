// Attach to Loopsy in the phone's Chromium browser and report audio-output dropouts (crackle) once a
// second, plus mic open/close, so a take can be "listened to" objectively. Usage: node listen.mjs <url>
const v = await (await fetch('http://localhost:9333/json/version')).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const P = new Map();
const rpc = (m, params = {}, sessionId) => new Promise((res, rej) => { const n = ++id; P.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params, sessionId })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && P.has(m.id)) { const q = P.get(m.id); P.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const url = process.argv[2];
const { targetInfos } = await rpc('Target.getTargets');
const t = targetInfos.find((x) => x.type === 'page' && (x.url.startsWith('http://localhost:8222') || x.url === 'about:blank' || x.url.includes('loopsydoopsy'))) ?? { targetId: (await rpc('Target.createTarget', { url: 'about:blank' })).targetId };
const { sessionId } = await rpc('Target.attachToTarget', { targetId: t.targetId, flatten: true });
await rpc('Target.activateTarget', { targetId: t.targetId });
await rpc('Page.enable', {}, sessionId);
await rpc('Runtime.enable', {}, sessionId);
// Keep hold of every AudioContext and mic stream the page makes.
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__ctxs = []; window.__mics = [];
  const AC = window.AudioContext;
  window.AudioContext = window.webkitAudioContext = class extends AC { constructor(...a) { super(...a); window.__ctxs.push(this); } };
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => { const s = await gum(c); window.__mics.push(s); return s; };
` }, sessionId);
await rpc('Page.navigate', { url }, sessionId);
await new Promise((r) => setTimeout(r, 3000));
const t0 = Date.now();
let last = null;
for (;;) {
  await new Promise((r) => setTimeout(r, 1000));
  let r;
  try {
    r = await rpc('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const c = window.__ctxs?.at(-1); if (!c) return null;
      const s = c.playbackStats || {};
      return { state: c.state, t: +c.currentTime.toFixed(1), rate: c.sampleRate, base: c.baseLatency, underruns: s.underrunEvents ?? null, underrunMs: s.underrunDuration != null ? Math.round(s.underrunDuration * 1000) : null,
        micOpen: window.__mics.some((m) => m.getAudioTracks().some((t) => t.readyState === 'live')), contexts: window.__ctxs.length };
    })()` }, sessionId);
  } catch (e) { console.log('lost the page:', e.message); break; }
  const s = r.result?.value;
  if (!s) continue;
  const d = last && s.underruns != null ? s.underruns - last.underruns : 0;
  const line = `${((Date.now() - t0) / 1000).toFixed(0)}s ctx ${s.state} @${s.t}s · mic ${s.micOpen ? 'OPEN' : 'closed'} · dropouts total ${s.underruns} (${s.underrunMs} ms)${d > 0 ? `  <<< +${d} NEW CRACKLE` : ''}`;
  if (!last || d > 0 || s.micOpen !== last.micOpen || s.state !== last.state || s.contexts !== last.contexts) console.log(line);
  last = s;
}
