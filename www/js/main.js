import { Engine, LOOP_LENGTHS, PAD_COUNT } from './engine.js';
import { decodeWavBlob, readAudioFile, toMp3 } from './audio-files.js';
import { drawPad, drawSing } from './pad-view.js';
import * as layout from './layout.js';
import { pitchRange } from './pitch.js';
import { Projects } from './projects.js';
import { SongEditor } from './song.js';
import { HelpBox } from './help.js';
import { TrimEditor } from './trim.js';
import * as store from './storage.js';
import { encodeWav } from './wav.js';
import { fitBars, mod, tapTempo } from './timing.js';

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  bpm: 90,
  beatsPerBar: 4,
  loopBars: 4,
  countIn: true,
  countInBeeps: false,
  autoPlay: true,
  latencyMs: null,
  echoCancel: false,
  monitor: false,
  liveMic: false,
  micBoost: 1,
};

const settings = { ...DEFAULTS };
const engine = new Engine(settings);
let song = null; // { sections: [{ bars, pads: [bool × 8] }] }
const projects = new Projects({
  engine,
  settings,
  defaults: DEFAULTS,
  getSong: () => song,
  setSong: (s) => (song = s ?? null),
  toast: (...a) => toast(...a),
  share: (files, title) => share(files, title),
  onSwitch: () => {
    syncToggles();
    const name = projects.current?.name ?? '';
    $('menuProject').textContent = name;
    $('boardNameText').textContent = name;
  },
});
const save = () => projects.save();
const trim = new TrimEditor(engine, { onClose: save });
const songEditor = new SongEditor({
  engine,
  getSong: () => song,
  setSong: (s) => {
    song = s;
    save();
  },
  onPlay: (mode) => playSong(mode),
});
const padEls = [];
const helpBox = new HelpBox({ toast: (...a) => toast(...a) });

// ---------- toast ----------

let toastTimer;
function toast(msg, action, fn) {
  $('toastMsg').textContent = msg;
  const b = $('toastAction');
  b.textContent = action || '';
  b.onclick = () => {
    $('toast').hidden = true;
    fn?.();
  };
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), action ? 5000 : 2600);
}

function micError(e) {
  console.warn(e);
  toast(e?.name === 'NotAllowedError' ? 'Microphone blocked — allow it in your phone’s settings' : 'Could not open the microphone');
}

// ---------- pads ----------

let singView;

function buildPads() {
  const grid = $('grid');
  for (let i = 0; i < PAD_COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'pad';
    el.style.setProperty('--c', `var(--p${i})`);
    el.innerHTML = `<canvas></canvas><span class="num">${i + 1}</span>`;
    grid.append(el);
    const canvas = el.querySelector('canvas');
    padEls.push({ el, canvas, g: canvas.getContext('2d'), w: 0, h: 0 });
    bindPad(el, engine.pads[i]);
  }
  // The Sing tile: one tap records the pads plus your voice on top.
  const el = document.createElement('button');
  el.className = 'pad sing';
  el.setAttribute('aria-label', 'Sing on top');
  el.innerHTML = '<canvas></canvas>';
  grid.append(el);
  const canvas = el.querySelector('canvas');
  singView = { el, canvas, g: canvas.getContext('2d'), w: 0, h: 0, range: { lo: 52, hi: 69 } };
  el.addEventListener('click', toggleSing);
  const relayout = () => {
    layout.apply(grid, [...padEls.map((p) => p.el), el]);
    sizeCanvases();
  };
  new ResizeObserver(relayout).observe(grid);
  window.addEventListener('resize', relayout); // also fires when a foldable changes posture
}

function sizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  for (const p of [...padEls, singView]) {
    const r = p.el.getBoundingClientRect();
    p.w = r.width;
    p.h = r.height;
    p.canvas.width = Math.round(r.width * dpr);
    p.canvas.height = Math.round(r.height * dpr);
    p.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function bindPad(el, pad) {
  let timer = null;
  let long = false;
  let down = false;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    down = true;
    long = false;
    el.classList.add('pressed');
    // One-shots fire on touch-down so they feel like an instrument.
    if (pad.state === 'ready' && pad.mode === 'oneshot') {
      engine.trigger(pad);
      flash(el);
    }
    timer = setTimeout(() => {
      long = true;
      if (pad.state === 'ready' || pad.state === 'empty') openPadSheet(pad);
    }, 480);
  });
  const up = (e, cancelled) => {
    if (!down) return;
    down = false;
    clearTimeout(timer);
    el.classList.remove('pressed');
    if (long || cancelled) return;
    tap(pad, el);
  };
  el.addEventListener('pointerup', (e) => up(e, false));
  el.addEventListener('pointercancel', (e) => up(e, true));
  el.addEventListener('pointerleave', (e) => up(e, true));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function flash(el) {
  el.classList.remove('hit');
  void el.offsetWidth;
  el.classList.add('hit');
}

async function tap(pad, el) {
  switch (pad.state) {
    case 'empty':
      try {
        await engine.record(pad);
      } catch (e) {
        micError(e);
      }
      break;
    case 'armed':
      engine.cancelRecording(pad);
      break;
    case 'recording': {
      const before = pad.rec.end;
      engine.finishEarly(pad);
      if (pad.rec.end === before) toast('Finishing at the end of the loop');
      break;
    }
    case 'ready':
      if (pad.mode === 'loop') {
        engine.trigger(pad);
        flash(el);
      }
      break;
  }
}

// ---------- pad sheet ----------

let sheetPad = null;
function openPadSheet(pad) {
  sheetPad = pad;
  $('padTitle').textContent = `Pad ${pad.index + 1}`;
  $('padVol').value = pad.volume;
  const empty = !pad.hasSound;
  $('padSheet').classList.toggle('empty', empty);
  $('padEmptyNote').hidden = !empty;
  syncModeSeg();
  $('padSheet').showModal();
}
function syncModeSeg() {
  for (const b of $('modeSeg').children) {
    b.setAttribute('aria-checked', b.dataset.mode === sheetPad.mode);
    b.disabled = b.dataset.mode === 'loop' && sheetPad.free;
  }
}
$('modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  engine.setMode(sheetPad, b.dataset.mode);
  syncModeSeg();
  save();
});
$('padVol').oninput = (e) => {
  engine.setVolume(sheetPad, Number(e.target.value));
  save();
};
$('padTrim').onclick = () => {
  const pad = sheetPad;
  $('padSheet').close();
  trim.open(pad);
};
$('padRerec').onclick = async () => {
  const pad = sheetPad;
  const snap = engine.snapshot(pad);
  $('padSheet').close();
  try {
    await engine.record(pad);
    toast('Re-recording…', 'Undo', () => engine.restore(pad, snap));
  } catch (e) {
    engine.restore(pad, snap);
    micError(e);
  }
};
// One pad's sound as a WAV, exactly as it loops. The tempo and length ride along inside the
// file, so another Loopsy Doopsy can drop it straight onto its grid.
$('padSend').onclick = () => {
  const pad = sheetPad;
  if (!pad?.buffer) return;
  const meta = {
    app: 'loopsy',
    v: 1,
    bpm: settings.bpm,
    beatsPerBar: settings.beatsPerBar,
    bars: pad.free ? null : pad.bars,
    free: pad.free,
    mode: pad.mode,
  };
  const board = (projects.current?.name ?? 'loopsy').replace(/[^\w-]+/g, '-');
  share([{ blob: encodeWav(pad.buffer.getChannelData(0), pad.buffer.sampleRate, meta), name: `${board}-pad${pad.index + 1}.wav` }], `Pad ${pad.index + 1}`);
};
$('padLoad').onclick = () => $('padFile').click();
$('padFile').onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  const pad = sheetPad;
  if (!f || !pad) return;
  $('padSheet').close();
  loadPadFile(pad, f);
};

