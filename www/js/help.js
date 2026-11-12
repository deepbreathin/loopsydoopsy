// The Help & suggestions box: an FAQ you can search, and a way to send an idea or problem
// report (it opens a pre-filled GitHub issue). No server needed.
const GITHUB_REPO = 'deepbreathin/loopsydoopsy';
const APP_VERSION = '2026.11';

const $ = (id) => document.getElementById(id);

export const FAQ = [
  { q: 'How do I record a loop?', k: 'record recording start tap empty pad loop sing hum', a: 'Tap an empty pad. A white hand sweeps once round the pad, one tick per beat. Start singing or humming the moment it reaches the red mark at the top. The ring fills red while it records and turns white in the last bar, counting “finish in 3·2·1”.' },
  { q: 'When exactly do I start singing?', k: 'count in countdown timing when start hand red mark late early', a: 'When the sweeping hand reaches the red mark at 12 o’clock and the ring turns red. If you came in a little early or late, hold the pad → Trim and slide the window to line it up.' },
  { q: 'How long is a loop?', k: 'length bars long short 1 2 4 8 next loop', a: 'Choose with “Next loop: 1 · 2 · 4 · 8 bars” at the bottom before you record. 4 bars is a good start. Tap the pad while it’s recording to finish early at the next 1, 2 or 4 bar mark.' },
  { q: 'How do I stop or start a loop?', k: 'play stop pause loop on off switch tap', a: 'Tap a pad with a sound to switch it on or off; it comes in from its beginning, in time with the others. ▶ / ■ at the top starts or stops everything.' },
  { q: 'Where are the pad options?', k: 'hold long press options menu volume clear delete re-record one-shot oneshot mode', a: 'Hold a pad for a moment. You get Loop / One-shot, volume, Trim, Re-record, Clear (with Undo), Send this sound and Load a sound file.' },
  { q: 'How do I fix a loop that’s out of time?', k: 'trim timing out of time late early fix align window', a: 'Hold the pad → Trim. Drag the highlighted window earlier or later (it snaps to 1/16 notes; ‹ › nudge by 10 ms). If every overdub is late, run Menu → Tempo & settings → Calibrate.' },
  { q: 'How do I record a whole song?', k: 'rec record song take mix save performance sing on top', a: 'Tap ● Rec to record the pads while you bring loops in and out, then tap it again to save. “Sing on top” does the same with your voice too. Your takes are under ♫.' },
  { q: 'How do I save as MP3?', k: 'mp3 wav save export share download take file', a: 'Tap ♫ (top right), then MP3 next to a take to share or save it. WAV is full quality but bigger.' },
  { q: 'Are my soundboards saved?', k: 'save saved project soundboard lost keep storage device come back later', a: 'Yes, automatically, on this device (in the browser’s storage); nothing is uploaded. Tap the soundboard name above the pads to open another one. For safekeeping, or to move to another device, use Soundboards → Back up / send. Installing the app to your home screen stops Safari from clearing them after a long break.' },
  { q: 'How do I make music with a friend?', k: 'friend share send together collaborate import open backup file loopsy', a: 'Soundboards → Back up / send makes one .loopsy file. Send it however you like; your friend opens it with Open a backup, adds layers and sends it back. For one sound: hold a pad → Send this sound; they hold an empty pad → Load a sound file.' },
  { q: 'Can I load a voice memo or MP3 onto a pad?', k: 'load import file voice memo mp3 wav m4a sound pad', a: 'Yes: hold an empty pad → Load a sound file. If it’s exactly 1, 2, 4 or 8 bars at your tempo it becomes a loop; otherwise a one-shot you can trim.' },
  { q: 'How do I change the tempo?', k: 'tempo bpm speed faster slower tap beats per bar locked', a: 'Tap the bpm number at the top. Tempo is locked once pads have sounds, so everything stays in time; clear all pads to change it.' },
  { q: 'I can’t hear anything', k: 'no sound silent quiet volume hear nothing iphone speaker', a: 'Check the volume, and on iPhone the silent switch on the side. Then tap ▶. If the pads are dimmed, they’re empty: tap one to record.' },
  { q: 'The microphone doesn’t work', k: 'microphone mic blocked permission allow not working', a: 'Allow the microphone for this site. iPhone: tap “aA” in Safari’s address bar → Website Settings → Microphone → Allow (or Settings → Safari → Microphone). Chrome: tap the icon left of the address → Permissions.' },
  { q: 'My humming is too quiet', k: 'quiet humming small meter boost gain loud', a: 'Menu → Tempo & settings → turn up Mic boost. Singing closer to the phone helps too.' },
  { q: 'The loops echo into my recording', k: 'echo bleed leak feedback headphones', a: 'Headphones fix this best. Otherwise turn on Echo cancellation in Tempo & settings (it can dull the sound a little).' },
  { q: 'How do I install it as an app?', k: 'install app home screen pwa offline iphone android computer', a: 'iPhone: Safari → Share → Add to Home Screen. Android: Chrome → ⋮ → Install app. Computer: the install icon in Chrome or Edge’s address bar. Or Menu → Install the app.' },
  { q: 'What do the keyboard keys do?', k: 'keyboard keys shortcuts computer desktop', a: 'On a computer: 1–8 tap the pads, Space plays and stops, R records what you play.' },
];

