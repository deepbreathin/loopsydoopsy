// Asking for the microphone, and helping when it can't be opened. Before the first
// recording a short screen explains why it's needed; its "Allow" button brings up the
// browser's own question (Chrome on Android also offers "Only this time"). When the mic
// can't be opened, it says why and how to fix it on this device.
import { MIC_UNBLOCK, NAMES, browser } from './device.js';
import { sendFeedback } from './help.js';
import { VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
const ASKED = 'micOk';


function remembered() {
  try {
    return !!localStorage.getItem(ASKED);
  } catch {
    return false;
  }
}
function remember() {
  try {
    localStorage.setItem(ASKED, '1');
  } catch {
    /* storage blocked */
  }
}

async function permissionState() {
  try {
    return (await navigator.permissions.query({ name: 'microphone' })).state; // granted | denied | prompt
  } catch {
    return 'unknown'; // older Safari and some browsers can't say
  }
}


// What went wrong, in plain words, and what to do about it.
export function explain(e, b = browser()) {
  const name = e?.name || '';
  if (name === 'Unsupported' || b === 'inapp') {
    return {
      title: 'This browser can’t use the microphone',
      text: 'If you opened the link from another app (WhatsApp, Instagram, Facebook, Gmail…), it opened inside that app, which can’t record. Open it in your phone’s own browser instead:',
      steps: MIC_UNBLOCK.inapp.slice(1),
    };
  }
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return { title: 'The microphone is blocked', text: `Loopsy isn’t allowed to use the microphone in ${NAMES[b]}. To allow it:`, steps: MIC_UNBLOCK[b] };
  }
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') {
    return {
      title: 'The microphone is busy',
      text: 'Something else may be using it: a phone or video call, a voice recorder, or another browser tab. Close that, then try again.',
      steps: ['If it still won’t work, close the browser fully (swipe it away) and open Loopsy again.'],
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return {
      title: 'No microphone found',
      text: 'Connect a microphone or headset, or pick a different one in Tempo & settings → Microphone, then try again.',
      steps: [],
    };
  }
  return {
    title: 'Couldn’t open the microphone',
    text: 'Try again. If it keeps happening, close the browser fully and reopen Loopsy, or try Chrome (Android) or Safari (iPhone).',
    steps: [],
  };
}

// "Using a different browser?": each browser's steps, under its name.
export function fillOthers(el, table) {
  el.innerHTML = '';
  for (const [key, steps] of Object.entries(table)) {
    if (key === 'inapp' || key === 'ios-other') continue;
    const h = document.createElement('h4');
    h.textContent = NAMES[key].replace(/^./, (c) => c.toUpperCase());
    const ol = document.createElement('ol');
    for (const st of steps) {
      const li = document.createElement('li');
      li.textContent = st;
      ol.append(li);
    }
    el.append(h, ol);
  }
}

export class MicGate {
  constructor({ engine, toast }) {
    this.engine = engine;
    this.toast = toast;
    this.dlg = $('micSheet');
    this.pending = null;
    $('micAllow').onclick = () => this.open();
    $('micRetry').onclick = () => this.open();
    $('micNotNow').onclick = $('micClose').onclick = () => this.dlg.close();
    $('micCheckBtn').onclick = $('checkAgain').onclick = () => this.check();
    $('checkClose').onclick = () => this.dlg.close();
    $('checkSend').onclick = () => this.sendReport();
    this.dlg.addEventListener('close', () => this.settle(false));
  }

  settle(ok) {
    const done = this.pending;
    this.pending = null;
    done?.(ok);
  }

