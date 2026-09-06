## Download

Pick the file for your machine, from **Assets** below.

| Your machine | File |
|---|---|
| Windows 10 or 11 | `CardCenteringGrader-…-windows-x86_64.exe` |
| Mac with Apple Silicon (M1/M2/M3/M4) | `CardCenteringGrader-…-macos-arm64.zip` |
| Mac with an Intel processor | `CardCenteringGrader-…-macos-x86_64.zip` |

Not sure which Mac you have?  → About This Mac. "Chip: Apple M…" means Apple
Silicon; "Processor: Intel…" means Intel.

Nothing to install. You do not need Python.

### Windows

Download the `.exe`, put it anywhere, double-click it.

The first time, Windows may show **"Windows protected your PC"**. That appears
for any program without a paid code-signing certificate. Click **More info**,
then **Run anyway**.

### macOS

1. Download the `.zip` and double-click it to unpack `CardCenteringGrader.app`.
2. Drag the app to your Applications folder.
3. **Right-click the app and choose Open**, then click **Open** in the dialog.

That third step matters. Double-clicking an app downloaded from the internet
that has not been notarised by Apple gets you *"Apple could not verify …is free
of malware"* with no obvious way past it. Right-click → Open is the way to
approve it, and you only do it once.

On newer macOS you may instead need: System Settings → Privacy & Security →
scroll down → **Open Anyway**.

If it still refuses, open Terminal and run:

```
xattr -d com.apple.quarantine /Applications/CardCenteringGrader.app
```

The first launch takes a few seconds while the app unpacks itself. Later
launches are quick.

## Using it

Open the front of a card, straighten it, place the eight lines, then switch to
**Back** and do the same. The panel shows Left/Right and Top/Bottom centering
live, plus the best grade the centering allows for PSA, BGS and CGC.

Full instructions: see the [README](https://github.com/william-geary/card-centering-grader#readme).

Centering only — corners, edges and surface are not assessed, so treat the
grade as a ceiling and a sanity check, not a prediction. Not affiliated with
PSA, Beckett or CGC.
