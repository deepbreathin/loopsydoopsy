# Loopsy Doopsy

A colourful loop recorder for your phone. There are eight pads. Tap one and it counts you in, records for exactly the number of bars you chose, then starts looping in time with everything else. Each pad shows its sound as a **circular waveform**, with a playhead sweeping round it, so you can always see where the loop starts and how long it is.

<img src="docs/screenshot.png" height="420" alt="Loopsy Doopsy on a phone: eight coloured pads, two with circular waveforms"> <img src="docs/unfolded.png" height="420" alt="Unfolded on a OnePlus Open: a 3×3 grid with the Sing tile as the ninth square">

It's built for singing and humming: record a few vocal loops, then tap **Sing on top** to record yourself over the lot.

It's an **Android app** (built with [Capacitor](https://capacitorjs.com)), and it's laid out for foldables like the **OnePlus Open**: 2×4 pads on the cover screen, a 3×3 grid of large pads when unfolded, and pads kept clear of the fold when half-open. The same code also runs in a browser.

## Install on Android

Every push to GitHub builds an APK:

1. Open the repo on GitHub → **Actions** → **Android APK** → the latest run → download **loopsy-doopsy-apk** (a zip with `app-debug.apk` inside).
2. Open the APK on your phone and allow installing from that source when asked.
3. Allow the microphone the first time you record.

New builds install over the old one and keep your pads and recordings: they're all signed with the same key, `android/app/loopsy-debug.keystore`.

To build it yourself, you need Node 22, JDK 21 and the Android SDK (or Android Studio):

```sh
npm ci
npm run android:build      # → android/app/build/outputs/apk/debug/app-debug.apk
npx cap open android       # or open it in Android Studio and press Run
```

## Develop

The app is plain HTML/CSS/JS in `www/`, with no build step.

```sh
npm start              # browser version on http://localhost:5173
npm test               # unit tests: timing / DSP maths and the screen layouts
npm run test:e2e       # headless Chromium with a fake mic at phone, cover-screen and unfolded sizes
npm run android:sync   # copy www/ into the Android project after changing it
```

Browsers only allow the microphone on **https** or `localhost`. The Android app doesn't have that limitation.

## How it plays

| Do this | What happens |
| --- | --- |
| Tap an **empty pad** | Records a loop. If nothing is playing, it starts with a one-bar count-in (4·3·2·1 on the pad and clicks you can hear). If loops are already playing, recording starts on the next bar line. |
| Watch the **ring** while recording | It fills **red** as you record, with beat ticks round the edge. In the **last bar it turns white** and counts down "finish in 3·2·1", so you know when to stop. |
| Tap a pad **while it's recording** | Finishes at the next bar line instead, so the loop is shorter but still a whole number of bars. |
| Tap a **loop pad** | Switches it on or off. The change happens on the next bar (adjustable), so you can't come in off-beat. |
| Tap a **one-shot pad** | Plays the sound once, straight away, from the moment you touch it (Keezy style). Tap fast to stutter. |
| **Hold** a pad | Options: Loop / One-shot, volume, **Trim**, re-record, clear (with undo). |
| **▶ / ■** | Starts or stops the transport. Loops you've switched on resume together. |
| **Next loop: 1 · 2 · 4 · 8 bars** | Sets the length of the next recording. |
| **Sing on top** (the white tile) | One tap: starts the loops you've switched on and records them **plus your voice**. Tap again to stop and save. Its meter shows your mic level, so you can see quiet humming is getting through. |
| **Rec** (top bar) | Records the pads only. Turn on **Live** as well to add your voice, which is what Sing on top does in one tap. |
| **♫** | Your recorded jams: play them, share or save them as WAV, delete them (with undo). |
| **Tempo** (tap the bpm) | BPM, tap tempo, time signature, count-in, quantise, latency calibration and the rest of the settings. |

### Trim

Every recording also keeps half a bar from **before** you started and a bar from **after** you finished. The trim editor shows the whole take with the loop window highlighted over it:

- **Drag the window** to slide the loop earlier or later. It snaps to 1/16 notes, and the ‹ › buttons nudge it by 10 ms. If you came in a little early, or a little late, slide the window to fix it.
- **Overrun is cut off** automatically, so the loop always stays exactly the length you chose. If you'd rather keep a held note ringing across the seam, tick **"Wrap overrun into the start"** to fold the tail back onto the beginning of the loop, fading out.
- **Length**: choose 1, 2, 4 or 8 bars, or **Free** for a one-shot of any length. A free-length pad can't loop, because it wouldn't stay in time.
- Changes are heard live, from the next bar. **Cancel** puts everything back the way it was.

## Research & design notes

