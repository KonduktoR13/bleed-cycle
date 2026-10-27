#!/usr/bin/env python3
"""Publish committed application assets to the existing GitHub Pages branch."""
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = [".nojekyll", "index.html", "app.js", "styles.css", "service-worker.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"]


def git(*args, cwd=ROOT, capture=False):
    return subprocess.run(["git", *args], cwd=cwd, check=True, stdout=subprocess.PIPE if capture else None).stdout


def main():
    subprocess.run(["npm", "test"], cwd=ROOT, check=True)
    if git("status", "--porcelain", "--", *ASSETS, capture=True):
        raise SystemExit("Commit application changes before publishing.")
    git("fetch", "origin", "gh-pages")
    revision = git("rev-parse", "--short", "HEAD", capture=True).decode().strip()
    with tempfile.TemporaryDirectory(prefix="bleed-publish-") as temporary:
        target = pathlib.Path(temporary) / "pages"
        git("worktree", "add", "--detach", str(target), "origin/gh-pages")
        try:
            for asset in ASSETS:
                (target / asset).write_bytes(git("show", f"HEAD:{asset}", capture=True))
            git("add", "--", *ASSETS, cwd=target)
            if git("diff", "--cached", "--name-only", capture=True, cwd=target):
                git("commit", "-m", f"Publish cycle tracker {revision}", cwd=target)
                git("push", "origin", "HEAD:gh-pages", cwd=target)
            else:
                print("GitHub Pages already has this release.")
        finally:
            git("worktree", "remove", str(target))
    print("Published branch: gh-pages. Wait for GitHub Pages deployment before checking the site.")


if __name__ == "__main__":
    main()
