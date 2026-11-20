import sys, glob, numpy as np
def load(f): return np.fromfile(f, dtype=np.float32)
def describe(name, x, sr=48000):
    x = x[int(0.3*sr):]
    rms = 10*np.log10(np.mean(x**2)+1e-20)
    # Average power spectrum (Welch-ish)
    n = 4096; w = np.hanning(n); segs = [x[i:i+n]*w for i in range(0, len(x)-n, n//2)]
    P = np.mean([np.abs(np.fft.rfft(s))**2 for s in segs], axis=0); f = np.fft.rfftfreq(n, 1/sr)
    tot = P[(f>80)].sum()
    band = lambda a,b: 10*np.log10(P[(f>=a)&(f<b)].sum()/tot+1e-20)
    # highest frequency still within 50 dB of the spectral peak (smoothed)
    Ps = np.convolve(10*np.log10(P+1e-20), np.ones(9)/9, mode='same'); top = Ps[f>100].max()
    edge = f[np.where(Ps > top-50)[0].max()]
    print(f"{name[:52]:52s} rms {rms:6.1f} dB | 3-6k {band(3000,6000):6.1f} | 6-12k {band(6000,12000):6.1f} | 12k+ {band(12000,24000):6.1f} dB | edge {edge/1000:4.1f} kHz")
for pat in sys.argv[1:]:
    for fn in sorted(glob.glob(pat)): describe(fn.split('-',2)[2], load(fn))
