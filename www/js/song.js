// Song mode: plan which pads play in each section, then play it hands-free.

export const SECTION_BARS = [1, 2, 4, 8, 16];

// A starting arrangement from the pads you have: bring them in one at a time, play
// everything twice, strip back down, all back in, then end on the first pad.
// `pads` are { index, bars } for loop pads with a sound, in the order to bring them in.
export function buildUp(pads) {
  if (!pads.length) return [];
  const bars = Math.max(4, ...pads.map((p) => p.bars));
  const on = (list) => Array.from({ length: 8 }, (_, i) => list.some((p) => p.index === i));
  const sections = [];
  for (let n = 1; n <= pads.length; n++) sections.push({ bars, pads: on(pads.slice(0, n)) });
  sections.push({ bars, pads: on(pads) });
  if (pads.length > 2) {
    sections.push({ bars, pads: on(pads.slice(0, 2)) }); // breakdown
    sections.push({ bars, pads: on(pads) });
  }
  sections.push({ bars, pads: on(pads.slice(0, 1)) }); // outro
  return sections;
}

export const songBars = (sections) => sections.reduce((n, s) => n + s.bars, 0);

const $ = (id) => document.getElementById(id);

export class SongEditor {
  constructor({ engine, getSong, setSong, onPlay, onSing }) {
    Object.assign(this, { engine, getSong, setSong, onPlay, onSing });
    $('addSection').onclick = () => {
      const s = this.sections();
      const last = s.at(-1);
      this.commit([...s, last ? { bars: last.bars, pads: [...last.pads] } : { bars: 4, pads: this.loopPads().map(() => false) }]);
    };
    $('autoSong').onclick = () => {
      const s = buildUp(this.loopPadsInfo());
      if (!s.length) return;
      this.commit(s);
    };
    $('songPlay').onclick = () => {
      $('songSheet').close();
      this.onPlay();
    };
    $('songSing').onclick = () => {
      $('songSheet').close();
      this.onSing();
    };
    $('sectionList').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const row = Number(b.closest('li').dataset.row);
      const s = structuredClone(this.sections());
      const sec = s[row];
      if (b.dataset.pad != null) {
        const i = Number(b.dataset.pad);
        sec.pads[i] = !sec.pads[i];
      } else if (b.dataset.a === 'del') {
        s.splice(row, 1);
      } else if (b.dataset.a === 'bars') {
        const k = SECTION_BARS.indexOf(sec.bars);
        sec.bars = SECTION_BARS[(k + 1) % SECTION_BARS.length];
      }
      this.commit(s);
    });
  }

  sections() {
    return this.getSong()?.sections ?? [];
  }

  loopPads() {
    return this.engine.pads.filter((p) => p.hasSound && p.mode === 'loop');
  }

  loopPadsInfo() {
    return this.loopPads().map((p) => ({ index: p.index, bars: p.bars || 4 }));
  }

  commit(sections) {
    this.setSong({ sections });
    this.render();
  }

  open() {
    if (!this.sections().length && this.loopPads().length) this.commit(buildUp(this.loopPadsInfo()));
    this.render();
    $('songSheet').showModal();
  }

  render() {
    const list = $('sectionList');
    const s = this.sections();
    const pads = this.engine.pads;
    const pos = this.engine.songPosition();
    list.innerHTML = '';
    s.forEach((sec, row) => {
      const li = document.createElement('li');
      li.dataset.row = row;
      li.classList.toggle('now', pos?.index === row);
      const dots = pads
        .filter((p) => p.hasSound && p.mode === 'loop')
        .map((p) => `<button type="button" class="dot${sec.pads[p.index] ? ' on' : ''}" data-pad="${p.index}" style="--c: var(--p${p.index})" aria-label="Pad ${p.index + 1}">${p.index + 1}</button>`)
        .join('');
      li.innerHTML = `<span class="sec-n">${row + 1}</span>
        <button type="button" class="bars" data-a="bars" aria-label="Section length">${sec.bars}<small>bars</small></button>
        <span class="dots">${dots}</span>
        <button type="button" class="x" data-a="del" aria-label="Remove section">✕</button>`;
      list.append(li);
    });
    if (!s.length) {
      list.innerHTML = `<li class="empty">${this.loopPads().length ? 'Add a section to start your song.' : 'Record a loop or two first, then plan your song here.'}</li>`;
    }
    const total = songBars(s) * this.engine.bar;
    $('songInfo').textContent = s.length ? `${s.length} sections · ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}` : '';
    $('songPlay').disabled = $('songSing').disabled = !s.length;
    $('autoSong').disabled = !this.loopPads().length;
  }
}
