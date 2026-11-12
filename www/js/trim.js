// Trim editor. Three ways to tidy a take, all without changing its length:
//   move     slide the whole loop window earlier or later
//   part     select a bit (a note, a word) and drag just that into place
//   silence  drag across a breath or click to silence it
// The pad keeps playing in time with the other loops the whole time, with a playhead, and
// another pad's sound can be shown alongside ("Compare with") to line things up by eye.
import { mod, rawIndex } from './timing.js';

const $ = (id) => document.getElementById(id);
const HELP = {
  move: 'Drag the coloured window to slide the whole loop earlier or later, and listen: it plays along with your other loops. The dim parts either side were caught just before you started and after you finished.',
  part: 'Drag across a bit (a note, a word) to select it, then drag the selection to move just that bit. ‹ › nudge it by 10 ms.',
  silence: 'Drag across a part to silence it, like a breath or a click. The loop stays the same length.',
};
const LIVE_MS = 150; // how often changes are heard while dragging

export class TrimEditor {
  constructor(engine, { onClose }) {
    this.engine = engine;
    this.onClose = onClose;
    this.dlg = $('trimSheet');
    this.canvas = $('trimCanvas');
    this.g = this.canvas.getContext('2d');
    this.pad = null;
    this.mode = 'move';
    this.compare = null; // another pad to show alongside
    this.selection = null; // [a, b] in raw samples (part mode)
    $('trimMode').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) this.setMode(b.dataset.mode);
    });
    $('trimCompare').onchange = (e) => {
      this.compare = e.target.value === '' ? null : this.engine.pads[Number(e.target.value)];
      this.overlayKey = null;
      this.draw();
    };
    $('silenceUndo').onclick = () => {
      this.pad.edits.pop();
      this.selection = null;
      this.commit();
    };
    $('silenceClear').onclick = () => {
      this.pad.edits = [];
      this.selection = null;
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
      p.edits = [];
      this.selection = null;
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
      const p = this.pad;
      if (!p) return;
      this.canvas.setPointerCapture(e.pointerId);
      const x = this.toX(e);
      const s = this.xToSample(x);
      drag = { x, s, start: p.trimStart, len: p.lengthSamples };
      if (this.mode === 'move') {
        drag.kind = p.free && Math.abs(x - this.sampleToX(p.trimStart + p.lengthSamples)) < 22 ? 'resize' : 'window';
      } else if (this.mode === 'part' && this.selection && s >= this.selection[0] && s <= this.selection[1]) {
        // Dragging the selected bit: an edit that follows the finger until let go.
        drag.kind = 'part';
        drag.edit = { type: 'move', a: this.selection[0], b: this.selection[1], shift: 0 };
        drag.sel = [...this.selection];
        p.edits.push(drag.edit);
      } else {
        drag.kind = 'select';
        this.selection = null;
        this.dragSel = [x, x];
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = this.pad;
      const x = this.toX(e);
      const d = Math.round((x - drag.x) * this.samplesPerPx);
      if (drag.kind === 'select') {
        this.dragSel = [drag.x, x];
      } else if (drag.kind === 'resize') {
        p.lengthSamples = Math.max(Math.round(0.05 * p.sampleRate), drag.len + d);
      } else if (drag.kind === 'window') {
        p.trimStart = this.snap(drag.start + d);
        this.live();
      } else if (drag.kind === 'part') {
        drag.edit.shift = d;
        this.selection = [drag.sel[0] + d, drag.sel[1] + d];
        this.live(true);
      }
      this.draw();
    });
    const end = () => {
      if (!drag) return;
      const p = this.pad;
      if (drag.kind === 'select' && this.dragSel) {
        const [a, b] = this.dragSel.map((x) => this.xToSample(x)).sort((m, n) => m - n);
        this.dragSel = null;
        // A tap rather than a drag selects nothing.
        if (b - a > 0.02 * p.sampleRate) {
          if (this.mode === 'silence') p.edits.push({ type: 'mute', a, b });
          else this.selection = [a, b];
        }
      } else if (drag.kind === 'part' && !drag.edit.shift) {
        p.edits.pop(); // didn't actually move
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
    this.selection = null;
    $('trimFold').checked = pad.fold;
    this.setMode('move');
    // "Compare with": the other pads that have a sound.
    const sel = $('trimCompare');
    sel.innerHTML = '<option value="">nothing</option>';
    for (const other of this.engine.pads) {
      if (other === pad || !other.buffer) continue;
      const o = document.createElement('option');
      o.value = other.index;
      o.textContent = `Pad ${other.index + 1}`;
      sel.append(o);
    }
    if (this.compare && (this.compare === pad || !this.compare.buffer)) this.compare = null;
    sel.value = this.compare ? String(this.compare.index) : '';
    $('trimCompareRow').hidden = sel.options.length < 2 || pad.free;
    this.overlayKey = null;
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
    this.selection = null;
    for (const b of $('trimMode').children) b.setAttribute('aria-selected', b.dataset.mode === mode);
    $('trimHelp').textContent = HELP[mode];
    $('silenceRow').hidden = mode === 'move';
    this.draw();
  }

  // Hear changes while dragging, a few times a second rather than on every move.
  live(edited) {
    if (performance.now() - (this.lastLive || 0) < LIVE_MS) return;
    this.lastLive = performance.now();
    this.engine.replaceBuffer(this.pad);
    if (edited) this.wave();
  }

  // Where the pad's playhead is, as a sample position in the raw capture (or null).
  playheadSample() {
    const p = this.pad;
    const f = this.engine.playhead(p);
    if (f == null || !p.lengthSamples) return null;
    return rawIndex(Math.floor(f * p.lengthSamples), p.trimStart, p.lengthSamples, this.turnShift());
  }

  // The turn applied to takes that began partway through the loop cycle, in samples.
  turnShift() {
    const p = this.pad;
    const turn = p.free || !p.bars ? 0 : mod(p.startBar || 0, p.bars);
    return Math.round((turn * p.lengthSamples) / p.bars);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.w = r.width;
    this.h = r.height;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // View spans the whole capture, with a little room either side.
    this.viewStart = -Math.round(0.05 * this.pad.sampleRate);
    this.viewLen = this.pad.raw.length - this.viewStart * 2;
    this.samplesPerPx = this.viewLen / this.w;
    this.wave();
  }

  // Per-pixel peaks of the capture as it sounds (silences and moved parts applied).
  wave() {
    const raw = this.pad.edits.length ? this.engine.editedRaw(this.pad) : this.pad.raw;
    this.px = new Float32Array(Math.ceil(this.w));
    for (let x = 0; x < this.px.length; x++) {
      const s = Math.max(0, Math.floor(this.viewStart + x * this.samplesPerPx));
      const e = Math.min(raw.length, Math.floor(this.viewStart + (x + 1) * this.samplesPerPx));
      let m = 0;
      for (let i = s; i < e; i++) m = Math.max(m, Math.abs(raw[i]));
      this.px[x] = m;
    }
    if (!this.pxMax || !this.pad.edits.length) this.pxMax = Math.max(0.05, ...this.px);
  }

  // Per-pixel peaks of the compared pad, lined up with this pad's loop as they play together.
  overlay() {
    const p = this.pad;
    const o = this.compare;
    if (!o?.buffer) return null;
    const shift = this.turnShift();
    const key = `${o.index}:${o.buffer.length}:${p.trimStart}:${shift}:${this.w}`;
    if (key === this.overlayKey) return this.overlayPx;
    const data = o.buffer.getChannelData(0);
    const ratio = o.buffer.sampleRate / p.sampleRate;
    const n = data.length;
    const out = new Float32Array(Math.ceil(this.w));
    const step = Math.max(1, Math.floor(this.samplesPerPx / 48));
    for (let x = 0; x < out.length; x++) {
      const r0 = this.viewStart + x * this.samplesPerPx;
      let m = 0;
      for (let k = 0; k < this.samplesPerPx; k += step) {
        // This pad's raw sample → its place in the loop cycle → the other pad's sample there.
        const j = Math.floor(mod((r0 + k - p.trimStart + shift) * ratio, n));
        const v = Math.abs(data[j]);
        if (v > m) m = v;
      }
      out[x] = m;
    }
    let max = 0.05;
    for (const v of out) max = Math.max(max, v);
    for (let x = 0; x < out.length; x++) out[x] /= max;
    this.overlayKey = key;
    this.overlayPx = out;
    return out;
  }

  toX(e) {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }
  sampleToX(s) {
    return (s - this.viewStart) / this.samplesPerPx;
  }
  xToSample(x) {
    return Math.round(this.viewStart + x * this.samplesPerPx);
  }

  snap(s) {
    const p = this.pad;
    if (!$('trimSnap').checked) return s;
    const step = (this.engine.beat / 4) * p.sampleRate;
    return Math.round(p.defaultStart + Math.round((s - p.defaultStart) / step) * step);
  }

  // ‹ ›: nudge the selected bit in part mode, otherwise the whole window.
  nudge(sec) {
    const p = this.pad;
    const d = Math.round(sec * p.sampleRate);
    if (this.mode === 'part' && this.selection) {
      p.edits.push({ type: 'move', a: this.selection[0], b: this.selection[1], shift: d });
      this.selection = [this.selection[0] + d, this.selection[1] + d];
    } else {
      p.trimStart += d;
    }
    this.commit();
  }

  commit() {
    const p = this.pad;
    p.trimStart = Math.max(-p.lengthSamples + 1, Math.min(p.raw.length - 1, p.trimStart));
    this.engine.replaceBuffer(p);
    this.wave();
    this.draw();
  }

  draw() {
    const { g, w, h, pad: p } = this;
    if (!p || !this.px) return;
    const mid = h / 2;
    g.clearRect(0, 0, w, h);
    const x0 = this.sampleToX(p.trimStart);
    const x1 = this.sampleToX(p.trimStart + p.lengthSamples);
    const css = getComputedStyle(document.documentElement);
    const color = css.getPropertyValue(`--p${p.index}`).trim();

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

    // Waveforms. Comparing: the other pad above the line, this one below, so where their
    // notes start can be matched by eye. Otherwise this pad's sound, both ways.
    const over = this.overlay();
    if (over) {
      g.fillStyle = css.getPropertyValue(`--p${this.compare.index}`).trim();
      g.globalAlpha = 0.85;
      for (let x = 0; x < over.length; x++) {
        const a = over[x] * (mid - 6);
        g.fillRect(x, mid - a, 1, Math.max(1, a));
      }
      g.globalAlpha = 1;
    }
    for (let x = 0; x < this.px.length; x++) {
      const a = Math.min(1, this.px[x] / this.pxMax) * (mid - 6);
      const inside = x >= x0 && x <= x1;
      g.fillStyle = inside ? color : 'rgba(255,255,255,0.22)';
      if (over) g.fillRect(x, mid, 1, Math.max(1, a));
      else g.fillRect(x, mid - a, 1, Math.max(1, a * 2));
    }
    if (over) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(0, mid, w, 1);
    }

    // Silenced parts: dark. Moved parts are just heard (and seen) where they now are.
    for (const ed of p.edits) {
      if (ed.type !== 'mute') continue;
      const xa = this.sampleToX(ed.a);
      const xb = this.sampleToX(ed.b);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(xa, 0, xb - xa, h);
      if (xb - xa > 26) {
        g.font = '13px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillText('🔇', (xa + xb) / 2, 6);
        g.textAlign = 'left';
      }
    }
    const sel = this.dragSel ?? (this.selection && this.selection.map((s) => this.sampleToX(s)));
    if (sel) {
      const [xa, xb] = sel;
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(Math.min(xa, xb), 0, Math.abs(xb - xa), h);
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.setLineDash([4, 3]);
      g.strokeRect(Math.min(xa, xb) + 0.5, 1, Math.abs(xb - xa) - 1, h - 2);
      g.setLineDash([]);
    }

    // Window edges + handles.
    g.fillStyle = '#fff';
    g.fillRect(x0 - 1, 0, 2, h);
    g.fillRect(x1 - 1, 0, 2, h);
    if (this.mode === 'move') {
      g.beginPath();
      g.roundRect(x0 - 5, mid - 16, 10, 32, 5);
      if (p.free) g.roundRect(x1 - 5, mid - 16, 10, 32, 5);
      g.fill();
    }

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

    // Header info + buttons.
    const offMs = Math.round(((p.trimStart - p.defaultStart) / sr) * 1000);
    const secs = (p.lengthSamples / sr).toFixed(2);
    const info = `${p.free ? 'free' : `${p.bars} bar${p.bars === 1 ? '' : 's'}`} · ${secs}s · ${offMs >= 0 ? '+' : ''}${offMs}ms`;
    if ($('trimInfo').textContent !== info) $('trimInfo').textContent = info;
    for (const b of $('trimLen').children) {
      const on = p.free ? b.dataset.len === 'free' : Number(b.dataset.len) === p.bars;
      b.setAttribute('aria-checked', on);
    }
    $('trimFold').disabled = p.free;
    $('silenceUndo').disabled = $('silenceClear').disabled = !p.edits.length;
  }
}
