"""Parse dependency manifests (text only, best effort) into a set of normalized package names."""
import json
import os
import re

from ..vocab import norm_dep

MAX_BYTES = 400_000
REQ_NAME = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._\-]*)")


def read_text(path):
    try:
        if os.path.islink(path) or os.path.getsize(path) > MAX_BYTES:
            return ""
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def requirements(text):
    out = set()
    for line in text.splitlines():
        line = line.split("#")[0].strip()
        if not line or line.startswith(("-", "git+", "http")):
            continue
        m = REQ_NAME.match(line)
        if m:
            out.add(norm_dep(m.group(1)))
    return out


STRING = re.compile(r"\"((?:[^\"\\\n]|\\.)*)\"|'((?:[^'\\\n]|\\.)*)'")


def _quoted(block):
    """Package names from the string literals in a list or dict, skipping dict keys ("io": [...])."""
    out = set()
    for m in STRING.finditer(block):
        if re.match(r"\s*:", block[m.end():]):
            continue
        m2 = REQ_NAME.match(m.group(1) if m.group(1) is not None else m.group(2))
        if m2:
            out.add(norm_dep(m2.group(1)))
    return out


def _closing(text, i):
    """Index just past the bracket that closes the one at text[i]. Brackets inside strings
    ("xarray[io]") and # comments don't count."""
    depth, quote, j = 0, None, i
    while j < len(text):
        ch = text[j]
        if quote:
            if ch == "\\":
                j += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#":
            j = text.find("\n", j)
            if j < 0:
                break
            continue
        elif ch in "[{(":
            depth += 1
        elif ch in "]})":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    return len(text)


def _values(text, key):
    """The bracketed value of every `key = [...]` or `key = {...}` (key is a regex)."""
    out = []
    for m in re.finditer(r"\b(?:" + key + r")\s*=\s*(?=[\[{])", text, re.I):
        out.append(text[m.end():_closing(text, m.end())])
    return out


def _sections(text, name):
    """Bodies of every [name] table (TOML) or section (INI); name is a regex."""
    return [m.group(1) for m in re.finditer(r"^\[" + name + r"\][^\n]*\n(.*?)(?=^\[|\Z)", text, re.M | re.S)]


def _table_keys(body):
    """Package names written as keys in a TOML table: `name = ...` or `"name" = ...`."""
    return {norm_dep(m.group(1)) for m in re.finditer(r"^\s*[\"']?([A-Za-z0-9][A-Za-z0-9._\-]*)[\"']?\s*=", body, re.M)}


def pyproject(text):
    out = set()
    for block in _values(text, "dependencies|requires"):  # [project], [build-system], inline extras
        out |= _quoted(block)
    for body in _sections(text, r"project\.optional-dependencies") + _sections(text, "dependency-groups"):
        for block in _values(body, r"[A-Za-z0-9_.\-]+"):
            out |= _quoted(block)
    for body in _sections(text, r"tool\.poetry(?:\.group\.[^\]]+)?\.(?:dev-)?dependencies"):
        out |= _table_keys(body)
    return out


def setup_py(text):
    out = set()
    for block in _values(text, "install_requires|extras_require|tests_require|requires"):
        out |= _quoted(block)
    return out


def setup_cfg(text):
    out = set()
    entry = r"=(.*(?:\n[ \t]+.*)*)"  # value on the same line and/or indented lines below
    m = re.search(r"^install_requires\s*" + entry, text, re.M)
    if m:
        out |= requirements(m.group(1))
    for body in _sections(text, r"options\.extras_require"):
        for m in re.finditer(r"^[A-Za-z0-9_.\-]+\s*" + entry, body, re.M):
            out |= requirements(m.group(1))
    return out


def conda_env(text):
    out = set()
    for line in text.splitlines():
        m = re.match(r"\s*-\s*(?:[A-Za-z0-9._\-]+::)?([A-Za-z0-9][A-Za-z0-9._\-]*)", line)
        if m and m.group(1).lower() not in ("pip", "python", "conda-forge", "defaults"):
            out.add(norm_dep(m.group(1)))
    return out


def package_json(text, keys=("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")):
    try:
        j = json.loads(text)
    except ValueError:
        return set()
    out = set()
    for k in keys:
        if isinstance(j, dict) and isinstance(j.get(k), dict):
            out |= {norm_dep(x) for x in j[k]}
    return out


def toml_tables(text, tables):
    out = set()
    for t in tables:
        for body in _sections(text, re.escape(t)):
            out |= _table_keys(body)
    return out


def gemfile(text):
    return {norm_dep(m) for m in re.findall(r"^\s*gem\s+[\"']([^\"']+)[\"']", text, re.M)}


def go_mod(text):
    return {norm_dep(m.group(1)) for m in re.finditer(r"^\s*(?:require\s+)?([a-z0-9.\-]+\.[a-z]+/[^\s]+)\s+v", text, re.M)}


def r_description(text):
    out = set()
    for field in ("Imports", "Depends", "Suggests"):
        m = re.search(field + r":\s*(.*?)(?:\n\S|\Z)", text, re.S)
        if m:
            for part in m.group(1).split(","):
                mm = REQ_NAME.match(part.strip())
                if mm:
                    out.add(norm_dep(mm.group(1)))
    return out


def java(text):
    return {norm_dep(m) for m in re.findall(r"<artifactId>([^<]+)</artifactId>", text)} | \
           {norm_dep(m.split(":")[1]) for m in re.findall(r"['\"]([\w.\-]+:[\w.\-]+)(?::[^'\"]*)?['\"]", text)}


PARSERS = [
    (re.compile(r"^requirements.*\.txt$", re.I), requirements),
    (re.compile(r"^pyproject\.toml$", re.I), pyproject),
    (re.compile(r"^setup\.py$", re.I), setup_py),
    (re.compile(r"^setup\.cfg$", re.I), setup_cfg),
    (re.compile(r"^environment.*\.ya?ml$", re.I), conda_env),
    (re.compile(r"^pipfile$", re.I), lambda t: toml_tables(t, ["packages", "dev-packages"])),
    (re.compile(r"^package\.json$", re.I), package_json),
    (re.compile(r"^composer\.json$", re.I), lambda t: package_json(t, ("require", "require-dev"))),
    (re.compile(r"^gemfile$", re.I), gemfile),
    (re.compile(r"^cargo\.toml$", re.I), lambda t: toml_tables(t, ["dependencies", "dev-dependencies"])),
    (re.compile(r"^project\.toml$", re.I), lambda t: toml_tables(t, ["deps", "weakdeps"])),
    (re.compile(r"^go\.mod$", re.I), go_mod),
    (re.compile(r"^description$", re.I), r_description),
    (re.compile(r"^(pom\.xml|build\.gradle(\.kts)?)$", re.I), java),
]


def dependencies(repo_dir, files):
    """All dependency names declared in the repository's top-level manifests."""
    names = set()
    for f in files:
        for rx, parser in PARSERS:
            if rx.match(f):
                names |= parser(read_text(os.path.join(repo_dir, f)))
    return names


def claims(vocab, repo_dir, files, home_of=()):
    """Claims from dependencies: one per (term, dependency)."""
    out = []
    for dep in sorted(dependencies(repo_dir, files)):
        for term, weak in vocab.dep_index.get(dep, []):
            if term in home_of:
                continue
            out.append({"term": term, "role": "uses", "method": "dependency", "weak": weak,
                        "evidence": f"declares dependency {dep}"})
    return out