const words = (s) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

// Best built-in answers for a question, most relevant first.
export function searchFaq(question, n = 3) {
  const qs = new Set(words(question).filter((w) => w.length > 2));
  if (!qs.size) return [];
  return FAQ.map((f) => {
    const hay = new Set([...words(f.k), ...words(f.q)]);
    let score = 0;
    for (const w of qs) if (hay.has(w) || [...hay].some((h) => h.length > 3 && (h.startsWith(w) || w.startsWith(h)))) score++;
    return { f, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.f);
}

const device = () => `${navigator.userAgent} · ${innerWidth}×${innerHeight}${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? ' · installed' : ''}`;

export class HelpBox {
  constructor({ toast }) {
    this.toast = toast;
    this.history = [];
    this.dlg = $('helpBoxSheet');
    for (const b of this.dlg.querySelectorAll('[data-tab]')) b.onclick = () => this.tab(b.dataset.tab);
    $('askBtn').onclick = () => this.ask();
    // Enter asks (and mustn't submit the sheet's form, which would close it).
    $('askInput').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.ask();
    });
    $('sendSuggestion').onclick = () => this.suggest();
    this.renderCommon();
  }

  open(tab = 'ask') {
    this.tab(tab);
    if (!this.dlg.open) this.dlg.showModal();
  }

  tab(name) {
    for (const b of this.dlg.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', b.dataset.tab === name);
    for (const p of this.dlg.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name;
  }

  renderCommon() {
    const ul = $('commonQs');
    ul.innerHTML = '';
    for (const f of FAQ) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = f.q;
      b.onclick = () => this.show(f.q, f.a);
      li.append(b);
      ul.append(li);
    }
  }

  // Add a question and answer to the conversation.
  show(q, a, cls = '') {
    const log = $('askLog');
    const qEl = document.createElement('p');
    qEl.className = 'q';
    qEl.textContent = q;
    const aEl = document.createElement('p');
    aEl.className = `a ${cls}`;
    aEl.textContent = a;
    log.append(qEl, aEl);
    log.hidden = false;
    aEl.scrollIntoView({ block: 'nearest' });
    return aEl;
  }

  async ask() {
    const input = $('askInput');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    const hits = searchFaq(q, 2);
    if (hits.length) this.show(q, hits.map((f) => `${f.q}\n${f.a}`).join('\n\n'));
    else this.show(q, 'Nothing in the FAQ matches that. Try other words, or ask on the Suggest tab.');
  }

  suggest() {
    const text = $('suggestText').value.trim();
    if (!text) return this.toast('Write something first');
    const kind = $('suggestKind').value;
    const info = $('suggestDevice').checked ? device() : '';
    const title = `${{ idea: '💡 Idea', bug: '🐞 Problem', other: '💬' }[kind] || '💬'}: ${text.split('\n')[0].slice(0, 70)}`;
    const body = `${text}\n\n---\nApp version ${APP_VERSION}${info ? `\nDevice: ${info}` : ''}`;
    window.open(`https://github.com/${GITHUB_REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
  }
}
