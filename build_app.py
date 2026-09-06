"""Build a standalone app for people who do not have Python.

    python build_app.py                # Windows: dist/CardCenteringGrader.exe
                                       # macOS:   dist/CardCenteringGrader.app
    python build_app.py --onedir       # a folder that starts faster
    python build_app.py --console      # keep a console, for debugging
    python build_app.py --package      # also name it for a GitHub release

Needs PyInstaller (`pip install pyinstaller`).

PyInstaller does not cross-compile. A Windows .exe must be built on Windows and
a macOS .app on macOS, and a Mac build only runs on the processor family it was
built on -- an Apple Silicon build will not start on an Intel Mac. The release
workflow in .github/workflows/release.yml builds all of them on GitHub's
machines so you do not have to own each one.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "CardCenteringGrader"
BUNDLE_ID = "com.williamgeary.cardcenteringgrader"

IS_WINDOWS = sys.platform.startswith("win")
IS_MAC = sys.platform == "darwin"

# Nothing here is imported by the app, but PyInstaller pulls some of it in via
# numpy's and Pillow's optional paths.  Dropping them saves ~40 MB.
EXCLUDES = (
    "matplotlib", "scipy", "pandas", "pytest", "IPython", "notebook",
    "PyQt5", "PyQt6", "PySide2", "PySide6", "wx",
    "numpy.f2py", "numpy.testing", "PIL.ImageQt", "setuptools", "pip",
    "unittest", "pydoc_data", "lib2to3", "sqlite3", "email", "http",
)


def version() -> str:
    scope: dict = {}
    path = os.path.join(HERE, "cardgrader", "__init__.py")
    for line in open(path, encoding="utf-8"):
        if line.startswith("__version__"):
            exec(line, scope)
            return scope["__version__"]
    return "0.0.0"


def platform_tag() -> str:
    """Something a downloader can read: windows-x86_64, macos-arm64, ..."""
    machine = platform.machine().lower()
    machine = {"amd64": "x86_64", "x86_64": "x86_64",
               "arm64": "arm64", "aarch64": "arm64"}.get(machine, machine)
    if IS_WINDOWS:
        return "windows-" + machine
    if IS_MAC:
        return "macos-" + machine
    return "linux-" + machine


def icon_path() -> str | None:
    name = "icon.ico" if IS_WINDOWS else ("icon.icns" if IS_MAC else "icon.png")
    path = os.path.join(HERE, "packaging", name)
    if os.path.exists(path):
        return path
    print("no %s yet, generating the icons" % name)
    subprocess.run([sys.executable,
                    os.path.join(HERE, "packaging", "make_icon.py")], check=True)
    return path if os.path.exists(path) else None


def built_path(onedir: bool) -> str:
    """Where PyInstaller will have put the thing people actually run."""
    dist = os.path.join(HERE, "dist")
    if IS_MAC and not onedir:
        # A windowed macOS build always produces a .app bundle next to the
        # plain executable; the bundle is what gets shipped.
        app = os.path.join(dist, NAME + ".app")
        if os.path.exists(app):
            return app
    if IS_WINDOWS and not onedir:
        return os.path.join(dist, NAME + ".exe")
    return os.path.join(dist, NAME)


def package(target: str) -> str:
    """Produce the file to attach to a release, named so a downloader can tell
    at a glance which machine it is for.

    A single executable is just copied under that name.  Anything that is a
    folder -- every macOS .app, and any --onedir build -- has to be archived.
    On macOS that uses `ditto` rather than zipfile: an .app's inner binary must
    keep its executable bit and its symlinks, and Python's zipfile silently
    drops both, producing a bundle that will not launch.
    """
    stem = "%s-%s-%s" % (NAME, version(), platform_tag())
    if os.path.isfile(target):
        asset = os.path.join(HERE, "dist", stem + os.path.splitext(target)[1])
        shutil.copy2(target, asset)
        return asset

    archive = os.path.join(HERE, "dist", stem + ".zip")
    if os.path.exists(archive):
        os.remove(archive)
    if IS_MAC and shutil.which("ditto"):
        subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent",
                        target, archive], check=True)
    else:
        import zipfile

        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
            if os.path.isfile(target):
                zf.write(target, os.path.basename(target))
            else:
                base = os.path.dirname(target)
                for root, _dirs, files in os.walk(target):
                    for f in files:
                        full = os.path.join(root, f)
                        zf.write(full, os.path.relpath(full, base))
    return archive


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onedir", action="store_true",
                    help="folder build instead of a single file (starts faster)")
    ap.add_argument("--console", action="store_true",
                    help="keep the console window (shows tracebacks)")
    ap.add_argument("--package", action="store_true",
                    help="also write dist/<name>-<version>-<platform>.* to upload")
    ap.add_argument("--keep-build", action="store_true")
    args = ap.parse_args()

    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("PyInstaller is not installed.  Run:  pip install pyinstaller")
        return 1

    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
           "--name", NAME,
           "--onedir" if args.onedir else "--onefile",
           "--console" if args.console else "--windowed",
           "--distpath", os.path.join(HERE, "dist"),
           "--workpath", os.path.join(HERE, "build"),
           "--specpath", os.path.join(HERE, "build")]
    icon = icon_path()
    if icon:
        cmd += ["--icon", icon]
    if IS_MAC:
        cmd += ["--osx-bundle-identifier", BUNDLE_ID]
    for mod in EXCLUDES:
        cmd += ["--exclude-module", mod]
    cmd.append(os.path.join(HERE, "run.py"))

    print(" ".join(cmd), "\n")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        return result.returncode

    if not args.keep_build:
        shutil.rmtree(os.path.join(HERE, "build"), ignore_errors=True)

    target = built_path(args.onedir)
    if not os.path.exists(target):
        print("\nPyInstaller reported success but %s is missing" % target)
        return 1

    if os.path.isfile(target):
        print("\nBuilt %s  (%.1f MB)" % (target, os.path.getsize(target) / 1e6))
    else:
        print("\nBuilt %s" % target)

    # A macOS .app is a folder, so it has to be archived to be shared at all.
    if args.package or (IS_MAC and os.path.isdir(target)):
        asset = package(target)
        print("Release asset %s  (%.1f MB)"
              % (asset, os.path.getsize(asset) / 1e6))
        print("\nThat is the file to attach to the GitHub release.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
