// Draws one pad: a circular waveform with beat ticks and a playhead sweeping round.
// 12 o'clock is always the start of the loop, so you can see exactly where it comes round.


const TAU = Math.PI * 2;
const WAVE_GAIN = 2.5;
const angle = (f) => -Math.PI / 2 + f * TAU;

const ink = 'rgba(20,14,30,';

export function resizeCanvas(g, w, h, dpr) {
  g.canvas.width = Math.round(w * dpr);
  g.canvas.height = Math.round(h * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Keep the ring and waveform on their own canvas so moving playheads don't repaint them.
export class PadView {
  constructor(face, motion) {
    this.face = face.getContext('2d');
    this.motion = motion.getContext('2d');
  }

  resize(w, h, dpr) {
    const previous = this.geometry;
    if (previous?.w === w && previous.h === h && this.dpr === dpr) return;
    const R = Math.min(w, h) * 0.43;
    this.geometry = { w, h, cx: w / 2, cy: h / 2, R, r0: R * 0.56, lw: Math.max(1.5, R * 0.025) };
    this.dpr = dpr;
    this.faceKey = this.motionKey = null;
    resizeCanvas(this.face, w, h, dpr);
    resizeCanvas(this.motion, w, h, dpr);
  }

  draw(pad, v, micFrame) {
    const d = this.geometry;
    if (!d?.w || !d.h) return;
    const ready = v.state === 'ready';
    const wave = ready ? pad.peaks : pad.livePeaks;
    const faceKey = [v.state, v.beats, v.bpb, v.lengthLabel, v.volume, v.phase != null, wave && !ready ? micFrame : 0].join('/');
    if (faceKey !== this.faceKey || wave !== this.wave) {
      this.faceKey = faceKey;
      this.wave = wave;
      this.wavePath = drawFace(this.face, d, wave, v);
    }
    const moving = v.phase != null || v.pending || v.state === 'armed' || v.state === 'recording';
    const motionKey = [v.state, v.enabled, v.mode, v.bars].join('/');
    if (moving || this.wasMoving || motionKey !== this.motionKey) {
      this.motionKey = motionKey;
      this.wasMoving = moving;
      drawMotion(this.motion, d, this.wavePath, v);
    }
  }
}

function drawFace(g, { w, h, cx, cy, R, r0, lw }, wave, v) {
  g.clearRect(0, 0, w, h);

  // Ring track.
  g.lineWidth = lw;
  g.strokeStyle = ink + '0.18)';
  circle(g, cx, cy, R);
  g.stroke();

  // Beat ticks — bar lines longer — so the length of the loop is always visible.
  const beats = v.beats;
  if (beats) {
    for (let i = 0; i < beats; i++) {
      const a = angle(i / beats);
      const isBar = i % v.bpb === 0;
      const len = i === 0 ? R * 0.16 : isBar ? R * 0.1 : R * 0.05;
      g.lineWidth = i === 0 ? lw * 2 : isBar ? lw * 1.3 : lw * 0.8;
      g.strokeStyle = ink + (i === 0 ? '0.75)' : isBar ? '0.45)' : '0.25)');
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (R - len), cy + Math.sin(a) * (R - len));
      g.lineTo(cx + Math.cos(a) * (R - lw), cy + Math.sin(a) * (R - lw));
      g.stroke();
    }
  }

  const s = v.state;

  if (s === 'empty') {
    drawMic(g, cx, cy - R * 0.08, R * 0.22, ink + '0.55)');
    label(g, cx, cy + R * 0.38, R * 0.15, ink + '0.6)', 'Tap to record');
    label(g, cx, cy + R * 0.56, R * 0.12, ink + '0.45)', v.lengthLabel);
    return;
  }

  if (!wave) return null;
  const fill = s === 'ready' ? (v.phase != null ? 0.24 : 0.2) : 0.35;
  const path = waveformPath(cx, cy, r0, R * 0.38, R * 0.24, wave, WAVE_GAIN * v.volume);
  g.fillStyle = ink + fill + ')';
  g.fill(path);
  return path;
}

function drawMotion(g, { w, h, cx, cy, R, r0, lw }, wavePath, v) {
  g.clearRect(0, 0, w, h);
  const s = v.state;
  if (s === 'empty') return;
  const phase = v.phase;

  if (wavePath && phase > 0) {
    g.save();
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, angle(0), angle(phase));
    g.closePath();
    g.clip();
    g.fillStyle = ink + '0.5)';
    g.fill(wavePath);
    g.restore();
  }

  if (s === 'armed') {
    // Count-in. The circle is the new loop, at the same pace as the loops playing: the hand
    // moves exactly as fast as their playheads, and the count-in is just the last bar of the
    // circle (a quarter of it for a 4-bar loop), ending at the red mark where recording starts.
    // Nothing moves faster than the music, so it stays calm.
    const top = angle(0);
    const zone = angle(v.countFrom);
    // The red "go" mark at 12 o'clock.
    g.fillStyle = '#e8132b';
    g.beginPath();
    g.moveTo(cx, cy - R + R * 0.02);
    g.lineTo(cx - R * 0.09, cy - R - R * 0.13);
    g.lineTo(cx + R * 0.09, cy - R - R * 0.13);
    g.closePath();
    g.fill();
    // The count-in bar, as a soft track leading up to the mark.
    g.lineCap = 'round';
    g.lineWidth = lw * 3.2;
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.beginPath();
    g.arc(cx, cy, R, zone, top + (v.countFrom === 0 ? Math.PI * 2 : 0));
    g.stroke();
    const f = v.handFrac; // null until the hand is within one turn of the start
    if (f != null) {
      if (v.counting) {
        // Filled in as the hand moves through the count-in bar.
        g.strokeStyle = 'rgba(255,255,255,0.95)';
        g.beginPath();
        g.arc(cx, cy, R, zone, angle(Math.max(f, v.countFrom)));
        g.stroke();
      }
      const a = angle(f);
      const c = v.counting ? '#fff' : 'rgba(255,255,255,0.6)';
      g.strokeStyle = c;
      g.lineWidth = lw * 2.4;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * R * 0.42, cy + Math.sin(a) * R * 0.42);
      g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.stroke();
      dot(g, cx + Math.cos(a) * R, cy + Math.sin(a) * R, lw * 3.4, c);
    }
    if (v.counting) {
      label(g, cx, cy - R * 0.04, R * 0.32, 'rgba(255,255,255,0.95)', String(v.countdown), true);
      label(g, cx, cy + R * 0.25, R * 0.11, ink + '0.75)', 'sing at the top');
    } else {
      label(g, cx, cy - R * 0.12, R * 0.15, ink + '0.8)', 'starts with', true);
      label(g, cx, cy + R * 0.08, R * 0.15, ink + '0.8)', 'the loops', true);
      label(g, cx, cy + R * 0.3, R * 0.085, ink + '0.6)', v.waitBars > 1 ? `count-in in ${v.waitBars} bars` : 'count-in next bar');
    }
    return;
  }

  if (s === 'recording' || s === 'processing') {
    const f = Math.min(1, Math.max(0, v.recFrac));
    const last = v.lastBar;
    // Progress arc: red while recording, white in the final bar so you know to wrap up.
    g.lineWidth = lw * 3.2;
    g.lineCap = 'round';
    g.strokeStyle = last ? 'rgba(255,255,255,0.95)' : '#e8132b';
    g.beginPath();
    g.arc(cx, cy, R, angle(0), angle(f));
    g.stroke();
    head(g, cx, cy, R, r0 * 0.5, f, last ? '#fff' : '#e8132b', lw);
    if (s === 'processing') {
      label(g, cx, cy, R * 0.16, ink + '0.7)', 'saving…');
    } else if (last) {
      label(g, cx, cy - R * 0.04, R * 0.42, '#fff', String(v.beatsLeft), true);
      label(g, cx, cy + R * 0.36, R * 0.13, ink + '0.75)', v.beatsLeft === 1 ? 'finish now' : 'finish in');
    } else {
      dot(g, cx, cy - R * 0.08, R * 0.1, v.beatPulse ? '#e8132b' : 'rgba(232,19,43,0.55)');
      label(g, cx, cy + R * 0.16, R * 0.14, ink + '0.75)', 'REC');
      label(g, cx, cy + R * 0.34, R * 0.12, ink + '0.55)', `bar ${v.recBar}/${v.bars}`);
    }
    return;
  }

  // Ready.
  if (v.pending) {
    g.setLineDash([R * 0.04, R * 0.05]);
    g.lineWidth = lw * 2;
    g.strokeStyle = v.pending === 'start' ? 'rgba(255,255,255,0.9)' : ink + '0.5)';
    g.lineDashOffset = v.time * R * 0.5;
    circle(g, cx, cy, R);
    g.stroke();
    g.setLineDash([]);
  }
  if (phase != null) {
    g.lineWidth = lw * 2.4;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.arc(cx, cy, R, angle(0), angle(phase));
    g.stroke();
    head(g, cx, cy, R, r0 * 0.35, phase, '#fff', lw);
  } else if (v.enabled && v.mode === 'loop') {
    g.lineWidth = lw * 1.6;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    circle(g, cx, cy, R);
    g.stroke();
  }
  badge(g, cx, cy, R, ink, v);
}

