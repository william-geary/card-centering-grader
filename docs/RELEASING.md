# Publishing a version, and what a GitHub release actually is

Written for someone who has not done this before.

## The idea

Your repository holds **source code** — text files, small, versioned, diffed.
It should not hold the 31 MB `.exe`, because git keeps every version of every
file forever: ten releases would mean 310 MB of binaries in the history of
anyone who clones it, and you cannot easily take them out again.

A **release** is GitHub's answer to that. It is three things bundled together:

1. **A tag** — a permanent bookmark on one commit, named like `v1.0.0`. It says
   "this exact state of the code is what I shipped."
2. **Notes** — the text people read on the release page.
3. **Assets** — files you attach. These live outside the git history, so they
   cost your repo nothing. This is where the `.exe` and the Mac `.zip` go.

Each release gets its own page with a permanent link. That link is what you
send people:

```
https://github.com/william-geary/card-centering-grader/releases/latest
```

They land on a page, see the download list, pick their file. They never see
git, never install Python, never clone anything.

## The catch that shapes everything else

**PyInstaller cannot cross-compile.** A Windows `.exe` has to be built on
Windows; a Mac `.app` has to be built on a Mac. And Mac builds are specific to
the processor family — an app built on an Apple Silicon Mac will not start on
an Intel one.

So "offer both versions" means producing three files:

| File | Built on |
|---|---|
| `…-windows-x86_64.exe` | Windows |
| `…-macos-arm64.zip` | Apple Silicon Mac |
| `…-macos-x86_64.zip` | Intel Mac |

You own two of those machines at most. That is what the automated route below
is for.

---

## Route A — let GitHub build all three (recommended)

`.github/workflows/release.yml` builds every platform on GitHub's own machines
and attaches the results to the release. You never touch a Mac to publish a Mac
build.

### One-time setup

You only do this once, and the order matters: **the repository has to exist on
GitHub before any of its settings do.** If you go looking for Actions settings
before pushing, there is nothing there to find — that is the usual reason this
step feels broken.

#### 1. Keep your email address out of it

Every git commit records an author email, and on a public repository that is
visible forever to anyone — including scrapers. It is baked into the commit,
so it cannot be quietly edited later once other people have cloned you.

GitHub's answer is a **noreply address**. This repository is already set to use
one:

```
git config --local user.email      # william-geary@users.noreply.github.com
```

That covers commits made here. Two things still worth doing on github.com:

