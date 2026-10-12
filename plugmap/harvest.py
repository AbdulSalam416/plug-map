"""Harvest stage: shallow, blobless, sparse clones of each tool's repository.

Only top-level docs and dependency manifests, plus source files in the languages the code
reader knows (vocab.LANGUAGES), are checked out. Jupyter notebooks are not: saved outputs make
them large, and calls in them would only count as examples. Nothing from a repository is ever executed; files are only read as text.
Clones are cached in cache/repos/ and reused on later runs unless refresh=True.
"""
import hashlib
import os
import re
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed

from .paths import CACHE
from .vocab import LANGUAGES

SPARSE = [
    "/README*", "/readme*", "/Readme*",
    "/requirements*.txt", "/pyproject.toml", "/setup.py", "/setup.cfg", "/environment*.yml",
    "/environment*.yaml", "/Pipfile", "/package.json", "/Cargo.toml", "/go.mod", "/DESCRIPTION",
    "/Project.toml", "/pom.xml", "/build.gradle", "/build.gradle.kts", "/composer.json", "/Gemfile",
] + sorted({"*" + e for exts in LANGUAGES.values() for e in exts}) + [
    # Bundled and vendored code (also skipped by the code reader).
    "!*.min.js", "!*.bundle.js", "!node_modules/", "!vendor/", "!third_party/",
]


# Hosts whose cache folders use the short name (github__owner__repo); others use the full host.
SHORT_HOSTS = {"github.com", "gitlab.com", "bitbucket.org"}


def repo_dir(url):
    m = re.match(r"https?://([^/]+)/(.+?)(?:\.git)?/?$", (url or "").strip())
    if not m:
        return None
    host = m.group(1).lower()
    prefix = host.split(".")[0] if host in SHORT_HOSTS else re.sub(r"[^a-z0-9-]", "_", host)
    slug = prefix + "__" + m.group(2).replace("/", "__")
    if len(slug) > 150:  # keep long names unique after shortening
        slug = slug[:140] + "_" + hashlib.sha1(slug.encode()).hexdigest()[:9]
    return os.path.join(CACHE, "repos", slug)


def _git(args, cwd=None, timeout=180):
    # Never prompt for credentials; never download Git LFS files (data, models), only pointers.
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_LFS_SKIP_SMUDGE": "1"}
    return subprocess.run(["git"] + args, cwd=cwd, timeout=timeout, capture_output=True, text=True, env=env)


def top_files(dest):
    return sorted(f for f in os.listdir(dest)
                  if not f.startswith(".git") and not os.path.islink(os.path.join(dest, f))
                  and os.path.isfile(os.path.join(dest, f)))


def harvest_one(url, refresh=False):
    """Clone (or reuse) one repository. Returns {ok, dir, files, commit, error}."""
    dest = repo_dir(url)
    rec = {"url": url, "dir": dest, "ok": False, "files": [], "commit": None, "error": None}
    if not dest:
        rec["error"] = "not a repository URL"
        return rec
    try:
        if os.path.isdir(os.path.join(dest, ".git")) and not refresh:
            # A clone made with an older SPARSE list: check out the extra files at the same commit,
            # so claims stay pinned to the commit already recorded.
            # If that fails or times out, the clone is still read with the files it already has, and
            # the next run tries again.
            current = _git(["sparse-checkout", "list"], cwd=dest).stdout.splitlines()
            if current != SPARSE:
                try:
                    r = _git(["sparse-checkout", "set", "--no-cone"] + SPARSE, cwd=dest, timeout=900)
                    if r.returncode != 0:
                        rec["warning"] = "sparse update: " + (r.stderr.strip().splitlines() or ["failed"])[-1][:200]
                except subprocess.TimeoutExpired:
                    rec["warning"] = "sparse update: timeout"
        else:
            if os.path.isdir(dest):
                shutil.rmtree(dest)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            r = _git(["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--quiet", url, dest])
            if r.returncode != 0:
                rec["error"] = (r.stderr.strip().splitlines() or ["clone failed"])[-1][:200]
                return rec
            _git(["sparse-checkout", "set", "--no-cone"] + SPARSE, cwd=dest)
            r = _git(["checkout", "--quiet"], cwd=dest, timeout=300)
            if r.returncode != 0:
                rec["error"] = "checkout: " + (r.stderr.strip().splitlines() or ["failed"])[-1][:200]
                return rec
        head = _git(["rev-parse", "HEAD"], cwd=dest)
        rec.update(ok=True, files=top_files(dest), commit=head.stdout.strip() or None)
    except subprocess.TimeoutExpired:
        rec["error"] = "timeout"
    except OSError as e:
        rec["error"] = str(e)[:200]
    return rec


def harvest_many(urls, workers=12, refresh=False, progress=None):
    out = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(harvest_one, u, refresh): u for u in urls}
        for i, f in enumerate(as_completed(futs), 1):
            out[futs[f]] = f.result()
            if progress:
                progress(i, len(futs))
    return out
