// Open a page in the phone's Chromium browser tab used by the lab (no run). Usage: node open.mjs <path>
const v = await (await fetch('http://localhost:9333/json/version')).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const p = new Map();
const rpc = (m, params = {}, sessionId) => new Promise((res, rej) => { const n = ++id; p.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params, sessionId })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const q = p.get(m.id); p.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const url = 'http://localhost:8222' + process.argv[2];
await rpc('Browser.grantPermissions', { origin: 'http://localhost:8222', permissions: ['audioCapture'] }).catch(() => {});
const { targetInfos } = await rpc('Target.getTargets');
const t = targetInfos.find((x) => x.type === 'page' && x.url.startsWith('http://localhost:8222'));
const { sessionId } = await rpc('Target.attachToTarget', { targetId: t.targetId, flatten: true });
await rpc('Target.activateTarget', { targetId: t.targetId });
await rpc('Page.navigate', { url }, sessionId);
console.log('opened', url); ws.close();