**Keezy** (Elepath, 2013) is the reference. It has eight coloured tiles, you record into a tile through the mic, tap to play, and press and hold to loop. Every tile is playable at once, you can save boards and share jams, and you can play one tile while recording into another, so the app can resample itself. People loved how immediate it was: there are no menus between you and the sound. ([TechCrunch](https://techcrunch.com/?p=913095), [Tinybop](https://tinybop.com/loves/apps/keezy), [App listing](https://apps.appfollow.io/ios/keezy-classic/605855595?country=us))

The **circular waveform** comes from the app in the reference screenshot. A loop *is* a circle, and a playhead sweeping round shows where you are in it. That app's problem was that the circle didn't show the loop's **length** or **where it starts**, so it was hard to come in and stop on time and get loops that line up. Loopsy Doopsy fixes this:

1. **Fixed, grid-locked lengths.** Tempo plus bar count sets the loop length before you record, and recording starts and stops on sample-exact bar lines. The audio is cut at exact frame numbers stamped by an AudioWorklet, not by a timer that might fire late. Every loop is a whole number of bars, so loops of different lengths (1, 2, 4, 8 bars) always line up.
2. **12 o'clock is always "1".** The big tick at the top marks the start of the loop, bar lines are medium ticks and beats are small ticks. You can read the loop's length and your position in it at a glance.
3. **Get-ready and wrap-up cues.** There's a count-in on the pad itself, beat lights in the top bar, a red progress ring while recording, and a white ring with a countdown for the last bar.
4. **Forgiving capture.** Pre-roll and overrun are recorded too, so small timing mistakes can be fixed in Trim instead of re-recorded.
5. **Latency compensation.** Phones add delay between the speaker and the mic. Without compensation every overdub drifts late, which loopers like Loopy Pro and Ableton have to deal with as well ([Loopy Pro request](https://roadmap.loopypro.com/feature-requests/p/latency-adjustmentcustom-track-offset-parameter), [Cycling '74 thread](https://cycling74.com/forums/time-accuracy-and-latency-compensation)). Loopsy Doopsy estimates the delay automatically, and **Settings → Calibrate** measures it properly: it plays clicks through the speaker and listens for them. Live-mic takes are shifted back by the same amount, so your riffing lines up with the pads in the saved file.
6. **Made for voice.** **Mic boost** (Settings) adds up to +12 dB for quiet humming. A limiter on the output stops stacked vocal loops from distorting. The mic's own processing (noise suppression, auto-gain) is switched off so loops keep their natural dynamics.
7. **Foldables.** The layout picks whichever arrangement gives the biggest pads on the current screen:

   | Screen | Layout |
   | --- | --- |
   | Cover screen / phone | 2×4 pads and a Sing strip |
   | Landscape phone | 4×2 pads and a Sing strip |
   | Unfolded (near-square) | 3×3 grid, with Sing as the ninth tile |
   | Half-open like a book | Four pads either side of the fold (when Chrome reports the hinge through the viewport-segments API) |

   Folding or unfolding doesn't restart the app, so a loop keeps playing across the change.
8. **Colourful, but readable.** The eight pads have distinct bright colours with dark ink on top. Empty pads are dimmed, pads with a sound are at full colour, and pads that are playing glow.

On Android the screen stays on while the app is open, the volume buttons control the music, and Back closes whatever sheet is open (or sends the app to the background, so it doesn't quit mid-jam).

**Headphones help a lot.** Without them, the mic picks up the loops coming out of the speaker. "Echo cancellation" in Settings reduces that, but it dulls the sound. Only turn on "Hear the mic through the app" when you're wearing headphones.

## Code map

```
www/                  the app (everything below lives in here)
android/              Capacitor Android project (MainActivity keeps the screen on, volume keys → music)
.github/workflows/    builds the APK on every push

index.html            layout + sheets (pad options, trim, settings, recordings)
css/style.css         styles; portrait 2×4 grid, landscape 4×2
js/main.js            UI wiring, gestures, persistence, render loop
js/engine.js          Web Audio: transport, metronome, recording, playback, session recorder, calibration
js/capture-worklet.js AudioWorklet that taps audio with frame-accurate timestamps
js/pad-view.js        canvas drawing of the circular pads
js/trim.js            trim editor
js/timing.js          pure maths (grid, loop cutting, peaks, onset detection, tap tempo) — unit-tested
js/layout.js          picks the pad grid for the screen / fold — unit-tested
js/native.js          Android bridges: back button, share sheet
js/storage.js         IndexedDB: pads + settings survive reloads; recorded takes
js/wav.js             WAV encoder
sw.js                 offline cache
```

## Ideas for next steps

- Several saved boards (Keezy-style), and bundled starter kits.
- Resampling: record a pad from the app's own output.
- Per-pad effects (pitch, filter, reverse) and a mixer view.
- Export the stems from a jam as well as the mixdown.
