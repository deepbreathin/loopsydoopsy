// Asking for the microphone, and helping when it can't be opened. Before the first
// recording a short screen explains why it's needed; its "Allow" button brings up the
// browser's own question (Chrome on Android also offers "Only this time"). When the mic
// can't be opened, it says why and how to fix it on this device.
const $ = (id) => document.getElementById(id);
const ASKED = 'micOk';

const kind = () => {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
};
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

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

const UNBLOCK = {
  android: installed()
    ? ['Hold the Loopsy icon on your home screen, then tap App info (ⓘ).', 'Tap Permissions → Microphone → Allow.', 'Come back and tap Try again.']
    : ['Tap the icon just left of the web address (it may look like ⚙︎ or a padlock).', 'Tap Permissions → Microphone, and allow it.', 'Come back and tap Try again.'],
  ios: installed()
    ? ['Open the Settings app → Apps → Safari → Microphone, and choose Ask or Allow.', 'Close Loopsy fully (swipe it away) and open it again.']
    : ['Tap aA in the address bar → Website Settings.', 'Set Microphone to Ask or Allow.', 'Come back and tap Try again.'],
  desktop: ['Click the icon just left of the web address.', 'Set Microphone to Allow.', 'Come back and tap Try again (or reload the page).'],
};

// What went wrong, in plain words, and what to do about it.
export function explain(e) {
  const name = e?.name || '';
  if (name === 'Unsupported') {
    return {
      title: 'This browser can’t use the microphone',
      text: 'If you opened the link from another app (WhatsApp, Instagram, Facebook, Gmail…), it opened inside that app, which can’t record. Open it in your phone’s browser instead:',
      steps:
        kind() === 'ios'
          ? ['Tap the share or ⋯ button in that app.', 'Choose Open in Safari (or Open in browser).']
          : ['Tap ⋮ in that app.', 'Choose Open in Chrome (or Open in browser).'],
    };
  }
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return { title: 'The microphone is blocked', text: 'Loopsy was told not to use the microphone. To allow it:', steps: UNBLOCK[kind()] };
  }
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') {
    return {
      title: 'The microphone is busy',
      text: 'Something else may be using it: a phone or video call, a voice recorder, or another browser tab. Close that, then try again.',
      steps: kind() === 'android' ? ['If it still won’t work, close Chrome fully (swipe it away) and open Loopsy again.'] : [],
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