function circle(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
}

function dot(g, x, y, r, c) {
  g.fillStyle = c;
  circle(g, x, y, r);
  g.fill();
}

function head(g, cx, cy, R, inner, f, color, lw) {
  const a = angle(f);
  g.strokeStyle = color;
  g.lineWidth = lw * 1.4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
  g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
  g.stroke();
  dot(g, cx + Math.cos(a) * R, cy + Math.sin(a) * R, lw * 2.6, color);
}

// A closed path for the radial waveform, reused for the played portion.
function waveformPath(cx, cy, r0, outAmp, inAmp, wave, gain) {
  const path = new Path2D();
  const n = wave.length;
  const point = (i, inside) => {
    const a = angle(i / n);
    const amp = Math.sqrt(Math.min(1, wave[Math.min(i, n - 1)] * gain));
    const r = inside ? r0 - amp * inAmp - 1 : r0 + amp * outAmp + 1;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (!inside && i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  };
  for (let i = 0; i <= n; i++) point(i, false);
  for (let i = n; i >= 0; i--) point(i, true);
  path.closePath();
  return path;
}

function label(g, x, y, size, color, text, bold) {
  g.fillStyle = color;
  g.font = `${bold ? 800 : 650} ${Math.round(size)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

function badge(g, cx, cy, R, ink, v) {
  const text = v.pendingLabel || (v.mode === 'loop' ? `∞ ${v.bars} bar${v.bars === 1 ? '' : 's'}` : '1× shot');
  label(g, cx, cy, R * 0.13, ink + '0.6)', text);
}

function drawMic(g, x, y, s, color) {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = s * 0.18;
  g.lineCap = 'round';
  const w = s * 0.55;
  const h = s * 1.1;
  g.beginPath();
  g.roundRect(x - w / 2, y - h * 0.7, w, h, w / 2);
  g.fill();
  g.beginPath();
  g.arc(x, y, s * 0.6, 0.15 * Math.PI, 0.85 * Math.PI);
  g.moveTo(x, y + s * 0.6);
  g.lineTo(x, y + s * 0.9);
  g.stroke();
}

// The Sing tile: tap to record the pads with your voice on top. Shows a scrolling meter of
// the mic so you can see quiet humming is getting through. Lays out as a wide strip on
// phones and as a square on the unfolded screen.
export function drawSing(g, w, h, v) {
  g.clearRect(0, 0, w, h);
  const strip = w > h * 2.2;
  const ink = v.recording ? '#fff' : 'rgba(20,14,30,0.78)';
  const soft = v.recording ? 'rgba(255,255,255,0.75)' : 'rgba(20,14,30,0.5)';
  const title = v.recording ? `Recording ${v.elapsed}` : 'Sing on top';
  const sub = v.recording ? 'tap to stop & save' : v.padRec ? 'tap to add your voice to the take' : 'records the pads + your voice';

  let meter;
  if (h > w * 1.6) {
    // Tall column beside the pads (landscape phone).
    const s = w * 0.15;
    drawMic(g, w / 2, h * 0.12, s, ink);
    label(g, w / 2, h * 0.8, s * 1.05, ink, v.recording ? v.elapsed : 'Sing', true);
    label(g, w / 2, h * 0.8 + s * 1.2, s * 0.8, soft, v.recording ? 'tap to stop' : v.padRec ? '+ voice' : 'on top');
    meter = { x: w * 0.12, y: h * 0.26, w: w * 0.76, h: h * 0.42 };
  } else if (strip) {
    const s = Math.min(h * 0.32, 22);
    drawMic(g, h * 0.55, h / 2 + s * 0.1, s, ink);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = ink;
    g.font = `800 ${Math.round(h * 0.27)}px system-ui, -apple-system, sans-serif`;
    g.fillText(title, h * 1.05, h * 0.38);
    g.fillStyle = soft;
    g.font = `600 ${Math.round(h * 0.19)}px system-ui, -apple-system, sans-serif`;
    g.fillText(sub, h * 1.05, h * 0.68);
    const left = Math.max(h * 1.05 + 190, w * 0.45);
    meter = { x: left, y: h * 0.2, w: w - left - h * 0.3, h: h * 0.6 };
  } else {
    const R = Math.min(w, h);
    drawMic(g, w / 2, h * 0.2, R * 0.08, ink);
    label(g, w / 2, h * 0.75, R * 0.085, ink, title, true);
    label(g, w / 2, h * 0.85, R * 0.055, soft, sub);
    meter = { x: w * 0.16, y: h * 0.4, w: w * 0.74, h: h * 0.24 };
  }
  if (meter.w < 30) return;

  // Loudness of the mic, newest on the right, so you can see quiet humming is getting through.
  const n = v.levels.length;
  const cols = Math.max(8, Math.min(n, Math.floor(meter.w / 4)));
  const cw = meter.w / cols;
  for (let i = 0; i < cols; i++) {
    const lv = v.micOpen ? v.levels[n - cols + i] : 0;
    const f = Math.max(0.03, Math.min(1, (20 * Math.log10(lv + 1e-6) + 60) / 54));
    g.fillStyle = lv > 0.7 ? '#ff2d46' : v.recording ? '#fff' : ink;
    g.globalAlpha = v.micOpen ? 0.7 : 0.25;
    const bh = f * meter.h;
    g.fillRect(meter.x + i * cw + cw * 0.2, meter.y + (meter.h - bh) / 2, Math.max(1, cw * 0.6), bh);
  }
  g.globalAlpha = 1;
}