async function loadPadFile(pad, file) {
  await engine.init();
  let a;
  try {
    a = await readAudioFile(engine.ctx, file);
  } catch (e) {
    console.warn(e);
    return toast('Couldn’t read that sound file');
  }
  if (!a.samples.length) return toast('That sound file is empty');
  const m = a.meta?.app === 'loopsy' ? a.meta : null;
  const others = engine.pads.some((p) => p !== pad && p.hasSound);
  // An empty board takes on the tempo the sound was made at.
  if (m?.bpm && !others && !engine.running) {
    settings.bpm = m.bpm;
    settings.beatsPerBar = m.beatsPerBar || settings.beatsPerBar;
    syncToggles();
  }
  const sameTempo = m && Math.abs(m.bpm - settings.bpm) < 0.05 && m.beatsPerBar === settings.beatsPerBar;
  const dur = a.samples.length / a.sampleRate;
  let bars = null;
  if (m) bars = sameTempo && !m.free ? m.bars : null;
  else bars = fitBars(dur, engine.bar, LOOP_LENGTHS);
  const snap = engine.snapshot(pad);
  const had = pad.hasSound;
  engine.loadSound(pad, a.samples, a.sampleRate, bars);
  if (bars && m?.mode === 'oneshot') engine.setMode(pad, 'oneshot');
  save();
  const undo = had
    ? () => {
        engine.restore(pad, snap);
        save();
      }
    : null;
  const msg = bars
    ? `Loaded onto pad ${pad.index + 1} as a ${plural(bars, 'bar')} loop`
    : m && !sameTempo
      ? `Loaded as a one-shot: it was made at ${fmtBpm(m.bpm)} bpm, this board is ${fmtBpm(settings.bpm)}`
      : `Loaded as a one-shot. Hold the pad → Trim to make it a loop`;
  toast(msg, undo && 'Undo', undo);
}

$('padClear').onclick = () => {
  const pad = sheetPad;
  $('padSheet').close();
  const snap = engine.clear(pad);
  save();
  toast(`Pad ${pad.index + 1} cleared`, 'Undo', () => {
    engine.restore(pad, snap);
    save();
  });
};

// ---------- play / record ----------
//
// A "take" records what comes out of the app. Rec takes just the pads (no mic, so no echo);
// Sing on top adds your voice. Tapping Sing during a Rec take adds your voice from then on.

$('playBtn').onclick = async () => {
  await engine.init();
  if (engine.running) stopAll();
  else engine.startTransport();
};

// Stop everything; a song take stopped early is still saved.
function stopAll() {
  engine.stopTransport();
  if (songSession && engine.session) stopTake();
}

let sessionStarted = 0;
let songSession = false; // the current take was started from the song, so it ends with the song

function setLive(on) {
  settings.liveMic = on;
  engine.applyLiveSettings();
}

async function startTake({ voice }) {
  await engine.init();
  setLive(voice);
  try {
    if (voice) await engine.ensureMic();
    await engine.startSession();
  } catch (e) {
    setLive(false);
    micError(e);
    return false;
  }
  sessionStarted = Date.now();
  return true;
}

// Bring the backing in if it's switched on but stopped.
function startBacking() {
  if (!engine.running && engine.pads.some((p) => p.enabled && p.hasSound && p.mode === 'loop')) engine.startTransport();
}

$('recBtn').onclick = async () => {
  if (engine.session) return stopTake();
  if (await startTake({ voice: false })) {
    startBacking();
    toast('Recording the pads — tap them to bring loops in and out');
  }
};

async function toggleSing() {
  if (engine.session && !settings.liveMic) {
    // Already recording the pads: add your voice from here on.
    setLive(true);
    try {
      await engine.ensureMic();
      toast('Your voice is in the take now');
    } catch (e) {
      setLive(false);
      micError(e);
    }
    return;
  }
  if (engine.session) return stopTake();
  if (await startTake({ voice: true })) startBacking();
}

const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

async function stopTake() {
  songSession = false;
  const voice = settings.liveMic;
  const result = await engine.stopSession();
  setLive(false);
  if (!result || result.samples.length < result.sampleRate * 0.3) return toast('Recording too short');
  const blob = encodeWav(result.samples, result.sampleRate);
  const takes = await store.listTakes();
  const take = {
    id: Date.now(),
    name: `${projects.current?.name ?? 'Jam'} · take ${takes.length + 1}${voice ? ' (with voice)' : ''}`,
    created: Date.now(),
    duration: result.samples.length / result.sampleRate,
    blob,
  };
  await store.saveTake(take);
  refreshTakesCount();
  toast(`Saved “${take.name}”`, 'Open', openTakes);
  // Make the MP3 now, in the background, so sharing it later is instant.
  toMp3(result.samples, result.sampleRate)
    .then((mp3) => store.saveTake({ ...take, mp3 }))
    .catch((e) => console.warn('mp3', e));
}

