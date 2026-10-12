"""Build the site's data files from the committed claims and tool records.

    site/data/index.json        categories, vocabulary, proposals, headline numbers
    site/data/<slug>.json       one per mapped category: tools with their claims (compact keys)
"""
import json
import os
from collections import Counter, defaultdict

import yaml

from .catalog import category_counts
from .paths import CLAIMS_DIR, PROPOSALS, SITE_DATA, TOOLS_DIR, load_config, slugify
from .vocab import Vocabulary, load_profiles, pack_names


def _claims(slug):
    path = os.path.join(CLAIMS_DIR, slug + ".jsonl")
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def build_site_data(log=print):
    cfg = load_config()
    vocab = Vocabulary(pack_names())
    # Catalog totals per category. Saved to data/catalog_counts.json so the site can be rebuilt
    # offline (or in CI) without fetching the catalog again.
    counts_path = os.path.join(os.path.dirname(CLAIMS_DIR), "catalog_counts.json")
    try:
        totals = category_counts()
        with open(counts_path, "w", encoding="utf-8") as f:
            json.dump(totals, f, indent=1, sort_keys=True)
    except SystemExit:
        totals = {}
        if os.path.exists(counts_path):
            with open(counts_path, encoding="utf-8") as f:
                totals = json.load(f)
    os.makedirs(SITE_DATA, exist_ok=True)
    cats, methods = [], Counter()
    for c in cfg["categories"]:
        slug = slugify(c["name"])
        has_data = os.path.exists(os.path.join(CLAIMS_DIR, slug + ".jsonl"))
        entry = {"n": c["name"], "slug": slug, "s": "mapped" if has_data else c.get("status", "queued"),
                 "pack": ", ".join(p.title() for p in c.get("pack", [])) or c.get("planned_pack", "Core only"),
                 "total": totals.get(c["name"], 0)}
        if has_data:
            with open(os.path.join(TOOLS_DIR, slug + ".json"), encoding="utf-8") as f:
                tools = json.load(f)
            entry["total"] = entry["total"] or len(tools)
            by_repo = defaultdict(list)
            for cl in _claims(slug):
                if cl.get("weak"):
                    continue
                methods[cl["method"]] += 1
                row = {"i": cl["term"], "r": cl["role"], "m": cl["method"], "e": cl["evidence"][:300]}
                if cl.get("file"):
                    row["f"] = cl["file"]
                if cl.get("line"):
                    row["l"] = cl["line"]
                if cl.get("count", 1) > 1:
                    row["n"] = cl["count"]
                if cl.get("where", "main") != "main":  # code call found only in tests or examples
                    row["x"] = cl["where"]
                if cl.get("profile"):  # variable names and conventions in the same file (vocab/profiles.yml)
                    row["pf"] = cl["profile"]
                by_repo[cl["repo"]].append(row)
            out = [{"n": t["name"], "u": t["repo"], "c": t["category"], "sc": t["sub_category"],
                    "st": t["stars"], "a": t["last_commit"], "d": t["description"][:220],
                    "k": t.get("commit"), "p": t.get("purl"), "pb": t.get("purl_basis"),
                    "cl": by_repo.get(t["repo"], [])}
                   for t in tools if t["read"]]
            with open(os.path.join(SITE_DATA, slug + ".json"), "w", encoding="utf-8") as f:
                json.dump({"category": c["name"], "tools": out}, f, separators=(",", ":"), ensure_ascii=False)
            entry.update(read=len(out))
            log(f"  site/data/{slug}.json: {len(out)} tools")
        cats.append(entry)
    proposals = []
    if os.path.exists(PROPOSALS):
        with open(PROPOSALS, encoding="utf-8") as f:
            proposals = (yaml.safe_load(f) or {}).get("proposals", [])
    index = {
        "built": __import__("datetime").date.today().isoformat(),
        "catalog_total": sum(totals.values()) or None,
        "cats": cats,
        "vocab": {k: {"l": t["label"], "k": t["kind"], "layer": t["layer"]} for k, t in vocab.terms.items()},
        "profiles": {p["id"]: p["label"] for p in load_profiles()},
        "layers": [{"id": "core", "title": "Core · every category", "file": "vocab/core.yml"}]
                  + [{"id": p, "title": p.replace("_", " ").title() + " pack", "file": f"vocab/packs/{p}.yml",
                      "used_by": [c["name"] for c in cfg["categories"] if p in c.get("pack", [])]}
                     for p in pack_names()],
        "methods": dict(methods),
        "proposed": [{"n": p["name"], "k": p.get("kind", ""), "from": p.get("found_in", ""),
                      "also": p.get("also_found_in", []), "cat": p.get("category", ""), "r": p.get("role", ""),
                      "q": p.get("quote", ""), "status": p.get("status", "open"), "by": p.get("proposed_by", "")}
                     for p in proposals],
    }
    with open(os.path.join(SITE_DATA, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, separators=(",", ":"), ensure_ascii=False)
    log(f"  site/data/index.json: {sum(1 for c in cats if c['s'] == 'mapped')} mapped categories")
    return index
