## Two ways to use it

**In your browser — nothing to install.** Works on Windows, Mac, iPhone, iPad
and Android:

**https://william-geary.github.io/card-centering-grader/**

On a phone you can add it to your home screen and it then opens like an app
and works offline — on iPhone: Share → *Add to Home Screen*; on Android: the
browser menu → *Install app*.

**As a desktop app** — download from **Assets** below:

| Your computer | File |
|---|---|
| Windows 10 or 11 — installs with a Start-menu shortcut | `CardCenteringGrader-…-windows-x64-setup.exe` |
| Windows 10 or 11 — no install, just run it | `CardCenteringGrader-…-windows-x64-portable.exe` |
| Any Mac, Apple Silicon or Intel | `CardCenteringGrader-…-macos-universal.dmg` |

Your images never leave your device in either version.

### Windows

Run the setup file, or put the portable one anywhere and double-click it. No
administrator rights needed.

The first time, Windows may show **"Windows protected your PC"**. That appears
for any program without a paid code-signing certificate: click **More info**,
then **Run anyway**.

The portable version relies on Microsoft Edge WebView2, which Windows 11 and
up-to-date Windows 10 already have. If it won't start, use the setup file,
which installs WebView2 if it is missing.

### Mac

1. Open the `.dmg` and drag **Card Centering Grader** into **Applications**.
2. Open it. macOS will say it cannot verify the app — click **Done**
   (not *Move to Bin*).
3. Open **System Settings → Privacy & Security**, scroll down, and click
   **Open Anyway** next to Card Centering Grader. Confirm with your password.

You only do this once. It happens because the app is not notarised by Apple,
which needs a paid developer account. (On macOS 14 and earlier, right-click the
app → **Open** also works; macOS 15 removed that shortcut.)

If macOS says the app **"is damaged"**, open Terminal and run:

```
xattr -dr com.apple.quarantine "/Applications/Card Centering Grader.app"
```

## Using it

Open the front of a card, place the eight lines, then switch to **Back** and do
the same. You get Left/Right and Top/Bottom centering live, plus the best grade
the centering allows for PSA, BGS and CGC. Photographed a card with your phone?
On a phone, **Take a photo** goes straight to the **Deskew** stage for that.

Full guide: the [README](https://github.com/william-geary/card-centering-grader#readme).

Centering only — corners, edges and surface are not assessed, so treat the
grade as a ceiling and a sanity check, not a prediction. Not affiliated with
PSA, Beckett or CGC.
