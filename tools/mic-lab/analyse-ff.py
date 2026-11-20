# Summarise one uploaded Firefox segment: digital output glitches, mic glitches, audio-clock stalls.
import sys, glob, json, re, numpy as np
R = 'results/'
sr = 48000
def load(kind, n):
    f = sorted(glob.glob(f'{R}*ff-{n:03d}-*-{kind}-f*.f32'))
    if not f: return None, None
    return np.fromfile(f[-1], np.float32).astype(float), int(re.search(r'-f(\d+)\.f32', f[-1]).group(1))
def glitches(x):
    # digital clicks: 2nd difference far above what the local signal level allows
    if x is None or len(x) < sr // 10: return {}
    d2 = np.abs(np.diff(x, 2))
    w = int(0.02 * sr)
    env = np.sqrt(np.convolve(x**2, np.ones(w) / w, mode='same'))[1:-1] + 1e-4
    ratio = d2 / env
    hits = np.where(ratio > 1.2)[0]
    t = []; last = -sr
    for h in hits:
        if h - last > 0.01 * sr: t.append(round(h / sr, 3))
        last = h
    z = (x == 0).astype(np.int8); dz = np.diff(np.concatenate([[0], z, [0]])); s = np.where(dz == 1)[0]; e = np.where(dz == -1)[0]
    loud = [(a, b) for a, b in zip(s, e) if b - a >= 24 and a > 0 and b < len(x) and (abs(x[a - 1]) > 0.01 or abs(x[b]) > 0.01)]
    return {'sec': round(len(x) / sr, 1), 'peak': round(float(np.abs(x).max()), 3), 'rmsDb': round(10 * np.log10(np.mean(x**2) + 1e-20), 1),
            'clicks': len(t), 'clickAt': t[:8], 'gapsMidSound': len(loud)}
n = int(sys.argv[1])
out, fo = load('out', n); mic, fm = load('mic', n)
clock = None
for f in sorted(glob.glob(R + '*.json'))[-40:]:
    try: d = json.load(open(f))
    except Exception: continue
    if d.get('kind') == 'firefox-live-clock' and d.get('seg') == n: clock = d
st = {}
if clock and clock['clock']:
    c = np.array([[a, b] for a, b, _ in clock['clock']], float)
    dw = np.diff(c[:, 0]) / 1000; dc = np.diff(c[:, 1])
    st = {'stalls>80ms': int(np.sum((dc == 0) & (dw > 0.08))), 'audioVsWall': round(float((c[-1, 1] - c[0, 1]) / ((c[-1, 0] - c[0, 0]) / 1000 + 1e-9)), 3),
          'maxStuckMs': int(max([0] + [sum(dw[i:j]) * 1000 for i, j in []])), 'state': clock['state'], 'base': clock.get('baseLatency'), 'outLat': clock.get('outputLatency')}
    # longest run where the audio clock did not move
    run = best = 0.0
    for a, b in zip(dw, dc):
        run = run + a if b == 0 else 0.0; best = max(best, run)
    st['maxStuckMs'] = int(best * 1000)
print(f'seg {n} (t≈{clock["t"] if clock else "?"}s) OUT {glitches(out)} | MIC {glitches(mic)} | CLOCK {st}', flush=True)
