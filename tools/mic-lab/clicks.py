# Count crackle clicks: short bursts of >6 kHz energy far above the local background.
import sys, glob, numpy as np
sr = 48000
def clicks(x):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1/sr); X[f < 6000] = 0; hp = np.fft.irfft(X, len(x))
    w = int(0.002*sr); e = np.sqrt(np.convolve(hp**2, np.ones(w)/w, mode='same'))
    bg = np.median(e) + 1e-9
    # local background (100 ms median) to avoid counting sibilants as clicks
    k = int(0.1*sr); step = w
    idx = np.arange(0, len(e), step); ev = e[idx]
    loc = np.array([np.median(ev[max(0,i-50):i+50]) for i in range(len(ev))]) + 1e-9
    hits = np.where(ev > 8*loc)[0]
    # merge hits closer than 10 ms
    t = []; last = -1e9
    for h in hits:
        if h*step - last > 0.01*sr: t.append(h*step/sr)
        last = h*step
    return t, 20*np.log10(bg)
for pat in sys.argv[1:]:
    for fn in sorted(glob.glob(pat)):
        x = np.fromfile(fn, np.float32).astype(float)[int(0.3*sr):]
        t, bg = clicks(x)
        print(f"{fn.split('-',2)[2][:42]:42s} {len(x)/sr:5.1f}s  clicks {len(t):3d} ({len(t)/(len(x)/sr):.1f}/s)  at {' '.join(f'{v:.2f}' for v in t[:12])}")