// mode: 'play' | 'record' (the pads) | 'sing' (the pads + your voice)
async function playSong(mode) {
  await engine.init();
  if (!song?.sections?.length) return;
  if (engine.session) await stopTake();
  if (mode !== 'play' && !(await startTake({ voice: mode === 'sing' }))) return;
  songSession = mode !== 'play';
  engine.playSong(song.sections);
}

engine.addEventListener('songend', () => {
  if (songSession && engine.session) stopTake();
});

// ---------- menu & sheets ----------

$('menuBtn').onclick = () => {
  $('menuProject').textContent = projects.current?.name ?? '';
  $('menuSheet').showModal();
};
$('menuSheet').addEventListener('click', (e) => {
  const what = e.target.closest('button')?.dataset.open;
  if (!what) return;
  $('menuSheet').close();
  ({ projects: () => projects.show(), song: () => songEditor.open(), help: openHelp, settings: openSettings, install: openInstall, helpbox: () => helpBox.open(), welcome: showSplash })[what]();
});
$('tempoBtn').onclick = () => openSettings();
$('boardName').onclick = () => projects.show();
$('newBoardBtn').onclick = async () => {
  if (engine.session) await stopTake();
  projects.newSoundboard();
};
$('takesBtn').onclick = () => openTakes();
$('songBtn').onclick = () => {
  if (engine.song) stopAll();
  else songEditor.open();
};
engine.addEventListener('song', () => {
  if ($('songSheet').open) songEditor.render();
});

// ---------- install (PWA) ----------

// Installing matters: browsers may clear a site's storage if it isn't opened for a while
// (Safari after about a week), but not an installed app's. So it's offered up front.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // offer it ourselves instead of a browser banner
  installPrompt = e;
  $('splashInstallNow').hidden = false;
});
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
$('menuInstall').hidden = standalone;

function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

const INSTALL_HOW = {
  ios: 'In Safari, tap Share (the square with an arrow), then “Add to Home Screen”. Opened this from a message? Open it in Safari first.',
  android: 'In Chrome, tap ⋮, then “Install app”.',
  desktop: 'Click the install icon at the right of the address bar (Chrome or Edge). Safari on a Mac: File → Add to Dock.',
};

function showSplash() {
  $('splashInstall').hidden = standalone;
  $('splashInstallHow').textContent = INSTALL_HOW[deviceKind()];
  $('splashInstallNow').hidden = !installPrompt;
  $('splash').hidden = false;
}

async function installNow() {
  if (!installPrompt) return false;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  $('splashInstallNow').hidden = true;
  if (outcome === 'accepted') $('menuInstall').hidden = true;
  return outcome === 'accepted';
}
$('splashInstallNow').onclick = () => installNow();

// After the first recording in a browser tab, a gentle reminder to install.
let installNudged = standalone;
engine.addEventListener('recorded', () => {
  if (installNudged) return;
  installNudged = true;
  setTimeout(() => toast('Install the app so your sounds are kept safe', 'How', openInstall), 1500);
});

function openInstall() {
  const kind = deviceKind();
  for (const sec of $('installSheet').querySelectorAll('[data-os]')) sec.hidden = sec.dataset.os !== kind;
  $('installNowRow').hidden = !installPrompt;
  $('installSheet').showModal();
}
$('installNow').onclick = async () => {
  await installNow();
  $('installSheet').close();
};

// ---------- keyboard (computers) ----------

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (!$('splash').hidden || document.querySelector('dialog[open]')) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  engine.init();
  if (e.key >= '1' && e.key <= String(PAD_COUNT)) {
    const i = Number(e.key) - 1;
    const pad = engine.pads[i];
    if (pad.state === 'ready' && pad.mode === 'oneshot') {
      engine.trigger(pad);
      flash(padEls[i].el);
    } else tap(pad, padEls[i].el);
  } else if (e.key === ' ') {
    e.preventDefault();
    document.activeElement?.blur?.();
    $('playBtn').click();
  } else if (e.key === 'r' || e.key === 'R') {
    $('recBtn').click();
  } else return;
  e.preventDefault();
});

