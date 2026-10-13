"""Load, compile and validate the vocabulary (vocab/core.yml + vocab/packs/*.yml).

Nothing domain-specific lives in Python: every term and every pattern comes from these files.
"""
import os
import re

import yaml

from .paths import VOCAB_DIR

KINDS = {"format", "protocol", "standard", "source", "ecosystem", "generic"}
ROLES = {"reads", "writes", "speaks", "pulls"}
LANGUAGES = {
    "python": (".py",), "julia": (".jl",), "r": (".R", ".r"),
    "c": (".c", ".h"), "cpp": (".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".h"),
    "java": (".java",), "matlab": (".m",), "modelica": (".mo",), "rust": (".rs",),
    "javascript": (".js", ".mjs", ".cjs", ".jsx"), "typescript": (".ts", ".tsx", ".mts", ".cts"),
    "fortran": (".f90", ".f95", ".f03", ".f08", ".f", ".for", ".f77",
                ".F90", ".F95", ".F03", ".F08", ".F", ".FOR"),
}


def _load(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_profiles():
    """vocab/profiles.yml as a list of dicts, with names_file read into names. [] if absent."""
    path = os.path.join(VOCAB_DIR, "profiles.yml")
    if not os.path.exists(path):
        return []
    out = []
    for p in (_load(path) or {}).get("profiles", []):
        p = dict(p, names=list(p.get("names", [])))
        if p.get("names_file"):
            with open(os.path.join(VOCAB_DIR, p["names_file"]), encoding="utf-8") as f:
                p["names"] += [ln.strip() for ln in f if ln.strip() and not ln.startswith("#")]
        out.append(p)
    return out


def pack_names():
    d = os.path.join(VOCAB_DIR, "packs")
    return sorted(os.path.splitext(f)[0] for f in os.listdir(d) if f.endswith(".yml"))


class Vocabulary:
    """Terms from the core layer plus the requested packs, with compiled patterns."""

    def __init__(self, packs=()):
        core = _load(os.path.join(VOCAB_DIR, "core.yml"))
        self.settings = core.get("settings", {})
        self.terms = {}
        for t in core["terms"]:
            self.terms[t["id"]] = dict(t, layer="core")
        for p in packs:
            data = _load(os.path.join(VOCAB_DIR, "packs", p + ".yml"))
            for t in data["terms"]:
                self.terms[t["id"]] = dict(t, layer=data.get("layer", p))
        self.usage_words = re.compile(self.settings.get("ecosystem_usage_words", "."), re.I)
        self.readme = {k: re.compile(t["readme"], re.I) for k, t in self.terms.items() if t.get("readme")}
        self.code = []  # (term_id, role, extensions, compiled)
        for k, t in self.terms.items():
            for c in t.get("code", []):
                exts = tuple(e for lang in c["languages"] for e in LANGUAGES[lang])
                self.code.append((k, c["role"], exts, re.compile(c["pattern"])))
        self.dep_index = {}
        for k, t in self.terms.items():
            for d in t.get("dependencies", []):
                self.dep_index.setdefault(norm_dep(d), []).append((k, False))
            for d in t.get("weak_dependencies", []):
                self.dep_index.setdefault(norm_dep(d), []).append((k, True))
        # format term id -> [(profile id, set of names, compiled marker pattern or None)]
        self.profiles = {}
        for p in load_profiles():
            rx = re.compile(p["pattern"]) if p.get("pattern") else None
            for f in p.get("formats", []):
                if f in self.terms:
                    self.profiles.setdefault(f, []).append((p["id"], set(p["names"]), rx))

    def kind(self, term_id):
        return self.terms[term_id]["kind"]

    def is_specific(self, term_id):
        return self.terms[term_id]["kind"] != "generic"


def norm_dep(name):
    return name.strip().lower().replace("_", "-")


def validate():
    """Check every vocabulary file. Returns a list of problems (empty = valid)."""
    problems, seen = [], {}
    files = [os.path.join(VOCAB_DIR, "core.yml")] + [os.path.join(VOCAB_DIR, "packs", p + ".yml") for p in pack_names()]
    for path in files:
        rel = os.path.relpath(path, os.path.dirname(VOCAB_DIR))
        data = _load(path)
        for t in data.get("terms", []):
            where = f'{rel}: {t.get("id", "?")}'
            for field in ("id", "label", "kind"):
                if not t.get(field):
                    problems.append(f"{where}: missing {field}")
            if t.get("id") in seen:
                problems.append(f"{where}: id also defined in {seen[t['id']]}")
            seen[t.get("id")] = rel
            if t.get("kind") not in KINDS:
                problems.append(f"{where}: kind must be one of {sorted(KINDS)}")
            if "semantic" in t and t["semantic"] is not True:
                problems.append(f"{where}: semantic must be true or left out")
            if t.get("semantic") and t.get("kind") == "generic":
                problems.append(f"{where}: a generic term can't be semantic")
            if t.get("readme"):
                try:
                    re.compile(t["readme"], re.I)
                except re.error as e:
                    problems.append(f"{where}: readme pattern does not compile ({e})")
            for c in t.get("code", []):
                if c.get("role") not in ROLES:
                    problems.append(f"{where}: code role must be one of {sorted(ROLES)}")
                if not set(c.get("languages", [])) <= set(LANGUAGES):
                    problems.append(f"{where}: code languages must be among {sorted(LANGUAGES)}")
                try:
                    re.compile(c.get("pattern", ""))
                except re.error as e:
                    problems.append(f"{where}: code pattern does not compile ({e})")
    formats = set(seen)
    ids = set()
    try:
        profiles = load_profiles()
    except OSError as e:
        return problems + [f"vocab/profiles.yml: {e}"]
    for p in profiles:
        where = f'vocab/profiles.yml: {p.get("id", "?")}'
        if not p.get("id") or not p.get("label"):
            problems.append(f"{where}: missing id or label")
        if p.get("id") in ids:
            problems.append(f"{where}: id used twice")
        ids.add(p.get("id"))
        if not p["names"] and not p.get("pattern"):
            problems.append(f"{where}: needs names, names_file or pattern")
        for f in p.get("formats", []):
            if f not in formats:
                problems.append(f"{where}: format {f} is not a vocabulary term")
        if p.get("pattern"):
            try:
                re.compile(p["pattern"])
            except re.error as e:
                problems.append(f"{where}: pattern does not compile ({e})")
    return problems
