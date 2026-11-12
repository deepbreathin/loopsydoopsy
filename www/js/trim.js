// Trim editor: slide a fixed-length (bar-locked) window over the raw take, or set a free
// length for one-shots, and silence parts of it (a breath, a cough) without changing its
// length. The pad keeps playing in time with the other loops the whole time, and changes
// are heard from the next bar; a playhead shows where it is.
import { mod, rawIndex } from './timing.js';

const $ = (id) => document.getElementById(id);
const HELP = {
  move: 'Drag the coloured window to slide the loop earlier or later, and listen: it plays along with your other loops. The dim parts either side were caught just before you started and after you finished.',
  silence: 'Drag across a part to silence it, like a breath or a click. The loop stays the same length.',
};

export class TrimEditor {
  constructor(engine, { onClose }) {
    this.engine = engine;
    this.onClose = onClose;
    this.dlg = $('trimSheet');
    this.canvas = $('trimCanvas');
    this.g = this.canvas.getContext('2d');
    this.pad = null;
    this.mode = 'move';
    $('trimMode').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.setMode(b.dataset.mode);
    });
    $('silenceUndo').onclick = () => {
      this.pad.mutes.pop();
      this.commit();
    };
    $('silenceClear').onclick = () => {
      this.pad.mutes = [];
      this.commit();
    };

    $('trimLen').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const len = b.dataset.len === 'free' ? 'free' : Number(b.dataset.len);
      this.engine.setLength(this.pad, len);
      this.commit();
    });
    $('nudgeL').onclick = () => this.nudge(-0.01);
    $('nudgeR').onclick = () => this.nudge(0.01);
    $('trimFold').onchange = (e) => {
      this.pad.fold = e.target.checked;
      this.commit();
    };
    $('trimPreview').onclick = () => this.engine.trigger(this.pad);
    $('trimReset').onclick = () => {
      const p = this.pad;
      p.trimStart = p.defaultStart;
      p.fold = false;
      this.engine.setLength(p, this.snapshot.bars ?? p.bars);
      if (this.snapshot.mode === 'loop') this.engine.setMode(p, 'loop');
      this.commit();
    };
    $('trimCancel').onclick = () => {
      const pad = this.pad;
      this.engine.restore(pad, this.snapshot);
      if (this.wasEnabled && pad.mode === 'loop') this.engine.trigger(pad);
      this.dlg.close('cancel');
    };
    this.dlg.addEventListener('close', () => {
      this.pad = null;
      cancelAnimationFrame(this.raf);
      this.onClose?.();
    });

    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.pad) return;
      this.canvas.setPointerCapture(e.pointerId);
      const x = this.toX(e);
      const endX = this.sampleToX(this.pad.trimStart + this.pad.lengthSamples);
      const resize = this.pad.free && Math.abs(x - endX) < 22;
      drag = { x, start: this.pad.trimStart, len: this.pad.lengthSamples, resize, silence: this.mode === 'silence' };
      if (drag.silence) this.selection = [x, x];
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = this.pad;
      const d = (this.toX(e) - drag.x) * this.samplesPerPx;
      if (drag.silence) {
        this.selection = [drag.x, this.toX(e)];
      } else if (drag.resize) {
        p.lengthSamples = Math.max(Math.round(0.05 * p.sampleRate), Math.round(drag.len + d));
      } else {
        p.trimStart = this.snap(Math.round(drag.start + d));
        // Let you hear it while you drag (a few times a second, not on every move).
        if (performance.now() - (this.lastLive || 0) > 150) {
          this.lastLive = performance.now();
          this.engine.replaceBuffer(p);
        }
      }
      this.draw();
    });
    const end = () => {
      if (!drag) return;
      if (drag.silence && this.selection) {
        const [a, b] = this.selection.map((x) => Math.round(this.viewStart + x * this.samplesPerPx));
        // A tap rather than a drag silences nothing.
        if (Math.abs(b - a) > 0.02 * this.pad.sampleRate) this.pad.mutes.push([Math.min(a, b), Math.max(a, b)]);
        this.selection = null;
      }
      drag = null;
      this.commit();
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  open(pad) {
    this.pad = pad;
    this.snapshot = this.engine.snapshot(pad);
    $('trimFold').checked = pad.fold;
    this.setMode('move');
    this.dlg.showModal();
    this.resize();
    this.draw();
    // Play it (in time with whatever else is playing) so every change can be heard.
    this.wasEnabled = pad.enabled;
    if (pad.mode === 'loop' && !pad.enabled) this.engine.trigger(pad);
    const tick = () => {
      if (!this.pad) return;
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  setMode(mode) {
    this.mode = mode;
    for (const b of $('trimMode').children) b.setAttribute('aria-selected', b.dataset.mode === mode);
    $('trimHelp').textContent = HELP[mode];
    $('silenceRow').hidden = mode !== 'silence';
  }

  // Where the pad's playhead is, as a sample position in the raw capture (or null).
  playheadSample() {
    const p = this.pad;
    const f = this.engine.playhead(p);
    if (f == null || !p.lengthSamples) return null;
    const i = Math.floor(f * p.lengthSamples);
    const turn = p.free || !p.bars ? 0 : mod(p.startBar || 0, p.bars);
    return rawIndex(i, p.trimStart, p.lengthSamples, Math.round((turn * p.lengthSamples) / p.bars));
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.w = r.width;
    this.h = r.height;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const raw = this.pad.raw;
    // View spans the whole capture, with a little room either side.
    this.viewStart = -Math.round(0.05 * this.pad.sampleRate);
    this.viewLen = raw.length - this.viewStart * 2;
    this.samplesPerPx = this.viewLen / this.w;
    // Per-pixel peaks.
    this.px = new Float32Array(Math.ceil(this.w));
    for (let x = 0; x < this.px.length; x++) {
      const s = Math.max(0, Math.floor(this.viewStart + x * this.samplesPerPx));
      const e = Math.min(raw.length, Math.floor(this.viewStart + (x + 1) * this.samplesPerPx));
      let m = 0;
      for (let i = s; i < e; i++) m = Math.max(m, Math.abs(raw[i]));
      this.px[x] = m;
    }
    this.pxMax = Math.max(0.05, ...this.px);
  }

  toX(e) {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }
  sampleToX(s) {
    return (s - this.viewStart) / this.samplesPerPx;
  }

  snap(s) {
    const p = this.pad;
    if (!$('trimSnap').checked) return s;
    const step = (this.engine.beat / 4) * p.sampleRate;
    return Math.round(p.defaultStart + Math.round((s - p.defaultStart) / step) * step);
  }

  nudge(sec) {
    this.pad.trimStart += Math.round(sec * this.pad.sampleRate);
    this.commit();
  }

  commit() {
    const p = this.pad;
    p.trimStart = Math.max(-p.lengthSamples + 1, Math.min(p.raw.length - 1, p.trimStart));
    this.engine.replaceBuffer(p);
    this.draw();
  }

  draw() {
    const { g, w, h, pad: p } = this;
    if (!p) return;
    const mid = h / 2;
    g.clearRect(0, 0, w, h);
    const x0 = this.sampleToX(p.trimStart);
    const x1 = this.sampleToX(p.trimStart + p.lengthSamples);
    const color = getComputedStyle(document.documentElement).getPropertyValue(`--p${p.index}`).trim();

    // Window.
    g.fillStyle = color;
    g.globalAlpha = 0.22;
    g.fillRect(x0, 0, x1 - x0, h);
    g.globalAlpha = 1;

    // Beat grid inside the window.
    const sr = p.sampleRate;
    const beat = this.engine.beat * sr;
    const bpb = this.engine.settings.beatsPerBar;
    for (let i = 0; ; i++) {
      const x = this.sampleToX(p.trimStart + i * beat);
      if (x > x1 + 0.5) break;
      g.fillStyle = i % bpb === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.14)';
      g.fillRect(Math.round(x), 0, 1, h);
    }

    // Waveform: bright inside the window, dim outside.
    for (let x = 0; x < this.px.length; x++) {
      const a = (this.px[x] / this.pxMax) * (mid - 6);
      const inside = x >= x0 && x <= x1;
      g.fillStyle = inside ? color : 'rgba(255,255,255,0.22)';
      g.fillRect(x, mid - a, 1, Math.max(1, a * 2));
    }

    // Silenced parts: dark, with a line through the waveform.
    for (const [a, b] of p.mutes) {
      const xa = this.sampleToX(a);
      const xb = this.sampleToX(b);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(xa, 0, xb - xa, h);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(xa, mid, xb - xa, 1);
      if (xb - xa > 26) {
        g.font = '13px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillText('🔇', (xa + xb) / 2, 6);
        g.textAlign = 'left';
      }
    }
    if (this.selection) {
      const [xa, xb] = this.selection;
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(Math.min(xa, xb), 0, Math.abs(xb - xa), h);
    }

    // Window edges + handles.
    g.fillStyle = '#fff';
    g.fillRect(x0 - 1, 0, 2, h);
    g.fillRect(x1 - 1, 0, 2, h);
    g.beginPath();
    g.roundRect(x0 - 5, mid - 16, 10, 32, 5);
    if (p.free) g.roundRect(x1 - 5, mid - 16, 10, 32, 5);
    g.fill();

    // Playhead: what you're hearing right now.
    const ph = this.playheadSample();
    if (ph != null) {
      const x = this.sampleToX(ph);
      g.fillStyle = '#fff';
      g.fillRect(x - 1, 0, 2, h);
      g.beginPath();
      g.arc(x, h - 6, 4, 0, Math.PI * 2);
      g.fill();
    }

    g.font = '600 11px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.textBaseline = 'top';
    if (x0 > 40) g.fillText('early', 6, 6);
    if (w - x1 > 56) g.fillText('overrun', x1 + 6, 6);

    // Header info + length buttons.
    const offMs = Math.round(((p.trimStart - p.defaultStart) / sr) * 1000);
    const secs = (p.lengthSamples / sr).toFixed(2);
    $('trimInfo').textContent = `${p.free ? 'free' : `${p.bars} bar${p.bars === 1 ? '' : 's'}`} · ${secs}s · ${offMs >= 0 ? '+' : ''}${offMs}ms`;
    for (const b of $('trimLen').children) {
      const on = p.free ? b.dataset.len === 'free' : Number(b.dataset.len) === p.bars;
      b.setAttribute('aria-checked', on);
    }
    $('trimFold').disabled = p.free;
    $('silenceUndo').disabled = $('silenceClear').disabled = !p.mutes.length;
  }
}
