# Mic lab

On-device audio tests for Loopsy, used to track down phone recording problems (November 2026, OnePlus Open, Vivaldi/Chromium 156 and Firefox 160).

## Running

```bash
python3 tools/mic-lab/serve.py 8222
```

```bash
adb reverse tcp:8222 tcp:8222
```

The phone then opens `http://localhost:8222/...`, which counts as secure, so the mic works. Results and recordings land in `tools/mic-lab/results/` (git-ignored).

Chromium browsers can be driven over DevTools. Run `adb forward tcp:9333 localabstract:chrome_devtools_remote`, then use `drive.mjs`, `run-page.mjs`, `eval.mjs` or `listen.mjs`. Firefox can't be driven that way, so its pages start themselves (`?auto=1`), and you tap Allow by hand or with `adb shell input tap`.

**Ask before running anything that plays sound.** The tone tests play through the phone speaker at its media volume.

## Pages

| Page | What it checks |
|---|---|
| `lab.html` | Silent gaps, splices (`tone=1`) and levels for each AudioContext set-up |
| `sing.html` | Records a person singing through Loopsy's path and directly, side by side |
| `bleed.html`, `app-bleed.html` | Loops leaking from the speaker into a new take, with echo cancel on and off |
| `clock.html` | Whether the audio clock keeps up with real time |
| `tone.html` | MediaRecorder splices with and without a Web Audio engine running |
| `reporter.js` | Injected into a copy of the app: records what goes to the speaker and what comes from the mic |

## What we found

1. **Speaker bleed.** On a phone, a new layer picked up the playing loops 11 dB louder than the singer, and clipped. Echo cancellation removes it in Chromium: −11.5 dB became −57 dB. It's now on by default on phones (a setting per device).
2. **Firefox's echo cancellation does nothing** for Web Audio playback, because the speaker-to-mic delay wanders by tens of milliseconds. Loops are turned down 12 dB while a take records instead.
3. **Firefox on Android splices the mic audio.** It drops small pieces and joins the ends, so recordings crackle. It happens worse while a Web Audio engine runs, and in every capture route tried (worklet, MediaRecorder, all latency hints, all constraints). Loopsy shows a note recommending Chrome.
4. **Chromium takes are clean**: no clipping or gaps, and playback has about one 21 ms dropout per minute.
