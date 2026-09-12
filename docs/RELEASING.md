# Publishing: the website and the desktop apps

Written for someone new to GitHub. There are two things to publish, and both
are automated — you mostly just push.

| What | Where people get it | When it updates |
|---|---|---|
| **Web app** | `https://william-geary.github.io/card-centering-grader/` | Every push to `main` |
| **Desktop apps** (Windows, Mac) | The **Releases** page | When you push a version tag |

Both are built from the same code. The desktop app is the web app inside a
native window (that is what Tauri does), so a fix lands in both.

---

## One-time setup

Your repository already exists and Actions can write releases. Two more
settings:

### 1. Turn on GitHub Pages

1. Go to **https://github.com/william-geary/card-centering-grader/settings/pages**
   (repository → **Settings** → **Pages** in the left sidebar).
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. That's all — there is no Save button for this one.

The next push to `main` publishes the site. Watch it on the **Actions** tab: a
run called **website**. When it goes green, the site is live. The first deploy
can take a minute or two extra to appear.

### 2. Confirm Actions can publish releases

**Settings → Actions → General → Workflow permissions → Read and write
permissions → Save.** You did this already for the old app; it still applies.

---

## Publishing the website

Push to `main`. That's it.

```
git push origin main
```

Changes on other branches do not publish. Merge them into `main` first.

Phones that added the app to their home screen pick up the new version the
next time they open it with a connection.

## Publishing a desktop release

The version number lives in one place: `"version"` in `package.json`. The
desktop apps, the filenames and the About box all read it from there, and the
release workflow refuses to run if the tag does not match it.

`npm version` bumps it, commits, and creates the matching tag in one go:

```
npm version patch        # 2.0.0 -> 2.0.1   a fix
npm version minor        # 2.0.0 -> 2.1.0   a new feature
npm version major        # 2.0.0 -> 3.0.0   a big change
git push origin main --follow-tags
```

`--follow-tags` pushes the new tag along with the commit, and the tag is what
starts the **release** workflow. It builds on GitHub's own Windows and Mac
machines — about 10–15 minutes — then creates the release with these files:

| File | For |
|---|---|
| `CardCenteringGrader-2.0.1-windows-x64-setup.exe` | Windows, installed with a Start-menu shortcut |
| `CardCenteringGrader-2.0.1-windows-x64-portable.exe` | Windows, run without installing |
| `CardCenteringGrader-2.0.1-macos-universal.dmg` | Every Mac, Apple Silicon and Intel |

The release description comes from [`release-notes.md`](release-notes.md), so
edit that file if you want different text.

The link to send people never changes:

```
https://github.com/william-geary/card-centering-grader/releases/latest
```

### Trying a build without releasing

**Actions** tab → **release** → **Run workflow**. It builds both platforms and
puts the files under **Artifacts** at the bottom of the run page, but publishes
nothing. Good for checking a change before you give it a version number.

### If a release goes wrong

Delete it on the Releases page, delete the tag, fix things, and release again:

```
git tag -d v2.0.1
git push origin :refs/tags/v2.0.1
```

A release that existed for ten minutes is not history anyone will miss.

---

## What people will see the first time

The apps are not code-signed. Signing costs roughly $100–400 a year for
Windows and $99 a year for Apple's developer programme, which is rarely worth
it for a hobby tool — but it means both systems warn on first launch. The
release notes already walk people through it; mention it when you send the
link anyway.

**Windows** — "Windows protected your PC" → **More info** → **Run anyway**.

**Mac** — on macOS 15 (Sequoia) and later, double-clicking gives a dialog with
no way past it. They must click **Done**, then go to **System Settings →
Privacy & Security** and click **Open Anyway**. This is the step people give up
at, so say it explicitly. If macOS calls the app "damaged":

```
xattr -dr com.apple.quarantine "/Applications/Card Centering Grader.app"
```

The web version has none of this friction, which is a good reason to send
people there first.

---

## Working on the code

### The web app (any computer)

Needs [Node.js](https://nodejs.org/) 20 or newer.

```
git clone https://github.com/william-geary/card-centering-grader.git
cd card-centering-grader
npm install
npm run dev                # http://localhost:1420, reloads as you edit
```

Before pushing:

```
npm run typecheck
npm test                   # unit tests, and parity with the original Python app
npm run test:e2e           # drives the real app in a browser
```

On Windows the browser tests use the Edge that ships with Windows. Elsewhere,
run `npx playwright install chromium` once first.

### The desktop app on your own machine

Only needed to run or build the desktop version locally — the release workflow
builds it for you otherwise. Tauri needs Rust and your platform's build tools:

- **Mac:** `xcode-select --install`, then install Rust from
  [rustup.rs](https://rustup.rs/).
- **Windows:** the *Desktop development with C++* workload from
  [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/),
  then Rust from [rustup.rs](https://rustup.rs/).

Then:

```
npm run tauri dev          # the desktop app, reloading as you edit
npm run tauri build        # a real installer, in src-tauri/target/release/bundle/
```

The first Rust build takes several minutes; later ones are much faster.

---

## Keeping your email private

Every commit records an author email, and on a public repository that is
visible to anyone. This repository commits with GitHub's private address:

```
git config --local user.email      # 268057230+william-geary@users.noreply.github.com
```

With **Keep my email addresses private** and **Block command line pushes that
expose my email** ticked at [github.com/settings/emails](https://github.com/settings/emails),
GitHub refuses any push that would leak your real address, so a mistake gets
caught before it is public. To use the private address in every repository,
not just this one:

```
git config --global user.email "268057230+william-geary@users.noreply.github.com"
```
