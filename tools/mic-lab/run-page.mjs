// Load a lab page in the phone's Chromium tab (with a user gesture) and print its log when done.
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
await rpc('Network.enable', {}, sessionId);
await rpc('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
await rpc('Network.setBypassServiceWorker', { bypass: true }, sessionId);
await rpc('Page.navigate', { url: BASE + process.argv[2] }, sessionId);
// Chromium needs a gesture for audio: click the page once it has loaded.
await new Promise((r) => setTimeout(r, 1500));
await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x: 50, y: 50, button: 'left', clickCount: 1 }, sessionId);
await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 50, y: 50, button: 'left', clickCount: 1 }, sessionId);
for (;;) {
  await new Promise((r) => setTimeout(r, 2000));
  const r = await rpc('Runtime.evaluate', { expression: 'window.done ? document.getElementById("out").innerText : null', returnByValue: true }, sessionId);
  if (r.result.value) { console.log(r.result.value); break; }
}
await rpc('Page.navigate', { url: 'about:blank' }, sessionId); // let go of the mic
ws.close();
