// Asking for the microphone, and helping when it can't be opened. Before the first
// recording a short screen explains why it's needed; its "Allow" button brings up the
// browser's own question (Chrome on Android also offers "Only this time"). When the mic
// can't be opened, it says why and how to fix it on this device.
import { MIC_UNBLOCK, NAMES, browser } from './device.js';

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