function openHelp() {
  $('helpSheet').showModal();
  $('helpSheet').querySelector('form').scrollTop = 0;
}

function syncToggles() {
  $('bpmVal').textContent = fmtBpm(settings.bpm);
  for (const b of document.querySelectorAll('.len-picker button')) {
    b.setAttribute('aria-checked', Number(b.dataset.bars) === settings.loopBars);
  }
  const dots = $('beatDots');
  if (dots.children.length !== settings.beatsPerBar) {
    dots.innerHTML = '<i></i>'.repeat(settings.beatsPerBar);
    dots.firstChild.classList.add('one');
  }
}

const fmtBpm = (b) => (Number.isInteger(b) ? String(b) : b.toFixed(1));

document.querySelector('.len-picker').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  settings.loopBars = Number(b.dataset.bars);
  syncToggles();
  save();
});

// ---------- settings ----------

const checks = {
  setCountIn: 'countIn',
  setBeeps: 'countInBeeps',
  setAutoPlay: 'autoPlay',
  setEcho: 'echoCancel',
  setMonitor: 'monitor',
};

function openSettings() {
  $('bpmInput').value = settings.bpm;
  $('bpbInput').value = settings.beatsPerBar;
  $('latInput').value = settings.latencyMs ?? '';
  $('latInput').placeholder = engine.ctx ? `auto (${Math.round(engine.latency * 1000)})` : 'auto';
  for (const [id, key] of Object.entries(checks)) $(id).checked = settings[key];
  $('setBoost').value = settings.micBoost;
  showBoost();
  const locked = engine.anyRecorded();
  for (const id of ['bpmInput', 'bpmDown', 'bpmUp', 'tapBtn', 'bpbInput']) $(id).disabled = locked;
  $('tempoLock').hidden = !locked;
  $('settingsSheet').showModal();
}

function setBpm(v) {
  if (!Number.isFinite(v)) return;
  settings.bpm = Math.round(Math.min(240, Math.max(40, v)) * 10) / 10;
  $('bpmInput').value = settings.bpm;
  syncToggles();
  save();
}
$('bpmInput').onchange = (e) => setBpm(Number(e.target.value));
$('bpmDown').onclick = () => setBpm(Math.round(settings.bpm) - 1);
$('bpmUp').onclick = () => setBpm(Math.round(settings.bpm) + 1);
const taps = [];
$('tapBtn').onpointerdown = () => {
  const t = performance.now() / 1000;
  if (taps.length && t - taps.at(-1) > 2) taps.length = 0;
  taps.push(t);
  const bpm = tapTempo(taps);
  if (bpm) setBpm(bpm);
};
$('bpbInput').onchange = (e) => {
  settings.beatsPerBar = Number(e.target.value);
  syncToggles();
  save();
};
for (const [id, key] of Object.entries(checks)) {
  $(id).onchange = async (e) => {
    settings[key] = e.target.checked;
    if (key === 'echoCancel') await engine.reopenMic().catch(micError);
    if (key === 'monitor') engine.applyLiveSettings();
    save();
  };
}
function showBoost() {
  const db = Math.round(20 * Math.log10(settings.micBoost));
  $('boostVal').textContent = db ? `+${db} dB` : 'off';
}
$('setBoost').oninput = (e) => {
  settings.micBoost = Number(e.target.value);
  showBoost();
  engine.applyLiveSettings();
  save();
};
$('latInput').onchange = (e) => {
  const v = e.target.value.trim();
  settings.latencyMs = v === '' ? null : Math.max(0, Math.min(500, Number(v)));
  save();
};
$('calBtn').onclick = async () => {
  const b = $('calBtn');
  b.disabled = true;
  b.textContent = 'Listening…';
  try {
    const ms = await engine.calibrate();
    if (ms == null) toast('Couldn’t hear the clicks — turn the volume up and try again');
    else {
      settings.latencyMs = ms;
      $('latInput').value = ms;
      toast(`Latency set to ${ms} ms`);
      save();
    }
  } catch (e) {
    micError(e);
  }
  b.disabled = false;
  b.textContent = 'Calibrate';
};
$('clearAll').onclick = () => {
  const snaps = engine.pads.map((p) => (p.raw ? engine.clear(p) : null));
  $('settingsSheet').close();
  save();
  toast('All pads cleared', 'Undo', () => {
    snaps.forEach((s, i) => s && engine.restore(engine.pads[i], s));
    save();
  });
};

