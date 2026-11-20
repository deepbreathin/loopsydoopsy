# Offline bleed removal: estimate the speaker->mic response from (ref, mic) and subtract it.
import sys, glob, numpy as np
sr = 48000
mic = np.fromfile(sorted(glob.glob(f'*{sys.argv[1]}-mic.f32'))[-1], np.float32).astype(np.float64)
ref = np.fromfile(sorted(glob.glob(f'*{sys.argv[1]}-ref.f32'))[-1], np.float32).astype(np.float64)
n = min(len(mic), len(ref)); mic, ref = mic[:n], ref[:n]
db = lambda x: 10*np.log10(np.mean(x**2)+1e-20)
# delay by cross-correlation
N = 1 << int(np.ceil(np.log2(2*n)))
xc = np.fft.irfft(np.fft.rfft(mic, N) * np.conj(np.fft.rfft(ref, N)), N)
lag = int(np.argmax(np.abs(xc[:sr])))
print(f'mic {db(mic):.1f} dB, ref {db(ref):.1f} dB, delay {lag/sr*1000:.1f} ms')
def fit(m, r, L):
    # Wiener filter via Welch cross-spectra, segment 4L, FIR truncated to L taps after the delay
    seg = 4*L; w = np.hanning(seg); Smr = 0; Srr = 0
    for i in range(0, len(r)-seg, seg//4):
        R = np.fft.rfft(r[i:i+seg]*w); M = np.fft.rfft(m[i:i+seg]*w)
        Smr = Smr + M*np.conj(R); Srr = Srr + np.abs(R)**2
    h = np.fft.irfft(Smr/(Srr + 1e-9*Srr.max()), seg)[:L]
    return h
def apply(h, r):
    return np.convolve(r, h)[:len(r)]
half = n//2
for L in [1024, 2048, 4096]:
    # shift ref by the delay (minus a margin) so the FIR only needs L taps
    d = max(0, lag-128); r2 = np.concatenate([np.zeros(d), ref])[:n]
    h = fit(mic[:half], r2[:half], L)
    res = mic[half:] - apply(h, r2)[half:]
    print(f'L={L}: bleed {db(mic[half:]):.1f} dB -> after removal {db(res):.1f} dB  (held-out half; {db(mic[half:])-db(res):.1f} dB removed)')
