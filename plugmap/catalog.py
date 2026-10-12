"""The OpenSustain.tech catalog: fetch projects.csv and select one category."""
import csv
import os
import sys

from .harvest import _git
from .paths import CACHE, load_config

csv.field_size_limit(sys.maxsize)


def catalog_path():
    cfg = load_config()["catalog"]
    return os.path.join(CACHE, "catalog", cfg["path"])


def fetch(refresh=False):
    """Sparse-clone the catalog repository so only the CSV is downloaded. Returns the CSV path."""
    cfg = load_config()["catalog"]
    dest = os.path.join(CACHE, "catalog")
    path = catalog_path()
    if os.path.exists(path) and not refresh:
        return path
    if os.path.isdir(os.path.join(dest, ".git")):
        r = _git(["pull", "--quiet", "--depth", "1"], cwd=dest)
    else:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        r = _git(["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--no-checkout", cfg["repo"], dest])
        if r.returncode == 0:
            _git(["sparse-checkout", "set", "--no-cone", "/" + cfg["path"]], cwd=dest)
            r = _git(["checkout", "--quiet"], cwd=dest)
    if r.returncode != 0 or not os.path.exists(path):
        raise SystemExit(f"Could not fetch the catalog from {cfg['repo']}: {r.stderr.strip()}")
    return path


def projects(category=None):
    """Catalog rows, optionally only those in one category (exact match on the `category` column)."""
    path = catalog_path()
    if not os.path.exists(path):
        path = fetch()
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if category:
        rows = [r for r in rows if r["category"].strip().lower() == category.strip().lower()]
    return rows


def category_counts():
    counts = {}
    for r in projects():
        counts[r["category"]] = counts.get(r["category"], 0) + 1
    return counts
