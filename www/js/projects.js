// Projects: each one is a whole workspace (tempo and settings, the eight pads, the song).
// The open project saves itself a moment after anything changes.
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);

export class Projects {
  constructor({ engine, settings, defaults, getSong, setSong, toast, onSwitch }) {
    Object.assign(this, { engine, settings, defaults, getSong, setSong, toast, onSwitch });
    this.current = null; // { id, name }

    $('projectName').addEventListener('input', (e) => {
      this.current.name = e.target.value.trim() || 'Untitled';
      this.save();
    });
    $('newProject').onclick = () => this.create();
    $('dupProject').onclick = () => this.duplicate();
  }

  // Open the last project, or start the first one.
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

  async create() {
    await this.flush();
    const n = (await store.listProjects()).length + 1;
    await this.start(`Project ${n}`);
    this.toast('New project — the old one is saved');
    this.render();
  }

  async duplicate() {
    await this.flush();
    await this.start(`${this.current.name} copy`, this.snapshot());
    this.toast('Duplicated — you’re now in the copy');
    this.render();
  }

  async open(id) {
    if (id === this.current.id) return;
    await this.flush();
    const p = await store.loadProject(id);
    if (p) this.apply(p);
    this.render();
  }

  async remove(id, name) {
    if (!confirm(`Delete “${name}”? Its pads and song will be gone.`)) return;
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
    for (const p of await store.listProjects()) {
      const li = document.createElement('li');
      const here = p.id === this.current.id;
      li.className = here ? 'current' : '';
      li.innerHTML = `<div class="meta"><b></b><small>${p.padCount} pad${p.padCount === 1 ? '' : 's'} · ${new Date(p.updated).toLocaleDateString()}${here ? ' · open now' : ''}</small></div>
        ${here ? '' : '<button type="button" data-a="open" class="pill">Open</button><button type="button" data-a="del" aria-label="Delete">✕</button>'}`;
      li.querySelector('b').textContent = p.name;
      li.onclick = (e) => {
        const a = e.target.closest('button')?.dataset.a;
        if (a === 'del') this.remove(p.id, p.name);
        else if (!here) this.open(p.id);
      };
      list.append(li);
    }
  }
}