1. **[Settings → Emails](https://github.com/settings/emails)** → tick
   **Keep my email addresses private**. The page then shows your personal
   noreply address, in the form `1234567+william-geary@users.noreply.github.com`.
2. On the same page, tick **Block command line pushes that expose my email**.
   GitHub will then *refuse* any push whose commits carry your real address —
   a safety net rather than something you have to remember.

If the address on that page has a number in front (newer accounts do), point
this repo at the exact one so your commits also get linked to your profile:

```
git config --local user.email "1234567+william-geary@users.noreply.github.com"
```

Either form keeps your real address private; the numbered one additionally
attributes the commits to you on GitHub.

**Your other projects are not covered.** The setting above is local to this
repository, and your global git config still has a real address in it. To
default every future repository to the private one:

```
git config --global user.email "1234567+william-geary@users.noreply.github.com"
```

##### If a real address is already in the history

Fix it *before* pushing — afterwards it is public and rewriting means
force-pushing over anyone who cloned. Nothing here has been pushed, so this is
safe today:

```
git config --local user.email "YOUR-NOREPLY-ADDRESS"
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter '
  export GIT_AUTHOR_EMAIL="YOUR-NOREPLY-ADDRESS"
  export GIT_COMMITTER_EMAIL="YOUR-NOREPLY-ADDRESS"
' -- --all

# filter-branch keeps the old commits as backups; these two lines drop them,
# and without this the old address is still in the repo and still gets pushed
git for-each-ref --format="%(refname)" refs/original/ | xargs -n1 git update-ref -d
git reflog expire --expire=now --all && git gc --prune=now
```

Check it worked:

```
git log --format="%an <%ae>"
```

#### 2. Create an empty repository on GitHub

Go to **[github.com/new](https://github.com/new)** and fill in:

- **Repository name**: `card-centering-grader`
  (the README and `pyproject.toml` already link to this name — if you pick a
  different one, update the links in those two files)
- **Public** — this matters. Release downloads from a *private* repo require
  the person downloading to be signed in and have access, which defeats the
  point of sending a friend a link.
- **Leave every checkbox unticked.** Do not add a README, a `.gitignore` or a
  licence: you already have all three locally, and letting GitHub create them
  makes a commit that collides with your first push.

Click **Create repository**. You land on a near-empty page of setup commands —
that is expected.

#### 3. Push your code up

In a terminal, from the project folder:

```
git remote add origin https://github.com/william-geary/card-centering-grader.git
git push -u origin main
```

A browser window will open asking you to sign in to GitHub. That is Git
Credential Manager, which ships with Git for Windows; sign in and authorise it
and it will remember you from then on.

If instead the terminal asks for a *password*, note that GitHub stopped
accepting account passwords in 2021. Go to
**[github.com/settings/tokens](https://github.com/settings/tokens)** →
*Generate new token (classic)* → tick the **repo** scope → generate → copy it,
and paste that token where it asks for the password.

Refresh the repository page and your files will be there.

#### 4. Let Actions create releases

Now the settings exist. Go to:

**https://github.com/william-geary/card-centering-grader/settings/actions**

or navigate there by hand:

1. Open your repository page.
2. Click **Settings** — the last tab in the row along the top
   (Code · Issues · Pull requests · Actions · Projects · Wiki · Security ·
   Insights · **Settings**), with a gear icon. If you cannot see it, you are
   either signed out or looking at somebody else's copy.
3. In the **left sidebar**, under *Code and automation*, click **Actions** to
   expand it, then click **General**.
4. Scroll to the bottom, to the **Workflow permissions** section.
5. Select **Read and write permissions**.
6. Click **Save**.

Without this the workflow can build the apps but is not allowed to publish the
release, and the last step fails with a 403.

> Do not confuse the repository's Settings tab with your account settings at
> `github.com/settings`. The workflow permission lives on the repository.

### Publishing

Every time you want to ship a version:

```
git tag v1.0.0
git push origin v1.0.0
```

That is it. Pushing a tag beginning with `v` starts the workflow. Watch it on
the **Actions** tab of your repository: a run called *release* appears within a
few seconds and takes roughly 5–10 minutes, because it is building on three
machines at once. When it finishes, your release is on the **Releases** page
with all three files attached and the install instructions already written out.

### Trying it without publishing

On the **Actions** tab, pick **release** → **Run workflow**. It builds all
three and uploads them as *artifacts* (downloadable zips at the bottom of the
run page) but does **not** create a release, because the publish step only runs
for a real tag. Good for checking a build before you commit to a version
number.

### Version numbers

The tag should match `__version__` in `cardgrader/__init__.py`, since that is
what ends up in the filenames. Bump both together. `v1.0.1` for a fix, `v1.1.0`
for a feature, `v2.0.0` if you change something in a way that breaks how people
use it. Nobody will hold you to this — it is a convention, not a rule.

---

## Route B — build it yourself and upload by hand

Useful if Actions is not set up yet, or you just want a file to hand someone
right now.

### On Windows

```
pip install -r requirements.txt pyinstaller
python build_app.py --package
```

Produces `dist/CardCenteringGrader-1.0.0-windows-x86_64.exe`.

### On your Mac

Same commands. macOS ships a Python but it is old and awkward; install a
current one from [python.org](https://www.python.org/downloads/) or via
Homebrew (`brew install python`) first.

```
pip3 install -r requirements.txt pyinstaller
python3 build_app.py --package
```

Produces `dist/CardCenteringGrader-1.0.0-macos-arm64.zip` (or `-x86_64` on an
Intel Mac). The build script zips the `.app` for you with `ditto` — do not zip
it in Finder from a script, and never with Python's `zipfile`, because both can
lose the executable bit inside the bundle and the app then refuses to launch.

**Check your own build before sending it**: unzip it somewhere else on your
Mac and open it. If it works for you, it will work for them, modulo the
Gatekeeper step below.

### Uploading

On github.com: **Releases** → **Draft a new release** → **Choose a tag** → type
`v1.0.0` → *Create new tag on publish* → drag your files into the assets box →
paste the contents of [`docs/release-notes.md`](release-notes.md) into the
description → **Publish release**.

---

## What your friends will hit

Both platforms will warn them, because the apps are unsigned. Signing costs
money — roughly $100–400/year for a Windows certificate, $99/year for Apple's
developer programme — and for a tool you are giving to friends it is usually
not worth it. Just tell them what to expect. The release notes already do.

**Windows**: "Windows protected your PC" → **More info** → **Run anyway**.

**macOS**: they must **right-click the app → Open**, then confirm. Plain
double-clicking gives a dead-end "Apple could not verify this app is free of
malware" dialog with only a Cancel button, and this is the single most common
reason someone gives up. Say it explicitly when you send the link.

If a Mac friend is really stuck:

```
xattr -d com.apple.quarantine /Applications/CardCenteringGrader.app
```

## Setting up your Mac to work on the code

```
git clone https://github.com/william-geary/card-centering-grader.git
cd card-centering-grader
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

If the window opens but looks wrong or Tk complains, macOS's bundled Tcl/Tk is
the usual cause — install Python from python.org rather than using the system
one, or `brew install python-tk`.

The app itself is the same code on both platforms. The only place that branches
on the operating system is which modifier key counts as Alt
(`cardgrader/ui/canvas.py`), and which icon format the build uses.

## If a release goes wrong

Delete the release on the Releases page, then delete the tag and push again:

```
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0
```

Then fix, re-tag, re-push. Nobody minds; a release that existed for ten minutes
is not history anyone will miss.
