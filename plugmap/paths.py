"""Filesystem layout and small shared helpers."""
import os
import re

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "config", "categories.yml")
VOCAB_DIR = os.path.join(ROOT, "vocab")
PROPOSALS = os.path.join(VOCAB_DIR, "proposals.yml")
DATA_DIR = os.path.join(ROOT, "data")
CLAIMS_DIR = os.path.join(DATA_DIR, "claims")
TOOLS_DIR = os.path.join(DATA_DIR, "tools")
SITE_DATA = os.path.join(ROOT, "site", "data")
# Cloned repositories and the catalog checkout. Large, never committed.
CACHE = os.environ.get("PLUGMAP_CACHE", os.path.join(ROOT, "cache"))


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def load_config():
    with open(CONFIG, encoding="utf-8") as f:
        return yaml.safe_load(f)


def category_entry(name):
    for c in load_config()["categories"]:
        if c["name"].lower() == name.lower():
            return c
    known = ", ".join(c["name"] for c in load_config()["categories"])
    raise SystemExit(f'Unknown category "{name}". Known: {known}')


def load_dotenv():
    """Read KEY=value lines from .env into os.environ (without overriding existing values)."""
    path = os.path.join(ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