// ---------- takes ----------

const player = new Audio();
let playingId = null;
player.onended = () => {
  playingId = null;
  renderTakes();
};

async function refreshTakesCount() {
  const n = (await store.listTakes().catch(() => [])).length;
  $('takesCount').hidden = !n;
  $('takesCount').textContent = n;
}

async function openTakes() {
  await renderTakes();
  if (!$('takesSheet').open) $('takesSheet').showModal();
}
$('takesSheet').addEventListener('close', () => {
  player.pause();
  playingId = null;
});

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v13M7 8l5-5 5 5M5 14v6h14v-6"/></svg>',
  bin: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
};

async function renderTakes() {
  const list = $('takesList');
  const takes = (await store.listTakes()).sort((a, b) => b.created - a.created);
  list.innerHTML = '';
  if (!takes.length) {
    list.innerHTML = '<li class="empty">No recordings yet</li>';
    return;
  }
  for (const t of takes) {
    const li = document.createElement('li');
    const d = new Date(t.created);
    li.innerHTML = `<button type="button" data-a="play" aria-label="Play">${playingId === t.id ? ICON.pause : ICON.play}</button>
      <div class="meta"><b></b><small>${fmtTime(t.duration)} · ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>
      <button type="button" data-a="mp3" class="fmt" aria-label="Share or save as MP3">${ICON.share}<small>MP3</small></button>
      <button type="button" data-a="wav" class="fmt" aria-label="Share or save as WAV"><small>WAV</small></button>
      <button type="button" data-a="del" aria-label="Delete">${ICON.bin}</button>`;
    li.querySelector('b').textContent = t.name;
    li.onclick = async (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'play') {
        if (playingId === t.id) {
          player.pause();
          playingId = null;
        } else {
          URL.revokeObjectURL(player.src);
          player.src = URL.createObjectURL(t.blob);
          player.play();
          playingId = t.id;
        }
        renderTakes();
      } else if (a === 'mp3') {
        shareTakeMp3(t);
      } else if (a === 'wav') {
        shareTake(t);
      } else if (a === 'del') {
        if (playingId === t.id) player.pause();
        await store.deleteTake(t.id);
        renderTakes();
        refreshTakesCount();
        toast(`Deleted “${t.name}”`, 'Undo', async () => {
          await store.saveTake(t);
          renderTakes();
          refreshTakesCount();
        });
      }
    };
    list.append(li);
  }
}

const takeFile = (t, ext) => `${t.name.replace(/\W+/g, '-').replace(/^-|-$/g, '')}.${ext}`;
const shareTake = (t) => share([{ blob: t.blob, name: takeFile(t, 'wav') }], t.name);

async function shareTakeMp3(t) {
  let mp3 = t.mp3 ?? (await store.getTake(t.id).catch(() => null))?.mp3;
  if (!mp3) {
    toast('Making the MP3…');
    try {
      await engine.init();
      const { samples, sampleRate } = await decodeWavBlob(engine.ctx, t.blob);
      mp3 = await toMp3(samples, sampleRate);
      await store.saveTake({ ...t, mp3 });
    } catch (e) {
      console.warn(e);
      return toast('Couldn’t make an MP3 — try WAV');
    }
  }
  t.mp3 = mp3;
  share([{ blob: mp3, name: takeFile(t, 'mp3') }], t.name);
}

// The phone's share sheet (WhatsApp, AirDrop, Files…) where there is one, else a download.
async function share(files, title) {
  const list = files.map((f) => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }));
  if (navigator.canShare?.({ files: list })) {
    try {
      await navigator.share({ files: list, title });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      // Safari only shares straight after a tap; if getting the file ready took too long, ask for another.
      if (e.name === 'NotAllowedError') return toast('Ready to send', 'Share', () => share(files, title));
    }
  }
  for (const f of list) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}

