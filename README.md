# Loopsy Doopsy

A colourful loop recorder for your phone. There are eight pads. Tap one and it counts you in, records for exactly the number of bars you chose, then starts looping in time with everything else. Each pad shows its sound as a **circular waveform**, with a playhead sweeping round it, so you can always see where the loop starts and how long it is.

<img src="docs/screenshot.png" height="420" alt="Loopsy Doopsy on a phone: eight coloured pads, two with circular waveforms"> <img src="docs/unfolded.png" height="420" alt="Unfolded on a OnePlus Open: a 3×3 grid with the Sing tile as the ninth square">

It's built for singing and humming: record a few vocal loops, then tap **Sing on top** to record yourself over the lot.

It runs as an **installable web app (PWA)** on iPhone, iPad, Android and computers, and as an **Android app** (built with [Capacitor](https://capacitorjs.com)). It's laid out for foldables like the **OnePlus Open**: 2×4 pads on the cover screen, a 3×3 grid of large pads when unfolded, and pads kept clear of the fold when half-open. The same code also runs in a browser.

## Use it on iPhone, Android or a computer (web app)

Every push to the default branch publishes `www/` to **GitHub Pages**, at `https://<owner>.github.io/loopsydoopsy/`. Open that link, then:

- **iPhone / iPad:** Safari → Share → **Add to Home Screen**.
- **Android:** Chrome → ⋮ → **Install app**.
- **Computer:** Chrome or Edge → the install icon in the address bar (Safari on a Mac: File → Add to Dock). Keys: **1–8** tap the pads, **Space** plays/stops, **R** records.

The app's menu has an **Install the app** page with the same steps for whatever device you're on. Once installed it works offline.

**One-time setup:** in the repo, Settings → Pages → Build and deployment → Source: **GitHub Actions**. On a free GitHub plan the repo has to be public for Pages. If you'd rather keep it private, Cloudflare Pages (free) can host the same `www/` folder.

### What it costs to host

Nothing, and it can't run up a bill. The site is a folder of static files: there's no server, database or file storage behind it. Everyone's sounds stay on their own device (in the browser's storage), and people swap sounds by sending files through whatever they already use (WhatsApp, AirDrop, email, Drive). GitHub Pages is free and has no billing to go over: it has a soft limit of about 100 GB of traffic a month, and the whole app is under 1 MB.

## Install on Android (APK)

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
| Tap an **empty pad** | Records a loop after a **one-bar count-in**: a hand sweeps once round the pad, one tick per beat, and recording starts the moment it reaches the **red mark at the top** (silent unless you switch on beeps in Settings). With loops playing, the count-in lands on the next bar line, so it's never more than about a bar and a half. The new loop is turned to fit the loops already playing, so it still lines up with them however far round they were. |
| Watch the **ring** while recording | It fills **red** as you record, with beat ticks round the edge. In the **last bar it turns white** and counts down "finish in 3·2·1", so you know when to stop. |
| Tap a pad **while it's recording** | Finishes early, at the next 1, 2 or 4 bar mark, so it still lines up. |
| Tap a **loop pad** | Switches it on or off. A loop always starts **from its beginning**, timed to come in when the other loops come round; the pad says "in 3" while it waits. |
| Tap a **one-shot pad** | Plays the sound once, straight away (Keezy style). Tap fast to stutter. |
| **Hold** a pad | Options: Loop / One-shot, volume, **Trim**, re-record, clear (with undo), **Send this sound** (a WAV that remembers its tempo and length) and **Load a sound file**. Holding an empty pad lets you load a sound into it. |
| **▶ / ■** | Starts or stops everything. Loops you've switched on start together from the top. |
| **Next loop: 1 · 2 · 4 · 8 bars** | Sets the length of the next recording. |
| **● Rec** (top bar) | Records **just the pads**, with no mic and so no echo. Bring loops in and out while it runs, then tap Rec again to save the take. |
| **Sing on top** (the white tile) | Records the pads **plus your voice**. Tap again to stop and save. During a Rec take, tapping it adds your voice from that moment. It shows a live trace of your pitch, so you can see quiet humming is getting through. |
| **🎼 Song** | Plan your song: a list of sections, each a length and the pads that play in it. **Build it up for me** makes a starting arrangement. **Play** plays it hands-free, **Record** records the pads as they play, and **Record & sing** adds your voice; the take saves itself when the song ends. |
| **♫** | Your recorded takes: play them, share or save them as **MP3** (small, plays anywhere) or **WAV** (full quality), delete them (with undo). |
| **＋ New soundboard** | Asks whether to keep the current soundboard. **Save it** lets you name it, then you get a fresh, empty board. **Don't save** lets it go (with Undo). |
| **Soundboard name** (above the pads, tap it) | Your **Soundboards**: each keeps all eight pads' sounds, the tempo and the song, saved as you go. Open, rename or duplicate them; **Save sounds as WAV** shares every pad's sound as its own file; **Back up / send** makes one `.loopsy` file (all sounds and settings) to keep in Drive or send to another phone, and **Open a backup** brings it back. |
| **☰ Menu** | Soundboards, Song, **Looping basics**, and settings. |
| **Tempo** (tap the bpm) | BPM, tap tempo, time signature, count-in, mic boost, latency calibration and the rest of the settings. |

### Pitch strip

The slim strip on the right of each pad shows **pitch**: a dot that jumps up for high notes and down for low ones as the loop plays, leaving a short trail. On bigger screens it names the note too (A3, C4…). It works out each loop's melody when you record it, and follows the mic live while you record, so you can see where each layer sits and spread them out (low, middle, high).

### Trim

Every recording also keeps half a bar from **before** you started and a bar from **after** you finished. The trim editor shows the whole take with the loop window highlighted over it:

- **Drag the window** to slide the loop earlier or later. It snaps to 1/16 notes, and the ‹ › buttons nudge it by 10 ms. If you came in a little early, or a little late, slide the window to fix it.
- **Overrun is cut off** automatically, so the loop always stays exactly the length you chose. If you'd rather keep a held note ringing across the seam, tick **"Wrap overrun into the start"** to fold the tail back onto the beginning of the loop, fading out.
- **Length**: choose 1, 2, 4 or 8 bars, or **Free** for a one-shot of any length. A free-length pad can't loop, because it wouldn't stay in time.
- Changes are heard live, from the next bar. **Cancel** puts everything back the way it was.

### Making music with someone else

There's no account or server: you pass files back and forth.

- **A whole soundboard:** Soundboards → **Back up / send** makes one `.loopsy` file. Your friend opens it with **Open a backup**, adds their layers, and sends theirs back.
- **One sound:** hold a pad → **Send this sound**. It's an ordinary WAV, with the tempo and length tucked inside it. Loaded onto a pad (hold an empty pad → **Load a sound file**), it lands on the grid as a loop of the right length; an empty soundboard takes on its tempo. Voice memos, MP3s and other audio load too: as a loop if they're a whole 1, 2, 4 or 8 bars at your tempo, otherwise as a one-shot you can trim.

## Research & design notes

**Keezy** (Elepath, 2013) is the reference. It has eight coloured tiles, you record into a tile through the mic, tap to play, and press and hold to loop. Every tile is playable at once, you can save boards and share jams, and you can play one tile while recording into another, so the app can resample itself. People loved how immediate it was: there are no menus between you and the sound. ([TechCrunch](https://techcrunch.com/?p=913095), [Tinybop](https://tinybop.com/loves/apps/keezy), [App listing](https://apps.appfollow.io/ios/keezy-classic/605855595?country=us))

The **circular waveform** comes from the app in the reference screenshot. A loop *is* a circle, and a playhead sweeping round shows where you are in it. That app's problem was that the circle didn't show the loop's **length** or **where it starts**, so it was hard to come in and stop on time and get loops that line up. Loopsy Doopsy fixes this:

1. **Fixed, grid-locked lengths.** Tempo plus bar count sets the loop length before you record, and recording starts and stops on sample-exact bar lines. The audio is cut at exact frame numbers stamped by an AudioWorklet, not by a timer that might fire late. Every loop is a whole number of bars, so loops of different lengths (1, 2, 4, 8 bars) always line up.
2. **12 o'clock is always "1".** The big tick at the top marks the start of the loop, bar lines are medium ticks and beats are small ticks. You can read the loop's length and your position in it at a glance.
3. **Get-ready and wrap-up cues.** A one-bar count-in on the pad itself, drawn as a hand sweeping round to a red mark at the top so you can see exactly when to come in, beat lights in the top bar, a red progress ring while recording, and a white ring with a countdown for the last bar. Optional count-in beeps always stop before the downbeat, so they never end up in a take; there's no metronome to leak into recordings.
4. **Everything starts from the top.** A loop never comes in halfway through. It waits for the loops already playing to come round, then plays from its first beat. New recordings start on any bar line after a one-bar count-in; if that's partway through the loop cycle, the take is turned round (by whole bars) so its own beginning sits at the top of the cycle, and layers still line up the way you heard them.
5. **Forgiving capture.** Pre-roll and overrun are recorded too, so small timing mistakes can be fixed in Trim instead of re-recorded.
6. **Latency compensation.** Phones add delay between the speaker and the mic. Without compensation every overdub drifts late, which loopers like Loopy Pro and Ableton have to deal with as well ([Loopy Pro request](https://roadmap.loopypro.com/feature-requests/p/latency-adjustmentcustom-track-offset-parameter), [Cycling '74 thread](https://cycling74.com/forums/time-accuracy-and-latency-compensation)). Loopsy Doopsy estimates the delay automatically, and **Settings → Calibrate** measures it properly: it plays clicks through the speaker and listens for them. Live-mic takes are shifted back by the same amount, so your riffing lines up with the pads in the saved file.
7. **Made for voice.** **Mic boost** (Settings) adds up to +12 dB for quiet humming. A limiter on the output stops stacked vocal loops from distorting. The mic's own processing (noise suppression, auto-gain) is switched off so loops keep their natural dynamics.
8. **Foldables.** The layout picks whichever arrangement gives the biggest pads on the current screen:

   | Screen | Layout |
   | --- | --- |
   | Cover screen / phone | 2×4 pads and a Sing strip |
   | Landscape phone | 4×2 pads and a Sing strip |
   | Unfolded (near-square) | 3×3 grid, with Sing as the ninth tile |
   | Half-open like a book | Four pads either side of the fold (when Chrome reports the hinge through the viewport-segments API) |

   Folding or unfolding doesn't restart the app, so a loop keeps playing across the change.
9. **Colourful, but readable.** The eight pads have distinct bright colours with dark ink on top. Empty pads are dimmed, pads with a sound are at full colour, and pads that are playing glow.

On Android the screen stays on while the app is open, the volume buttons control the music, and Back closes whatever sheet is open (or sends the app to the background, so it doesn't quit mid-jam).

**Headphones help a lot.** Without them, the mic picks up the loops coming out of the speaker. "Echo cancellation" in Settings reduces that, but it dulls the sound. Only turn on "Hear the mic through the app" when you're wearing headphones.

## Code map

```
www/                  the app (everything below lives in here)
android/              Capacitor Android project (MainActivity keeps the screen on, volume keys → music)
.github/workflows/    builds the APK on every push

index.html            layout + sheets (pad options, trim, settings, recordings, projects, song, looping basics)
css/style.css         styles; portrait 2×4 grid, landscape 4×2
js/main.js            UI wiring, gestures, render loop
js/engine.js          Web Audio: transport, count-in, recording, playback, song playback, session recorder, calibration
js/capture-worklet.js AudioWorklet that taps audio with frame-accurate timestamps
js/pad-view.js        canvas drawing of the circular pads
js/trim.js            trim editor
js/timing.js          pure maths (grid, loop cutting, peaks, onset detection, tap tempo) — unit-tested
js/layout.js          picks the pad grid for the screen / fold — unit-tested
js/native.js          Android bridges: back button, share sheet
js/pitch.js           voice pitch detection (YIN) and pitch contours — unit-tested
js/projects.js        soundboards: save / open / new / duplicate / backup, autosave
js/boardfile.js       the .loopsy backup file format — unit-tested
js/song.js            song editor and the "build it up" arrangement — unit-tested
js/storage.js         IndexedDB: projects and recorded takes
js/wav.js             WAV encoder, plus the tempo/length tag on sent pad sounds — unit-tested
js/audio-files.js     MP3 export (via a worker) and reading audio files onto pads
js/mp3-worker.js      MP3 encoding off the main thread (vendor/lame.min.js, LGPL)
sw.js                 offline cache
```

## Ideas for next steps

- Bundled starter kits.
- Resampling: record a pad from the app's own output.
- Per-pad effects (pitch, filter, reverse) and a mixer view.
- Export the stems from a jam as well as the mixdown.
