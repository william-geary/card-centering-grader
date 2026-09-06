"""Build a standalone Windows executable, so people without Python can run it.

    python build_exe.py                # one file: dist/CardCenteringGrader.exe
    python build_exe.py --onedir       # a folder that starts faster
    python build_exe.py --console      # keep a console, for debugging

Needs PyInstaller (`pip install pyinstaller`).  Run it on the platform you are
building for -- PyInstaller does not cross-compile, so a Windows .exe has to be
built on Windows.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "CardCenteringGrader"

# Nothing here is imported by the app, but PyInstaller pulls some of it in via
# numpy's and Pillow's optional paths.  Dropping them saves ~40 MB.
EXCLUDES = (
    "matplotlib", "scipy", "pandas", "pytest", "IPython", "notebook",
    "PyQt5", "PyQt6", "PySide2", "PySide6", "wx",
    "numpy.f2py", "numpy.testing", "PIL.ImageQt", "setuptools", "pip",
    "unittest", "pydoc_data", "lib2to3", "sqlite3", "email", "http",
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onedir", action="store_true",
                    help="folder build instead of a single file (starts faster)")
    ap.add_argument("--console", action="store_true",
                    help="keep the console window (shows tracebacks)")
    ap.add_argument("--keep-build", action="store_true")
    args = ap.parse_args()

    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("PyInstaller is not installed.  Run:  pip install pyinstaller")
        return 1

    icon = os.path.join(HERE, "packaging", "icon.ico")
    if not os.path.exists(icon):
        print("icon missing, generating it")
        subprocess.run([sys.executable,
                        os.path.join(HERE, "packaging", "make_icon.py")], check=True)

    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
           "--name", NAME,
           "--onedir" if args.onedir else "--onefile",
           "--console" if args.console else "--windowed",
           "--icon", icon,
           "--distpath", os.path.join(HERE, "dist"),
           "--workpath", os.path.join(HERE, "build"),
           "--specpath", os.path.join(HERE, "build")]
    for mod in EXCLUDES:
        cmd += ["--exclude-module", mod]
    cmd.append(os.path.join(HERE, "run.py"))

    print(" ".join(cmd), "\n")
    result = subprocess.run(cmd)
    if result.returncode != 0:
        return result.returncode

    if not args.keep_build:
        shutil.rmtree(os.path.join(HERE, "build"), ignore_errors=True)

    target = os.path.join(HERE, "dist",
                          NAME if args.onedir else NAME + ".exe")
    if os.path.exists(target):
        if os.path.isfile(target):
            print("\nBuilt %s  (%.1f MB)" % (target,
                                             os.path.getsize(target) / 1e6))
        else:
            print("\nBuilt %s (zip the whole folder to share it)" % target)
        return 0
    print("\nPyInstaller reported success but %s is missing" % target)
    return 1


if __name__ == "__main__":
    sys.exit(main())
