import { Engine, PAD_COUNT } from './engine.js';
import { drawPad, drawSing } from './pad-view.js';
import * as layout from './layout.js';
import { isNative, onBackButton, shareFile } from './native.js';
import { TrimEditor } from './trim.js';
import * as store from './storage.js';
import { encodeWav } from './wav.js';
import { mod, tapTempo } from './timing.js';

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  bpm: 90,
  beatsPerBar: 4,
  loopBars: 2,
  countIn: true,
  metronome: false,
  clickWhileRecording: true,
  autoPlay: true,
  quantize: 'bar',
  quantizeOneShots: false,
  latencyMs: null,
  echoCancel: false,
  monitor: false,
  liveMic: false,
  micBoost: 1,
};

const settings = { ...DEFAULTS };
const engine = new Engine(settings);
const trim = new TrimEditor(engine, { onClose: () => save() });
const padEls = [];

// ---------- persistence ----------

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const pads = engine.pads.map((p) => (p.state === 'ready' && p.raw ? engine.snapshot(p) : null));
    store.saveBoard({ settings: { ...settings, liveMic: false }, pads }).catch((e) => console.warn('save failed', e));
  }, 400);
}

async function load() {
  try {
    const board = await store.loadBoard();
    if (board) {
      Object.assign(settings, board.settings);
      board.pads?.forEach((s, i) => s && engine.restore(engine.pads[i], s));
    }
  } catch (e) {
    console.warn('load failed', e);
  }
  refreshTakesCount();
}

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
  toast(e?.name === 'NotAllowedError' ? 'Microphone blocked — allow it in your browser settings' : 'Could not open the microphone');
}

// ---------- pads ----------

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
  singView = { el, canvas, g: canvas.getContext('2d'), w: 0, h: 0 };
  el.addEventListener('click', toggleSing);
  const relayout = () => {
    layout.apply(grid, [...padEls.map((p) => p.el), el]);
    sizeCanvases();
  };
  new ResizeObserver(relayout).observe(grid);
  window.addEventListener('resize', relayout); // also fires when a foldable changes posture
}

let singView;

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
      if (pad.state === 'ready') openPadSheet(pad);
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
      if (pad.rec.end === before) toast('Finishing at the end of this bar');
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

// ---------- top bar ----------

$('playBtn').onclick = async () => {
  await engine.init();
  if (engine.running) engine.stopTransport();
  else engine.startTransport();
};

$('metroBtn').onclick = () => {
  settings.metronome = !settings.metronome;
  syncToggles();
  save();
};

$('liveBtn').onclick = async () => {
  settings.liveMic = !settings.liveMic;
  syncToggles();
  if (settings.liveMic) {
    try {
      await engine.ensureMic();
      toast(settings.monitor ? 'Live mic on — you can hear yourself' : 'Live mic on — your voice goes into Rec');
    } catch (e) {
      settings.liveMic = false;
      syncToggles();
      micError(e);
    }
  }
  engine.applyLiveSettings();
};

let sessionTimer;
let sessionStarted = 0;
let singOwnsLive = false; // the Sing tile switched Live on, so it switches it off again

function setLive(on) {
  settings.liveMic = on;
  syncToggles();
  engine.applyLiveSettings();
}

async function startJam({ withVoice }) {
  if (withVoice && !settings.liveMic) {
    singOwnsLive = true;
    setLive(true);
  }
  try {
    if (settings.liveMic) await engine.ensureMic();
    engine.applyLiveSettings();
    await engine.startSession();
  } catch (e) {
    if (singOwnsLive) setLive((singOwnsLive = false));
    return micError(e);
  }
  // Singing on top: bring the backing in if it's switched on but stopped.
  if (withVoice && !engine.running && engine.pads.some((p) => p.enabled && p.hasSound && p.mode === 'loop')) {
    engine.startTransport();
  }
  sessionStarted = Date.now();
  const tickLabel = () => ($('recLabel').textContent = fmtTime((Date.now() - sessionStarted) / 1000));
  tickLabel();
  sessionTimer = setInterval(tickLabel, 500);
  if (!settings.liveMic) toast('Recording the pads — turn on Live to add your voice');
}

const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function toggleSing() {
  if (engine.session) stopJam();
  else startJam({ withVoice: true });
}

$('recBtn').onclick = () => (engine.session ? stopJam() : startJam({ withVoice: false }));

async function stopJam() {
  clearInterval(sessionTimer);
  $('recLabel').textContent = 'Rec';
  const result = await engine.stopSession();
  if (singOwnsLive) setLive((singOwnsLive = false));
  if (!result || result.samples.length < result.sampleRate * 0.3) return toast('Recording too short');
  const blob = encodeWav(result.samples, result.sampleRate);
  const takes = await store.listTakes();
  const take = {
    id: Date.now(),
    name: `Jam ${takes.length + 1}`,
    created: Date.now(),
    duration: result.samples.length / result.sampleRate,
    blob,
  };
  await store.saveTake(take);
  refreshTakesCount();
  toast(`Saved “${take.name}”`, 'Open', openTakes);
}

$('tempoBtn').onclick = () => openSettings();
$('menuBtn').onclick = () => openSettings();
$('takesBtn').onclick = () => openTakes();

function syncToggles() {
  $('metroBtn').setAttribute('aria-pressed', settings.metronome);
  $('liveBtn').setAttribute('aria-pressed', settings.liveMic);
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
  setClickRec: 'clickWhileRecording',
  setAutoPlay: 'autoPlay',
  setEcho: 'echoCancel',
  setQuantShots: 'quantizeOneShots',
  setMonitor: 'monitor',
};

