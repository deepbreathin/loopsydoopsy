// Picks the pad arrangement that gives the biggest circles for the screen we're on:
//  - narrow phone / folded cover screen  → 2×4 pads with a "Sing" strip underneath
//  - landscape phone                      → 4×2 pads with the strip underneath
//  - near-square unfolded inner screen    → 3×3, with the Sing tile as the ninth square
//  - half-open like a book (hinge reported) → 2×2 pads either side of the fold
// Pure function so it can be unit-tested; `apply` writes the result into the DOM.

export const STRIP = 64; // height of the Sing strip when it isn't a full tile

// w, h: grid area in CSS px. gap: grid gap. hinge: { start, end } along x (book posture)
// or null. Returns { cols, rows, template, areas } where areas[i] is a CSS grid-area for
// pad i (0-7) and areas[8] for the Sing tile.
export function chooseLayout(w, h, gap, hinge = null) {
  if (hinge && hinge.end > hinge.start - 1 && hinge.start > w * 0.25 && hinge.end < w * 0.75) {
    return hingeLayout(w, h, gap, hinge);
  }
  const candidates = [
    { cols: 2, rows: 4, strip: true },
    { cols: 4, rows: 2, strip: true },
    { cols: 3, rows: 3, strip: false },
  ];
  let best = null;
  for (const c of candidates) {
    const ph = c.strip ? h - STRIP - gap : h;
    const cw = (w - gap * (c.cols - 1)) / c.cols;
    const ch = (ph - gap * (c.rows - 1)) / c.rows;
    const size = Math.min(cw, ch);
    // Ties go to the earlier candidate; the 3×3 must clearly win since it shrinks the strip
    // into a square.
    const score = c.strip ? size : size * 0.97;
    if (!best || score > best.score) best = { ...c, score, size };
  }
  const { cols, rows, strip } = best;
  const areas = [];
  for (let i = 0; i < 8; i++) areas.push(`${Math.floor(i / cols) + 1} / ${(i % cols) + 1}`);
  areas.push(strip ? `${rows + 1} / 1 / ${rows + 2} / ${cols + 1}` : `3 / 3`);
  return {
    kind: strip ? `${cols}x${rows}` : '3x3',
    columns: `repeat(${cols}, minmax(0, 1fr))`,
    rows: strip ? `repeat(${rows}, minmax(0, 1fr)) ${STRIP}px` : `repeat(3, minmax(0, 1fr))`,
    areas,
    size: best.size,
  };
}

// Book posture: tracks [pad pad | hinge | pad pad], strip under the left pair.
function hingeLayout(w, h, gap, { start, end }) {
  const left = start - gap; // keep a gap's breathing room either side of the fold
  const right = w - end - gap;
  const cl = Math.max(40, (left - gap) / 2);
  const cr = Math.max(40, (right - gap) / 2);
  const hw = Math.max(0, end - start);
  const areas = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? 0 : 3; // pads 1-4 left of the fold, 5-8 right
    const k = i % 4;
    areas.push(`${Math.floor(k / 2) + 1} / ${side + (k % 2) + 1}`);
  }
  areas.push(`3 / 1 / 4 / 3`);
  return {
    kind: 'hinge',
    columns: `${cl}px ${cl}px ${hw}px ${cr}px ${cr}px`,
    rows: `repeat(2, minmax(0, 1fr)) ${STRIP}px`,
    areas,
    size: Math.min(cl, (h - STRIP - gap * 2) / 2),
  };
}

// The fold, in the grid's coordinates, when the browser exposes viewport segments
// (Chrome on Android foldables). Only side-by-side segments (book posture) are used.
export function hingeFor(gridRect) {
  const segs = window.viewport?.segments;
  if (!segs || segs.length !== 2) return null;
  const [a, b] = [...segs].sort((p, q) => p.left - q.left);
  if (Math.abs(a.top - b.top) > 2 || b.left < a.right - 1) return null;
  return { start: a.right - gridRect.left, end: b.left - gridRect.left };
}

export function apply(grid, tiles) {
  const r = grid.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(grid).rowGap) || 10;
  const l = chooseLayout(r.width, r.height, gap, hingeFor(r));
  grid.style.gridTemplateColumns = l.columns;
  grid.style.gridTemplateRows = l.rows;
  grid.dataset.layout = l.kind;
  tiles.forEach((el, i) => (el.style.gridArea = l.areas[i]));
  return l;
}