// ---------- render loop ----------

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function hintText(t) {
  const pads = engine.pads;
  const armed = pads.find((p) => p.state === 'armed');
  if (armed) {
    return armed.rec.start - t > engine.bar
      ? 'Get ready… the count-in starts on the next bar. Tap the pad to cancel.'
      : 'Counting in… start when the hand reaches the top. Tap the pad to cancel.';
  }
  if (pads.some((p) => p.state === 'recording')) return 'Recording — the ring turns white in the last bar. Tap to finish early.';
  const sp = engine.songPosition(t);
  if (sp) {
    if (sp.index < 0) return `Song starts in ${sp.beatsToStart}…${engine.session ? ' get ready to sing' : ''}`;
    return `Song · section ${sp.index + 1} of ${sp.total} · ${plural(sp.barsLeft, 'bar')} left${engine.session ? ' · recording' : ''}`;
  }
  if (engine.session) {
    return settings.liveMic
      ? 'Singing on top — tap the tile again to stop and save'
      : 'Recording the pads · Rec stops & saves · Sing adds your voice';
  }
  if (pads.some((p) => p.pending?.type === 'start')) return 'Coming in from the top when the loops come round';
  if (!pads.some((p) => p.hasSound)) return 'Tap an empty pad to record · tap to play · hold for options';
  return 'Tap to play · hold a pad for options · Rec records what you play';
}

// Pitch for a pad's strip: from its pitch contour while it plays, or the mic while it records.
const TRAIL = 12;
function padPitch(pad, phase) {
  if (pad.state === 'ready') {
    const track = pad.pitchTrack;
    if (!track || phase == null || !pad.pitchRange) return null;
    const i = Math.floor(phase * track.length);
    const trail = [];
    for (let k = TRAIL; k > 0; k--) trail.push(track[(i - k + track.length) % track.length]);
    return { now: track[i], trail, ...pad.pitchRange };
  }
  if (pad.state === 'recording' || pad.state === 'armed') {
    const p = engine.pitches;
    const range = pitchRange(p.subarray(p.length - 80)) ?? { lo: 50, hi: 70 };
    return { now: p[p.length - 1], trail: Array.from(p.subarray(p.length - 1 - TRAIL, p.length - 1)), ...range };
  }
  return null;
}

