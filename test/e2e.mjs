// End-to-end smoke test: real Chromium, fake microphone, phone-sized viewport.
// Run: npm run test:e2e   (needs Playwright; uses the globally installed one if present)
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright'));
}

const PORT = 5199;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
const shots = new URL('./screens/', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
try {
  await sleep(500);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.screenshot({ path: shots + '0-splash.png' });
  await page.click('#startBtn');
  await page.evaluate(() => {
    loopsy.settings.bpm = 160; // 1.5 s bars keep the test quick
    loopsy.settings.latencyMs = 30;
  });
  await page.click('.len-picker [data-bars="1"]');
  await page.screenshot({ path: shots + '1-empty.png' });

  const pads = page.locator('.pad');

  // Record pad 1: count-in (1 bar) then 1 bar of recording.
  await pads.nth(0).click();
  await page.waitForFunction(() => loopsy.engine.pads[0].state === 'armed', null, { timeout: 3000 });
  await sleep(700);
  await page.screenshot({ path: shots + '2-countin.png' });
  await page.waitForFunction(() => loopsy.engine.pads[0].state === 'recording', null, { timeout: 4000 });
  await sleep(1200);
  await page.screenshot({ path: shots + '3-recording-last-bar.png' });
  await page.waitForFunction(() => loopsy.engine.pads[0].state === 'ready', null, { timeout: 5000 });
  const info = await page.evaluate(() => {
    const p = loopsy.engine.pads[0];
    return { dur: p.buffer.duration, playing: !!p.source, enabled: p.enabled, peak: Math.max(...p.peaks) };
  });
  assert.ok(Math.abs(info.dur - 1.5) < 0.002, `loop is exactly one bar (${info.dur})`);
  assert.ok(info.playing && info.enabled, 'loop starts playing after recording');
  await sleep(800);
  await page.screenshot({ path: shots + '4-looping.png' });

  // Record pad 2 while pad 1 loops; it must start on a bar line.
  await pads.nth(1).click();
  await page.waitForFunction(() => loopsy.engine.pads[1].rec, null, { timeout: 3000 });
  const rec = await page.evaluate(() => {
    const e = loopsy.engine;
    const p = e.pads[1];
    return ((p.rec.start - e.origin) / e.bar) % 1;
  });
  assert.ok(Math.min(rec, 1 - rec) < 1e-6, 'second recording starts on a bar line');
  await page.waitForFunction(() => loopsy.engine.pads[1].state === 'ready', null, { timeout: 8000 });
  await page.waitForFunction(() => !loopsy.engine.pads[1].rec, null, { timeout: 5000 }); // overrun tail captured
  const raw = await page.evaluate(() => {
    const p = loopsy.engine.pads[1];
    return { raw: p.raw.length / p.sampleRate, start: p.trimStart / p.sampleRate };
  });
  assert.ok(raw.raw > 1.5 + raw.start + 1, 'raw capture keeps pre-roll and overrun for trimming');

  // Long-press pad 2 → options → one-shot, then trim.
  const box = await pads.nth(1).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(650);
  await page.mouse.up();
  assert.ok(await page.locator('#padSheet').evaluate((d) => d.open), 'long press opens pad options');
  await page.screenshot({ path: shots + '5-pad-sheet.png' });
  await page.click('#modeSeg [data-mode="oneshot"]');
  await page.click('#padTrim');
  await sleep(300);
  // Drag the trim window a bit to the right.
  const cb = await page.locator('#trimCanvas').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 30, cb.y + cb.height / 2, { steps: 5 });
  await page.mouse.up();
  const moved = await page.evaluate(() => loopsy.engine.pads[1].trimStart - loopsy.engine.pads[1].defaultStart);
  assert.ok(moved > 0, 'dragging the window right moves the loop start later');
  await page.screenshot({ path: shots + '6-trim.png' });
  await page.click('#trimSheet .primary');

  // Session recording.
  await page.click('#recBtn');
  await sleep(1500);
  await pads.nth(1).click(); // one-shot fires on touch-down
  await sleep(1500);
  await page.screenshot({ path: shots + '7-session.png' });
  await page.click('#recBtn');
  await page.waitForFunction(() => document.getElementById('takesCount').textContent === '1', null, { timeout: 4000 });
  await page.click('#takesBtn');
  await sleep(200);
  await page.screenshot({ path: shots + '8-takes.png' });
  await page.click('#takesSheet .close');

  // Reload: pads come back from IndexedDB.
  await page.reload();
  await page.click('body');
  await page.waitForFunction(() => loopsy.engine.pads[1].hasSound, null, { timeout: 4000 });
  assert.equal(await page.evaluate(() => loopsy.engine.pads[1].mode), 'oneshot');

  // Landscape layout.
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(300);
  await page.screenshot({ path: shots + '9-landscape.png' });

  assert.deepEqual(errors, []);
  console.log('e2e ok — screenshots in test/screens/');
} finally {
  await browser.close();
  server.kill();
}
