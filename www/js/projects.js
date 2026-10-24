// Soundboards: each one is a whole workspace (tempo and settings, the eight pads' sounds,
// the song). The open one saves itself a moment after anything changes. Internally these
// are "projects" in storage.
import * as store from './storage.js';
import { decodeBoard, encodeBoard } from './boardfile.js';
import { encodeWav } from './wav.js';

const $ = (id) => document.getElementById(id);
const fileName = (s) => s.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'soundboard';

export class Projects {
  constructor({ engine, settings, defaults, getSong, setSong, toast, onSwitch, share }) {
    Object.assign(this, { engine, settings, defaults, getSong, setSong, toast, onSwitch, share });
    this.current = null; // { id, name }

    $('projectName').addEventListener('input', (e) => {
      this.current.name = e.target.value.trim() || 'Untitled';
      this.onSwitch?.();
      this.save();
    });
    $('dupProject').onclick = () => this.duplicate();
    $('exportWavs').onclick = () => this.exportWavs();
    $('exportBoard').onclick = () => this.exportBoard();
    $('importBoard').onclick = () => $('importFile').click();
    $('importFile').onchange = (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) this.importBoard(f);
    };
    this.bindNewFlow();
  }

  // Open the last soundboard, or start the first one.
  async boot() {
    try {
      const id = await store.getCurrentId();
      const p = id && (await store.loadProject(id));
      if (p) return this.apply(p);
    } catch (e) {
      console.warn('load failed', e);
    }
    await this.start('My loops');
  }

  soundCount() {
    return this.engine.pads.filter((p) => p.state === 'ready' && p.raw).length;
  }

  snapshot() {
    const e = this.engine;
    return {
      ...this.current,
      updated: Date.now(),
      settings: { ...this.settings, liveMic: false },
      pads: e.pads.map((p) => (p.state === 'ready' && p.raw ? e.snapshot(p) : null)),
      song: this.getSong(),
    };
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  async flush() {
    clearTimeout(this.timer);
    if (!this.current) return;
    try {
      await store.saveProject(this.snapshot());
    } catch (e) {
      console.warn('save failed', e);
    }
  }

  // Save the open soundboard before moving to another — or, if it never got any sounds,
  // drop it so empty boards don't pile up in the list.
  async leave() {
    if (!this.current) return;
    if (!this.soundCount() && !this.getSong()?.sections?.length) {
      clearTimeout(this.timer);
      await store.deleteProject(this.current.id);
    } else {
      await this.flush();
    }
  }

  apply(p) {
    const e = this.engine;
    e.stopTransport();
    Object.assign(this.settings, this.defaults, p.settings, { liveMic: false });
    e.pads.forEach((pad, i) => {
      const s = p.pads?.[i];
      if (s) return e.restore(pad, s);
      e.clear(pad);
      pad.mode = 'loop';
      e.setVolume(pad, 0.9);
    });
    this.setSong(p.song);
    this.current = { id: p.id, name: p.name };
    store.setCurrentId(p.id);
    this.onSwitch?.();
  }

  async start(name, from = null) {
    const id = Date.now();
    const p = from ? { ...from, id, name } : { id, name, settings: { ...this.settings }, pads: [], song: null };
    await store.saveProject({ ...p, updated: id });
    this.apply(p);
  }

  async nextName() {
    const names = new Set((await store.listProjects()).map((p) => p.name));
    let n = names.size + 1;
    while (names.has(`Soundboard ${n}`)) n++;
    return `Soundboard ${n}`;
  }

  // ---------- "New soundboard": save this one (and name it) or let it go, then start fresh ----------

  bindNewFlow() {
    const step = (name) => {
      for (const s of $('newSheet').querySelectorAll('[data-step]')) s.hidden = s.dataset.step !== name;
    };
    this.newStep = step;
    $('newSave').onclick = () => {
      step('name');
      $('newName').value = this.current.name;
      $('newName').select();
    };
    $('newNameBack').onclick = () => step('ask');
    $('newCancel').onclick = () => $('newSheet').close();
    $('newNameSave').onclick = async () => {
      this.current.name = $('newName').value.trim() || this.current.name;
      await this.flush();
      const saved = this.current.name;
      $('newSheet').close();
      await this.start(await this.nextName());
      this.toast(`Saved “${saved}” — here’s a fresh soundboard`);
    };
    $('newDiscard').onclick = async () => {
      await this.flush();
      const old = this.snapshot();
      $('newSheet').close();
      await store.deleteProject(old.id);
      await this.start(await this.nextName());
      this.toast(`Let “${old.name}” go — fresh soundboard`, 'Undo', async () => {
        await this.leave();
        await store.saveProject(old);
        this.apply(old);
      });
    };
  }

  async newSoundboard() {
    const n = this.soundCount();
    if (!n) {
      // Nothing to keep: just make sure it's a clean slate.
      await this.flush();
      this.toast('This soundboard is already empty — tap a pad to record');
      return;
    }
    $('newAskText').textContent = `“${this.current.name}” has ${n} sound${n === 1 ? '' : 's'}. Do you want to keep it? You can open it again any time from Soundboards.`;
    this.newStep('ask');
    $('newSheet').showModal();
  }

  // ---------- list ----------

  async duplicate() {
    await this.flush();
    await this.start(`${this.current.name} copy`, this.snapshot());
    this.toast('Duplicated — you’re now in the copy');
    this.render();
  }

  async open(id) {
    if (id === this.current.id) return;
    await this.leave();
    const p = await store.loadProject(id);
    if (p) this.apply(p);
    this.render();
  }

  async remove(id, name) {
    if (!confirm(`Delete “${name}”? Its sounds and song will be gone.`)) return;
    await store.deleteProject(id);
    this.render();
  }

  async show() {
    await this.flush();
    await this.render();
    $('projectsSheet').showModal();
  }

  async render() {
    $('projectName').value = this.current.name;
    const list = $('projectList');
    list.innerHTML = '';
    const all = await store.listProjects();
    all.sort((a, b) => (b.id === this.current.id) - (a.id === this.current.id)); // open one first
    for (const p of all) {
      const li = document.createElement('li');
      const here = p.id === this.current.id;
      li.className = here ? 'current' : '';
      li.innerHTML = `<div class="meta"><b></b><small>${p.padCount} sound${p.padCount === 1 ? '' : 's'} · ${new Date(p.updated).toLocaleDateString()}${here ? ' · open now' : ''}</small></div>
        ${here ? '' : '<button type="button" data-a="open" class="pill">Open</button><button type="button" data-a="del" aria-label="Delete">✕</button>'}`;
      li.querySelector('b').textContent = p.name;
      li.onclick = (e) => {
        const a = e.target.closest('button')?.dataset.a;
        if (a === 'del') this.remove(p.id, p.name);
        else if (!here) this.open(p.id);
      };
      list.append(li);
    }
    const has = this.soundCount() > 0;
    $('exportWavs').disabled = $('exportBoard').disabled = !has;
  }

  // ---------- files ----------

  // Every pad's sound as its own WAV, exactly as it loops (trimmed).
  async exportWavs() {
    const base = fileName(this.current.name);
    const files = this.engine.pads
      .filter((p) => p.hasSound)
      .map((p) => ({ blob: encodeWav(p.buffer.getChannelData(0), p.buffer.sampleRate), name: `${base}-pad${p.index + 1}.wav` }));
    if (files.length) await this.share(files, `${this.current.name} — sounds`);
  }

  // The whole soundboard in one file you can keep anywhere and open again.
  async exportBoard() {
    await this.flush();
    const blob = await encodeBoard(this.snapshot());
    await this.share([{ blob, name: `${fileName(this.current.name)}.loopsy` }], this.current.name);
  }

  async importBoard(file) {
    try {
      const b = await decodeBoard(file);
      await this.leave();
      await this.start(b.name || file.name.replace(/\.loopsy$/, ''), { settings: b.settings, song: b.song, pads: b.pads });
      this.toast(`Opened “${this.current.name}”`);
      this.render();
    } catch (e) {
      console.warn(e);
      this.toast('That file isn’t a Loopsy Doopsy soundboard');
    }
  }
}