function openSettings() {
  $('bpmInput').value = settings.bpm;
  $('bpbInput').value = settings.beatsPerBar;
  $('setQuantize').value = settings.quantize;
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
  if (engine.running) engine.startTransport(); // re-grid the metronome
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
$('setQuantize').onchange = (e) => {
  settings.quantize = e.target.value;
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
    const dur = `${Math.floor(t.duration / 60)}:${String(Math.round(t.duration % 60)).padStart(2, '0')}`;
    li.innerHTML = `<button data-a="play" aria-label="Play">${playingId === t.id ? ICON.pause : ICON.play}</button>
      <div class="meta"><b></b><small>${dur} · ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>
      <button data-a="share" aria-label="Share or save">${ICON.share}</button>
      <button data-a="del" aria-label="Delete">${ICON.bin}</button>`;
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
      } else if (a === 'share') {
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

async function shareTake(t) {
  if (isNative) {
    try {
      await shareFile(t.blob, `${t.name.replace(/\W+/g, '-')}.wav`, t.name);
    } catch (e) {
      if (!/cancel/i.test(e?.message || '')) toast('Couldn’t share that recording');
    }
    return;
  }
  const file = new File([t.blob], `${t.name.replace(/\W+/g, '-')}.wav`, { type: 'audio/wav' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: t.name });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- render loop ----------

function hintText() {
  const pads = engine.pads;
  if (pads.some((p) => p.state === 'armed')) return 'Counting in… start when the ring turns red. Tap the pad to cancel.';
  const rec = pads.find((p) => p.state === 'recording');
  if (rec) return 'Recording — ring turns white in the last bar. Tap to finish at the next bar instead.';
  if (engine.session) return settings.liveMic ? 'Recording your jam with live mic' : 'Recording your jam — play the pads';
  if (!pads.some((p) => p.hasSound)) return 'Tap an empty pad to record · tap to play · hold for options';
  return 'Tap to play · hold a pad for loop / one-shot, trim and more';
}

let lastHint = '';
function frame() {
  const t = engine.heardTime;
  const bpb = settings.beatsPerBar;
  const beat = engine.beat;
  const bar = engine.bar;

  engine.pads.forEach((pad, i) => {
    const pe = padEls[i];
    const bars = pad.bars ?? settings.loopBars;
    const v = {
      state: pad.state,
      bpb,
      bars,
      beats: pad.free ? 0 : bars * bpb,
      mode: pad.mode,
      enabled: pad.enabled,
      pending: pad.pending?.type,
      time: t,
      lengthLabel: `${settings.loopBars} bar${settings.loopBars === 1 ? '' : 's'}`,
      phase: pad.state === 'ready' ? engine.playhead(pad) : null,
    };
    if (pad.rec && (pad.state === 'armed' || pad.state === 'recording' || pad.state === 'processing')) {
      const { start, end } = pad.rec;
      v.countdown = Math.max(1, Math.ceil((start - t) / beat - 1e-3));
      v.recFrac = (t - start) / (end - start);
      v.lastBar = t >= end - bar;
      v.beatsLeft = Math.max(1, Math.ceil((end - t) / beat - 1e-3));
      v.recBar = Math.min(bars, Math.floor((t - start) / bar) + 1);
      v.beatPulse = mod(t - start, beat) < 0.12;
    }
    if (pe.w) drawPad(pe.g, pe.w, pe.h, pad, v);
    const cl = pe.el.classList;
    cl.toggle('has-sound', pad.hasSound);
    cl.toggle('active', v.phase != null);
    cl.toggle('armed', pad.state === 'armed');
    cl.toggle('recording', pad.state === 'recording');
    cl.toggle('processing', pad.state === 'processing');
  });

  // Beat lights.
  const dots = $('beatDots').children;
  const pos = engine.running ? (t - engine.origin) / beat : null;
  const on = pos == null || pos < -1e-3 ? -1 : Math.floor(pos) % bpb;
  const lit = pos != null && mod(pos, 1) < 0.5;
  for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === on && lit);
  $('beatDots').classList.toggle('count-in', engine.pads.some((p) => p.state === 'armed'));

  if (singView?.w) {
    drawSing(singView.g, singView.w, singView.h, {
      recording: !!engine.session,
      live: settings.liveMic,
      micOpen: !!engine.mic,
      levels: engine.levels,
      elapsed: engine.session ? fmtTime((Date.now() - sessionStarted) / 1000) : '',
    });
    singView.el.classList.toggle('recording', !!engine.session);
  }

  document.body.classList.toggle('playing', engine.running);
  document.body.classList.toggle('session', !!engine.session);

  const h = hintText();
  if (h !== lastHint) $('hint').textContent = lastHint = h;
  requestAnimationFrame(frame);
}

engine.addEventListener('recorded', () => save());
engine.addEventListener('saved', () => save());

// ---------- boot ----------

buildPads();
await load();
syncToggles();
sizeCanvases();
requestAnimationFrame(frame);

$('startBtn').onclick = async () => {
  $('splash').hidden = true;
  await engine.init();
};
if (sessionStorage.getItem('started')) $('splash').hidden = true;
$('startBtn').addEventListener('click', () => sessionStorage.setItem('started', '1'));
// Phones only let audio start from a gesture; unlock on the first touch anywhere.
document.addEventListener('pointerdown', () => engine.init(), { once: true, capture: true });

// Offline cache for the web version; the Android app already ships its files.
if (!isNative && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

onBackButton(() => {
  const open = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (open) {
    if (open.id === 'trimSheet') $('trimCancel').click();
    else open.close();
    return true;
  }
  return false;
});

window.loopsy = { engine, settings }; // handy for debugging