  // Resolves true once the microphone is open (asking first if need be), false if not.
  async ready() {
    if (this.engine.mic) return true;
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) return this.wait(() => this.help({ name: 'Unsupported' }));
    const state = await permissionState();
    if (state === 'granted' || (state !== 'denied' && state !== 'prompt' && remembered())) {
      try {
        await this.engine.ensureMic();
        return true;
      } catch (e) {
        return this.wait(() => this.help(e));
      }
    }
    if (state === 'denied') return this.wait(() => this.help({ name: 'NotAllowedError' }));
    return this.wait(() => this.step('ask'));
  }

  wait(show) {
    this.settle(false);
    return new Promise((resolve) => {
      this.pending = resolve;
      show();
      if (!this.dlg.open) this.dlg.showModal();
    });
  }

  step(name) {
    for (const s of this.dlg.querySelectorAll('[data-mic]')) s.hidden = s.dataset.mic !== name;
  }

  // Show what went wrong (also used for mic errors outside this flow).
  help(e) {
    console.warn('microphone', e);
    const h = explain(e);
    $('micHelpTitle').textContent = h.title;
    $('micHelpText').textContent = h.text;
    const ol = $('micHelpSteps');
    ol.innerHTML = '';
    for (const s of h.steps) {
      const li = document.createElement('li');
      li.textContent = s;
      ol.append(li);
    }
    ol.hidden = !h.steps.length;
    $('micHelpCode').textContent = e?.name && e.name !== 'Unsupported' ? `(${e.name}${e.message ? `: ${e.message}` : ''})` : '';
    $('micRetry').hidden = e?.name === 'Unsupported';
    // Guessed the browser wrong? Every browser's steps, one tap away.
    const others = $('micOthers');
    others.hidden = !/blocked/.test(h.title);
    if (!others.hidden) fillOthers($('micOthersList'), MIC_UNBLOCK);
    this.step('help');
    if (!this.dlg.open) this.dlg.showModal();
  }

  // ---------- microphone check: every step, ✓ or ✗, and a report to send ----------

  async check() {
    this.step('check');
    if (!this.dlg.open) this.dlg.showModal();
    const list = $('checkList');
    list.innerHTML = '';
    const lines = [];
    const row = (ok, label, detail = '') => {
      const li = document.createElement('li');
      li.className = ok === true ? 'ok' : ok === false ? 'bad' : 'info';
      li.textContent = `${ok === true ? '✓' : ok === false ? '✗' : '•'} ${label}${detail ? ` — ${detail}` : ''}`;
      list.append(li);
      lines.push(li.textContent);
      return li;
    };
    $('checkSend').disabled = true;
    $('checkLevel').hidden = true;
    const b = browser();
    row(null, 'Browser', `${NAMES[b]} · app version ${VERSION}`);
    row(null, 'Device', navigator.userAgent);
    row(null, 'Installed as an app', matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'yes' : 'no (in a browser tab)');
    row(window.isSecureContext, 'Secure connection (https)', location.protocol);
    const api = !!navigator.mediaDevices?.getUserMedia;
    row(api, 'This browser can use a microphone', api ? '' : b === 'inapp' ? 'this is another app’s built-in browser: open the link in Chrome or Safari' : 'not available here');
    row(null, 'Permission', await permissionState());
    let stream = null;
    if (api) {
      const li = row(null, 'Opening the microphone…');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const t = stream.getAudioTracks()[0];
        const st = t?.getSettings?.() ?? {};
        li.className = 'ok';
        li.textContent = `✓ Microphone opened — ${t?.label || 'unnamed'}${st.sampleRate ? ` · ${st.sampleRate} Hz` : ''}`;
        remember();
      } catch (e) {
        li.className = 'bad';
        li.textContent = `✗ Microphone didn’t open — ${e.name}: ${e.message} → ${explain(e, b).title}`;
      }
      lines[lines.length - 1] = li.textContent;
    }
    try {
      const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      row(mics.length > 0, 'Microphones found', mics.length ? mics.map((d) => d.label || 'unnamed').join(', ') : 'none');
    } catch (e) {
      row(false, 'Microphones found', e.name);
    }
    if (stream) {
      // Listen for a few seconds and show the level, so you can see sound arriving.
      const li = row(null, 'Listening for 4 seconds: hum or say something…');
      let peak = 0;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        await ctx.resume();
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        $('checkLevel').hidden = false;
        const bar = $('checkLevel').firstChild;
        const until = performance.now() + 4000;
        while (performance.now() < until) {
          an.getFloatTimeDomainData(buf);
          let m = 0;
          for (const v of buf) m = Math.max(m, Math.abs(v));
          peak = Math.max(peak, m);
          bar.style.width = `${Math.min(100, m * 140)}%`;
          await new Promise((r) => setTimeout(r, 50));
        }
        ctx.close();
        li.className = peak > 0.01 ? 'ok' : 'bad';
        li.textContent = peak > 0.01 ? `✓ Sound is coming in (loudest ${Math.round(peak * 100)}%)` : '✗ No sound came in — check the phone isn’t muted, or pick another microphone in settings';
      } catch (e) {
        li.className = 'bad';
        li.textContent = `✗ Couldn’t listen — ${e.name}: ${e.message}`;
      }
      lines[lines.length - 1] = li.textContent;
      stream.getTracks().forEach((t) => t.stop());
    }
    if (api) {
      const li = row(null, 'Starting Loopsy’s recorder…');
      try {
        await this.engine.ensureMic();
        li.className = 'ok';
        li.textContent = `✓ Loopsy’s recorder is ready (${this.engine.ctx.sampleRate} Hz)`;
      } catch (e) {
        li.className = 'bad';
        li.textContent = `✗ Loopsy’s recorder didn’t start — ${e.name}: ${e.message}`;
      }
      lines[lines.length - 1] = li.textContent;
    }
    this.report = lines.join('\n');
    $('checkSend').disabled = false;
    $('checkSend').textContent = '📨 Send this report';
  }

  async sendReport() {
    $('checkSend').disabled = true;
    try {
      const sent = await sendFeedback(`[Microphone check]\n${this.report}`);
      $('checkSend').textContent = sent ? '✓ Sent — thank you' : 'Couldn’t send';
    } catch {
      $('checkSend').textContent = 'Couldn’t send (offline?)';
      $('checkSend').disabled = false;
    }
  }

  // The "Allow" / "Try again" tap: the browser shows its own question now.
  async open() {
    $('micAllow').disabled = $('micRetry').disabled = true;
    try {
      await this.engine.ensureMic();
      remember();
      const done = this.pending;
      this.pending = null;
      this.dlg.close();
      if (done) done(true);
      else this.toast('Microphone ready');
    } catch (e) {
      this.help(e);
    } finally {
      $('micAllow').disabled = $('micRetry').disabled = false;
    }
  }
}
