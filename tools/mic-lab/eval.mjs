// Evaluate an expression in the phone's Chromium lab tab. Usage: node eval.mjs '<expr>' [url-path]
const v = await (await fetch('http://localhost:9333/json/version')).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const P = new Map();
const rpc = (m, params = {}, sessionId) => new Promise((res, rej) => { const n = ++id; P.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params, sessionId })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && P.has(m.id)) { const q = P.get(m.id); P.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const BASE = 'http://localhost:8222';
await rpc('Browser.grantPermissions', { origin: BASE, permissions: ['audioCapture'] }).catch(() => {});
const { targetInfos } = await rpc('Target.getTargets');
const t = targetInfos.find((x) => x.type === 'page' && (x.url.startsWith(BASE) || x.url === 'about:blank')) ?? { targetId: (await rpc('Target.createTarget', { url: 'about:blank' })).targetId };
const { sessionId } = await rpc('Target.attachToTarget', { targetId: t.targetId, flatten: true });
await rpc('Target.activateTarget', { targetId: t.targetId });
await rpc('Runtime.enable', {}, sessionId);
if (process.argv[3]) {
  await rpc('Network.enable', {}, sessionId);
  await rpc('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await rpc('Network.setBypassServiceWorker', { bypass: true }, sessionId);
  await rpc('Page.enable', {}, sessionId);
  await rpc('Page.navigate', { url: BASE + process.argv[3] }, sessionId);
  await new Promise((r) => setTimeout(r, 3500));
}
const r = await rpc('Runtime.evaluate', { expression: process.argv[2], awaitPromise: true, userGesture: true, returnByValue: true, timeout: 600000 }, sessionId);
console.log(typeof r.result?.value === 'string' ? r.result.value : JSON.stringify(r.result?.value ?? r, null, 1));
ws.close();
