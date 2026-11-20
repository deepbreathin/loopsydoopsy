// Injected into a copy of Loopsy (classic script, runs before the app). Records, frame-aligned:
//   out: everything the app sends to the speaker (digital)
//   mic: what the app's microphone input carries
// and a clock log (performance.now vs ctx.currentTime) to spot audio-thread stalls.
// Every 10 s it uploads the newest segment to the lab server (tools/mic-lab/serve.py).
(() => {
  const WORKLET = '/www/js/capture-worklet.js';
  const T0 = Date.now();
  let seg = 0;
  const post = (path, body) => fetch(path, { method: 'POST', body }).catch(() => {});
  // No service worker: always the files as served.
  if (navigator.serviceWorker) navigator.serviceWorker.register = () => new Promise(() => {});

  const AC = window.AudioContext;
  window.AudioContext = window.webkitAudioContext = class extends AC {
    constructor(opts) {
      super(opts);
      const ctx = this;
      const lab = { opts, out: [], mic: [], clock: [], ready: null, pendingOut: [], pendingMic: [] };
      ctx.__lab = lab;
      lab.ready = ctx.audioWorklet.addModule(WORKLET).then(() => {
        const mk = (sink) => {
          const n = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit', processorOptions: { channels: 1 } });
          n.port.onmessage = (e) => sink.push({ frame: e.data.frame, d: e.data.data[0] });
          const z = new GainNode(ctx, { gain: 0 });
          n.connect(z).connect(ctx.destination, ...[]);
          return n;
        };
        lab.outTap = mk(lab.out);
        lab.micTap = mk(lab.mic);
        for (const s of lab.pendingOut) origConnect.call(s, lab.outTap);
        for (const s of lab.pendingMic) origConnect.call(s, lab.micTap);
      });
      // Clock log: if the audio thread stalls, currentTime stops advancing while wall time goes on.
      lab.timer = setInterval(() => {
        if (ctx.state === 'closed') return clearInterval(lab.timer);
        lab.clock.push([Math.round(performance.now()), +ctx.currentTime.toFixed(4), ctx.state]);
      }, 50);
      lab.upload = setInterval(() => upload(ctx), 10000);
      post('/results', JSON.stringify({ kind: 'firefox-live-start', ua: navigator.userAgent, when: new Date().toISOString(), opts, sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency }));
    }
  };

  // Mirror every connection to the speaker into the out tap, and the mic source into the mic tap.
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = origConnect.call(this, dest, ...rest);
    const lab = this.context?.__lab;
    if (lab && dest === this.context.destination && !(this instanceof GainNode && this.gain.value === 0)) {
      if (lab.outTap) origConnect.call(this, lab.outTap); else lab.pendingOut.push(this);
    }
    return r;
  };
  const origMSS = AC.prototype.createMediaStreamSource;
  AC.prototype.createMediaStreamSource = function (stream) {
    const src = origMSS.call(this, stream);
    const lab = this.__lab;
    if (lab) { if (lab.micTap) origConnect.call(src, lab.micTap); else lab.pendingMic.push(src); }
    return src;
  };

  function join(chunks) {
    if (!chunks.length) return null;
    const first = chunks[0].frame, last = chunks.at(-1);
    const x = new Float32Array(last.frame + last.d.length - first);
    for (const c of chunks) x.set(c.d, c.frame - first);
    return { first, x };
  }

  async function upload(ctx) {
    const lab = ctx.__lab;
    const out = lab.out.splice(0), mic = lab.mic.splice(0), clock = lab.clock.splice(0);
    const n = seg++;
    const o = join(out), m = join(mic);
    const t = Math.round((Date.now() - T0) / 1000);
    if (o) await post(`/audio?name=ff-${String(n).padStart(3, '0')}-t${t}-out-f${o.first}&sr=${ctx.sampleRate}`, o.x.buffer);
    if (m) await post(`/audio?name=ff-${String(n).padStart(3, '0')}-t${t}-mic-f${m.first}&sr=${ctx.sampleRate}`, m.x.buffer);
    await post('/results', JSON.stringify({ kind: 'firefox-live-clock', seg: n, t, sampleRate: ctx.sampleRate, state: ctx.state, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency, clock }));
  }
})();
