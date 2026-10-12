"""Run one category end to end: select -> harvest -> extract -> write claims and tool records.

Outputs (both committed, so the site works without re-running):
    data/claims/<slug>.jsonl   one claim per line (the core dataset)
    data/tools/<slug>.json     one record per tool in the category
"""
import json
import os
import time

from . import catalog, harvest
from .extract import code as code_reader
from .extract import deps as deps_reader
from .extract import readme as readme_reader
from .paths import CLAIMS_DIR, TOOLS_DIR, category_entry, slugify
from .purl import from_repo_url, purl_for
from .vocab import Vocabulary


def home_terms(vocab, tool_name):
    """Terms whose home repository is this tool (pvlib-python is pvlib; it doesn't 'use' pvlib)."""
    n = tool_name.strip().lower()
    return {k for k, t in vocab.terms.items() if n in [h.lower() for h in t.get("home_repos", [])]}


def extract_tool(vocab, repo_dir, files, tool_name):
    home = home_terms(vocab, tool_name)
    found = deps_reader.claims(vocab, repo_dir, files, home)
    found += readme_reader.claims(vocab, repo_dir, files, home)
    code_claims, nfiles = code_reader.claims(vocab, repo_dir)
    found += [c for c in code_claims if c["term"] not in home]
    return found, nfiles


def run_category(name, refresh=False, workers=12, log=print):
    entry = category_entry(name)
    vocab = Vocabulary(entry.get("pack", []))
    rows = catalog.projects(entry["name"])
    if not rows:
        raise SystemExit(f'No projects found for category "{entry["name"]}" in the catalog.')
    slug = slugify(entry["name"])
    log(f'{entry["name"]}: {len(rows)} projects in the catalog; vocabulary: core + {entry.get("pack") or "no pack"}')

    t0 = time.time()
    urls = sorted({r["git_url"].strip() for r in rows if r["git_url"].strip()})
    step = max(1, len(urls) // 5)
    got = harvest.harvest_many(urls, workers=workers, refresh=refresh,
                               progress=lambda i, n: log(f"  harvested {i}/{n}") if i % step == 0 or i == n else None)
    log(f"  harvest done in {time.time() - t0:.0f}s")

    os.makedirs(CLAIMS_DIR, exist_ok=True)
    os.makedirs(TOOLS_DIR, exist_ok=True)
    tools, nclaims = [], 0
    with open(os.path.join(CLAIMS_DIR, slug + ".jsonl"), "w", encoding="utf-8") as out:
        for r in rows:
            url = r["git_url"].strip()
            h = got.get(url) or {"ok": False, "error": "no repository URL", "files": [], "commit": None}
            rec = {"name": r["project_names"].strip(), "repo": url, "category": r["category"],
                   "sub_category": r["sub_category"], "description": (r["description"] or "")[:300],
                   "stars": int(float(r["stars"] or 0)), "last_commit": (r["latest_commit_activity"] or "")[:10],
                   "read": h["ok"], "error": h.get("error"), "commit": h.get("commit"), "source_files": 0}
            if h.get("warning"):  # read, but possibly with fewer source files than the current SPARSE list
                rec["warning"] = h["warning"]
            if h["ok"]:
                purl, basis = purl_for(h["dir"], h["files"], url)
                found, nfiles = extract_tool(vocab, h["dir"], h["files"], rec["name"])
                rec.update(purl=purl, purl_basis=basis, source_files=nfiles)
                for c in found:
                    c.update(tool=purl, repo=url, layer=vocab.terms[c["term"]]["layer"], commit=h["commit"])
                    out.write(json.dumps(c, ensure_ascii=False) + "\n")
                    nclaims += 1
            else:
                rec.update(purl=from_repo_url(url) if url else None, purl_basis="repository" if url else None)
            tools.append(rec)
    with open(os.path.join(TOOLS_DIR, slug + ".json"), "w", encoding="utf-8") as f:
        json.dump(tools, f, indent=1, ensure_ascii=False)
    read = sum(t["read"] for t in tools)
    log(f"  {read}/{len(tools)} tools read, {nclaims} claims -> data/claims/{slug}.jsonl")
    warned = sum(1 for t in tools if t.get("warning"))
    if warned:
        log(f"  {warned} tools read with a warning (see \"warning\" in data/tools/{slug}.json); run again to retry")
    return {"category": entry["name"], "tools": len(tools), "read": read, "claims": nclaims}
