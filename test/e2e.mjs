// End-to-end test: real Chromium, fake microphone, phone-sized viewport.
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
const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', new URL('../www/', import.meta.url).pathname], { stdio: 'ignore' });
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
  const until = (fn, arg, timeout = 6000) => page.waitForFunction(fn, arg, { timeout });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  await page.goto(`http://localhost:${PORT}/`);
  await page.screenshot({ path: shots + '0-welcome.png' });
  await page.click('#basicsBtn');
  await sleep(200);
  await page.screenshot({ path: shots + '0b-basics.png' });
  await page.click('#helpSheet .close');
  await ev(() => {
    loopsy.settings.bpm = 160; // 1.5 s bars keep the test quick
    loopsy.settings.latencyMs = 30;
  });
  await page.click('.len-picker [data-bars="1"]');
  await page.screenshot({ path: shots + '1-empty.png' });
  const pads = page.locator('.pad:not(.sing)');

  // Record pad 1: silent count-in (no beeps scheduled) then one bar.
  await pads.nth(0).click();
  await until(() => loopsy.engine.pads[0].state === 'armed');
  assert.equal(await ev(() => loopsy.engine.pads[0].rec.beeps.length), 0, 'count-in is silent by default');
  await sleep(600);
  await page.screenshot({ path: shots + '2-countin.png' });
  await until(() => loopsy.engine.pads[0].state === 'recording');
  await sleep(1100);
  await page.screenshot({ path: shots + '3-recording-last-bar.png' });
  await until(() => loopsy.engine.pads[0].state === 'ready');
  const info = await ev(() => {
    const p = loopsy.engine.pads[0];
    return { dur: p.buffer.duration, playing: !!p.source, enabled: p.enabled };
  });
  assert.ok(Math.abs(info.dur - 1.5) < 0.002, `loop is exactly one bar (${info.dur})`);
  assert.ok(info.playing && info.enabled, 'loop starts playing after recording');

  // Record a 2-bar loop on pad 2 while pad 1 plays: it must start at the top of pad 1's loop.
  await page.click('.len-picker [data-bars="2"]');
  await pads.nth(1).click();
  await until(() => loopsy.engine.pads[1].rec);
  const syncErr = await ev(() => {
    const [a, b] = loopsy.engine.pads;
    const len = a.buffer.duration;
    const ph = (((b.rec.start - a.playFrom) % len) + len) % len;
    return Math.min(ph, len - ph);
  });
  assert.ok(syncErr < 1e-6, 'new recording starts when the playing loop comes round');
  await until(() => loopsy.engine.pads[1].state === 'ready', null, 9000);
  await until(() => loopsy.engine.pads[1].pitchTrack && !loopsy.engine.pads[1].rec, null, 6000);
  await sleep(700);
  await page.screenshot({ path: shots + '4-two-loops.png' });

  // Turn pad 2 off, then on again: it must restart from its beginning, on the top of the cycle.
  await pads.nth(1).click();
  await until(() => !loopsy.engine.pads[1].source, null, 4000);
  await pads.nth(1).click();
  const relaunch = await ev(() => {
    const [a, b] = loopsy.engine.pads;
    const len = a.buffer.duration;
    const ph = (((b.loopStartAt - a.playFrom) % len) + len) % len;
    return { fromTop: Math.abs(b.playFrom - b.loopStartAt), sync: Math.min(ph, len - ph) };
  });
  assert.ok(relaunch.fromTop < 1e-9, 'a loop always starts from its beginning');
  assert.ok(relaunch.sync < 1e-6, 'and lines up with the loops already playing');

  // Long-press pad 2 → options → trim.
  const box = await pads.nth(1).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(650);
  await page.mouse.up();
  assert.ok(await page.locator('#padSheet').evaluate((d) => d.open), 'long press opens pad options');
  await page.click('#padTrim');
  await sleep(300);
  const cb = await page.locator('#trimCanvas').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2 + 30, cb.y + cb.height / 2, { steps: 5 });
  await page.mouse.up();
  assert.ok((await ev(() => loopsy.engine.pads[1].trimStart - loopsy.engine.pads[1].defaultStart)) > 0, 'trim window moves');
  await page.screenshot({ path: shots + '5-trim.png' });
  await page.click('#trimSheet .primary');

  // Sing on top: one tap records pads + voice, second tap saves.
  await page.click('.pad.sing');
  await until(() => loopsy.engine.session && loopsy.settings.liveMic, null, 3000);
  await sleep(1500);
  await page.screenshot({ path: shots + '6-singing.png' });
  await page.click('.pad.sing');
  await until(() => document.getElementById('takesCount').textContent === '1', null, 4000);
  assert.equal(await ev(() => loopsy.settings.liveMic), false, 'Sing turns the mic back off');

  // Rec: records just the pads — the mic stays out of it.
  await page.click('#recBtn');
  await until(() => loopsy.engine.session);
  assert.equal(await ev(() => loopsy.settings.liveMic), false, 'Rec leaves the mic out');
  await sleep(1200);
  await page.screenshot({ path: shots + '6b-rec-pads.png' });
  // Tapping Sing mid-take adds the voice from then on.
  await page.click('.pad.sing');
  await until(() => loopsy.settings.liveMic);
  await sleep(500);
  await page.click('#recBtn');
  await until(() => document.getElementById('takesCount').textContent === '2', null, 4000);
  assert.ok(await ev(async () => (await (await import('./js/storage.js')).listTakes()).some((t) => t.name.endsWith('(with voice)'))));
  await page.click('#recBtn');
  await until(() => loopsy.engine.session);
  await sleep(800);
  await page.click('#recBtn');
  await until(() => document.getElementById('takesCount').textContent === '3', null, 4000);
  const names = await ev(async () => (await (await import('./js/storage.js')).listTakes()).map((t) => t.name));
  assert.ok(names.some((n) => !n.includes('voice')), 'a pads-only take');

  // Song: the editor builds an arrangement; "Play & sing" plays it hands-free and saves a take.
  await page.click('#playBtn'); // stop
  await page.click('#songBtn');
  await sleep(200);
  assert.ok((await ev(() => loopsy.getSong().sections.length)) >= 3, 'song is built up automatically');
  await page.screenshot({ path: shots + '7-song.png' });
  await ev(() =>
    loopsy.setSong({
      sections: [
        { bars: 1, pads: [true, false, false, false, false, false, false, false] },
        { bars: 2, pads: [true, true, false, false, false, false, false, false] },
        { bars: 1, pads: [false, true, false, false, false, false, false, false] },
      ],
    }),
  );
  await page.click('#songSing'); // record & sing
  await until(() => loopsy.engine.song && loopsy.engine.session);
  await until(() => loopsy.engine.songPosition()?.index === 1, null, 6000);
  await sleep(300);
  const sec2 = await ev(() => loopsy.engine.pads.slice(0, 2).map((p) => !!p.source && p.enabled));
  assert.deepEqual(sec2, [true, true], 'section 2 plays pads 1 and 2');
  await page.screenshot({ path: shots + '8-song-playing.png' });
  await until(() => loopsy.engine.songPosition()?.index === 2, null, 6000);
  await sleep(300);
  assert.equal(await ev(() => loopsy.engine.pads[0].enabled), false, 'pad 1 drops out in section 3');
  await until(() => !loopsy.engine.song, null, 6000);
  await until(() => document.getElementById('takesCount').textContent === '4', null, 4000);

  // New soundboard: save this one under a name, start fresh.
  await page.click('#newBoardBtn');
  await sleep(200);
  await page.screenshot({ path: shots + '9-new-ask.png' });
  await page.click('#newSave');
  await page.fill('#newName', 'Humming ideas');
  await page.screenshot({ path: shots + '9b-new-name.png' });
  await page.click('#newNameSave');
  await until(() => !loopsy.engine.pads[0].raw && loopsy.projects.current.name !== 'Humming ideas');
  assert.match(await page.locator('#boardNameText').textContent(), /Soundboard/);

  // Record something in the new board, then "Don't save" it — and undo that.
  await pads.nth(3).click();
  await until(() => loopsy.engine.pads[3].state === 'ready', null, 9000);
  await page.click('#playBtn');
  const throwaway = await ev(() => loopsy.projects.current.name);
  await page.click('#newBoardBtn');
  await page.click('#newDiscard');
  await until(() => !loopsy.engine.pads[3].raw);
  await page.click('#toastAction'); // Undo
  await until((name) => loopsy.engine.pads[3].raw && loopsy.projects.current.name === name, throwaway);
  const empties = await ev(async () => (await (await import('./js/storage.js')).listProjects()).filter((p) => !p.padCount).length);
  assert.equal(empties, 0, 'no empty soundboards left behind');

  // Soundboards: back up "Humming ideas" to a file and open it again as a copy.
  await page.click('#boardName');
  await sleep(200);
  await page.locator('#projectList li', { hasText: 'Humming ideas' }).locator('[data-a="open"]').click();
  await until(() => loopsy.engine.pads[0].raw && loopsy.projects.current.name === 'Humming ideas');
  assert.ok(await ev(() => loopsy.getSong()?.sections.length === 3), 'song comes back with its soundboard');
  await page.screenshot({ path: shots + '9c-soundboards.png' });
  const wavs = [];
  page.on('download', (d) => wavs.push(d.suggestedFilename()));
  await page.click('#exportWavs');
  await until(() => true);
  await sleep(500);
  assert.deepEqual(wavs.sort(), ['Humming-ideas-pad1.wav', 'Humming-ideas-pad2.wav'], 'each sound saves as a WAV');
  const [backup] = await Promise.all([page.waitForEvent('download'), page.click('#exportBoard')]);
  const backupPath = shots + 'backup.loopsy';
  await backup.saveAs(backupPath);
  await page.setInputFiles('#importFile', backupPath);
  const boards = () => ev(async () => (await (await import('./js/storage.js')).listProjects()).filter((p) => p.name === 'Humming ideas').length);
  for (let i = 0; i < 40 && (await boards()) < 2; i++) await sleep(100);
  assert.equal(await boards(), 2, 'backup opens as its own soundboard');
  await until(() => loopsy.engine.pads[1].hasSound);
  await page.click('#projectsSheet .close');

  // Reload: same project, pads restored from storage, no welcome screen the second time.
  await page.reload();
  await page.click('body');
  await until(() => loopsy.engine.pads[1].hasSound, null, 4000);
  assert.ok(await page.locator('#splash').evaluate((e) => e.hidden), 'welcome only shows once');

  const layoutKind = () => ev(() => document.getElementById('grid').dataset.layout);
  for (const [w, h, kind, name] of [
    [844, 390, '4x2-side', '10-landscape'],
    [372, 828, '2x4', '11-cover-screen'],
    [930, 864, '3x3', '12-unfolded'],
    [864, 930, '3x3', '13-unfolded-portrait'],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    assert.equal(await layoutKind(), kind, name);
    await page.screenshot({ path: shots + name + '.png' });
  }

  // Half-open like a book: pretend the browser reports two side-by-side segments.
  await page.setViewportSize({ width: 930, height: 864 });
  await ev(() => {
    window.viewport = { segments: [new DOMRect(0, 0, 465, 864), new DOMRect(465, 0, 465, 864)] };
    window.dispatchEvent(new Event('resize'));
  });
  await sleep(300);
  assert.equal(await layoutKind(), 'hinge');
  const clear = await ev(() =>
    [...document.querySelectorAll('.pad')].every((el) => {
      const r = el.getBoundingClientRect();
      return r.right <= 465 || r.left >= 465;
    }),
  );
  assert.ok(clear, 'no pad straddles the fold');
  await page.screenshot({ path: shots + '14-book-posture.png' });

  assert.deepEqual(errors, []);
  console.log('e2e ok — screenshots in test/screens/');
} finally {
  await browser.close();
  server.kill();
}
