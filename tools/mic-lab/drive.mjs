// Drive the mic lab in a Chromium browser on the phone over DevTools (adb forward tcp:9333
// localabstract:chrome_devtools_remote). Usage: node drive.mjs [query]   e.g.  "s=6&tone=1"
const PORT = process.env.CDP_PORT || 9333;
const BASE = 'http://localhost:8222';
const query = process.argv[2] || '';
const url = `${BASE}/tools/mic-lab/lab.html${query ? `?${query}` : ''}`;

const version = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
const browser = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function rpc(ws, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
}
browser.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    console.log('[page]', m.params.args.map((a) => a.value ?? a.description).join(' '));
  }
};
await new Promise((r) => (browser.onopen = r));

await rpc(browser, 'Browser.grantPermissions', { origin: BASE, permissions: ['audioCapture'] }).catch((e) => console.log('grant failed', e.message));
const { targetInfos } = await rpc(browser, 'Target.getTargets');
let target = targetInfos.find((t) => t.type === 'page' && t.url.startsWith(`${BASE}/tools/mic-lab/`));
if (!target) target = { targetId: (await rpc(browser, 'Target.createTarget', { url })).targetId };
await rpc(browser, 'Target.activateTarget', { targetId: target.targetId });
const { sessionId } = await rpc(browser, 'Target.attachToTarget', { targetId: target.targetId, flatten: true });
await rpc(browser, 'Runtime.enable', {}, sessionId);
await rpc(browser, 'Page.enable', {}, sessionId);
await rpc(browser, 'Page.navigate', { url }, sessionId);
await new Promise((r) => setTimeout(r, 2500));
const res = await rpc(browser, 'Runtime.evaluate', {
  expression: 'runLab().then(() => document.getElementById("out").innerText)',
  awaitPromise: true,
  userGesture: true,
  timeout: 300000,
}, sessionId);
console.log(res.result.value ?? JSON.stringify(res));
browser.close();