let lastHint = '';
function frame() {
  const t = engine.heardTime;
  const bpb = settings.beatsPerBar;
  const beat = engine.beat;
  const bar = engine.bar;
  const armed = engine.pads.find((p) => p.state === 'armed');

  engine.pads.forEach((pad, i) => {
    const pe = padEls[i];
    const bars = pad.bars ?? settings.loopBars;
    const phase = pad.state === 'ready' ? engine.playhead(pad) : null;
    const v = {
      state: pad.state,
      bpb,
      bars,
      beats: pad.free ? 0 : bars * bpb,
      mode: pad.mode,
      enabled: pad.enabled,
      pending: pad.pending?.type,
      time: t,
      lengthLabel: plural(settings.loopBars, 'bar'),
      phase,
      pitch: padPitch(pad, phase),
    };
    if (pad.pending?.type === 'start') {
      const beats = Math.ceil((pad.pending.at - t) / beat - 1e-3);
      v.pendingLabel = beats > bpb ? `in ${plural(Math.ceil(beats / bpb), 'bar')}` : beats > 0 ? `in ${beats}` : '';
    }
    if (pad.rec && (pad.state === 'armed' || pad.state === 'recording' || pad.state === 'processing')) {
      const { start, end } = pad.rec;
      // The count-in is one bar: the hand sweeps round it and recording starts at the top.
      const toGo = start - t;
      v.countFrac = toGo > bar ? null : Math.min(1, Math.max(0, 1 - toGo / bar));
      v.countdown = Math.max(1, Math.ceil(toGo / beat - 1e-3));
      if (pad.state === 'armed') v.beats = bpb;
      v.recFrac = (t - start) / (end - start);
      v.lastBar = t >= end - bar;
      v.beatsLeft = Math.max(1, Math.ceil((end - t) / beat - 1e-3));
      v.recBar = Math.min(bars, Math.floor((t - start) / bar) + 1);
      v.beatPulse = mod(t - start, beat) < 0.12;
    }
    if (pe.w) drawPad(pe.g, pe.w, pe.h, pad, v);
    const cl = pe.el.classList;
    cl.toggle('has-sound', pad.hasSound);
    cl.toggle('active', phase != null);
    cl.toggle('armed', pad.state === 'armed');
    cl.toggle('recording', pad.state === 'recording');
    cl.toggle('processing', pad.state === 'processing');
  });

  // Beat lights: count towards a recording when one is waiting, otherwise follow the loops.
  const dots = $('beatDots').children;
  const ref = armed ? armed.rec.start : engine.origin;
  const pos = engine.running || armed ? (t - ref) / beat : null;
  const on = pos == null ? -1 : mod(Math.floor(pos + 1e-3), bpb);
  const lit = pos != null && mod(pos, 1) < 0.5;
  for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === on && lit);
  $('beatDots').classList.toggle('count-in', !!armed);

  if (singView?.w) {
    // Let the pitch view drift to follow your voice rather than jumping around.
    const target = pitchRange(engine.pitches.subarray(engine.pitches.length - 100));
    if (target) {
      const mid = (target.lo + target.hi) / 2;
      const span = Math.max(14, target.hi - target.lo);
      singView.range.lo += (mid - span / 2 - singView.range.lo) * 0.04;
      singView.range.hi += (mid + span / 2 - singView.range.hi) * 0.04;
    }
    drawSing(singView.g, singView.w, singView.h, {
      recording: !!engine.session && settings.liveMic,
      padRec: !!engine.session && !settings.liveMic,
      live: settings.liveMic,
      micOpen: !!engine.mic,
      levels: engine.levels,
      pitches: engine.pitches,
      view: singView.range,
      elapsed: engine.session ? fmtTime((Date.now() - sessionStarted) / 1000) : '',
    });
    singView.el.classList.toggle('recording', !!engine.session && settings.liveMic);
  }

  document.body.classList.toggle('playing', engine.running);
  document.body.classList.toggle('session', !!engine.session);
  const recText = engine.session ? fmtTime((Date.now() - sessionStarted) / 1000) : 'Rec';
  if ($('recLabel').textContent !== recText) $('recLabel').textContent = recText;
  document.body.classList.toggle('song', !!engine.song);
  $('songBtnLabel').textContent = engine.song ? '■ Stop' : 'Song';

  const h = hintText(t);
  if (h !== lastHint) $('hint').textContent = lastHint = h;
  requestAnimationFrame(frame);
}

for (const ev of ['recorded', 'saved']) engine.addEventListener(ev, save);
window.addEventListener('pagehide', () => projects.flush());
document.addEventListener('visibilitychange', () => document.hidden && projects.flush());

// ---------- boot ----------

buildPads();
// Ask the browser to keep our storage (Safari otherwise tidies away sites that go unused).
navigator.storage?.persist?.().catch(() => {});
await projects.boot();
refreshTakesCount();
syncToggles();
sizeCanvases();
requestAnimationFrame(frame);

// Welcome on first launch; after that, straight in.
let welcomed = false;
try {
  welcomed = !!localStorage.getItem('welcomed');
} catch {
  /* storage blocked */
}
if (welcomed) $('splash').hidden = true;
else showSplash();
const dismissSplash = () => {
  $('splash').hidden = true;
  try {
    localStorage.setItem('welcomed', '1');
  } catch {
    /* storage blocked */
  }
  engine.init();
};
$('startBtn').onclick = dismissSplash;
$('basicsBtn').onclick = () => {
  dismissSplash();
  openHelp();
};
// Phones only let audio start from a gesture; unlock on the first touch anywhere.
document.addEventListener('pointerdown', () => engine.init(), { once: true, capture: true });

// Offline support (and what makes it installable).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

window.loopsy = { engine, settings, projects, getSong: () => song, setSong: (s) => (song = s) }; // handy for debugging
