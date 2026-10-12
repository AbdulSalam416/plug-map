"""
Derive a Package-URL (https://github.com/package-url/purl-spec) for each tool from the
package name declared in its manifests. Declared names are not checked against a
registry, so each result carries a 'basis' field saying where it came from.
Falls back to the repository itself (pkg:github / pkg:gitlab).
"""
import json, os, re
from urllib.parse import quote

def _read(path):
    try:
        if os.path.islink(path) or os.path.getsize(path) > 400_000:
            return ""
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""

def pep503(name):
    return re.sub(r"[-_.]+", "-", name).lower()

def declared(repo_dir, files):
    f = {x.lower(): x for x in files}
    if "pyproject.toml" in f:
        t = _read(os.path.join(repo_dir, f["pyproject.toml"]))
        m = re.search(r"^\[project\]\s*(?:\n(?!\[).*)*?\nname\s*=\s*[\"']([^\"']+)[\"']", t, re.M) or \
            re.search(r"^\[tool\.poetry\]\s*(?:\n(?!\[).*)*?\nname\s*=\s*[\"']([^\"']+)[\"']", t, re.M)
        if m:
            return "pkg:pypi/" + pep503(m.group(1)), "pyproject.toml"
    if "setup.cfg" in f:
        m = re.search(r"^\[metadata\][^\[]*?^name\s*=\s*([A-Za-z0-9._-]+)", _read(os.path.join(repo_dir, f["setup.cfg"])), re.M | re.S)
        if m:
            return "pkg:pypi/" + pep503(m.group(1)), "setup.cfg"
    if "setup.py" in f:
        m = re.search(r"\bname\s*=\s*[\"']([A-Za-z0-9._-]+)[\"']", _read(os.path.join(repo_dir, f["setup.py"])))
        if m:
            return "pkg:pypi/" + pep503(m.group(1)), "setup.py"
    if "package.json" in f:
        try:
            name = json.loads(_read(os.path.join(repo_dir, f["package.json"]))).get("name")
        except ValueError:
            name = None
        if name:
            if name.startswith("@") and "/" in name:
                scope, pkg = name.split("/", 1)
                return f"pkg:npm/{quote(scope)}/{pkg}", "package.json"
            return "pkg:npm/" + name, "package.json"
    if "cargo.toml" in f:
        m = re.search(r"^\[package\][^\[]*?^name\s*=\s*\"([^\"]+)\"", _read(os.path.join(repo_dir, f["cargo.toml"])), re.M | re.S)
        if m:
            return "pkg:cargo/" + m.group(1), "Cargo.toml"
    if "description" in f:
        m = re.search(r"^Package:\s*([A-Za-z0-9.]+)", _read(os.path.join(repo_dir, f["description"])), re.M)
        if m:
            return "pkg:cran/" + m.group(1), "DESCRIPTION"
    if "go.mod" in f:
        m = re.search(r"^module\s+(\S+)", _read(os.path.join(repo_dir, f["go.mod"])), re.M)
        if m:
            return "pkg:golang/" + m.group(1), "go.mod"
    return None, None

def from_repo_url(url):
    m = re.match(r"https?://(github\.com|gitlab\.com|bitbucket\.org)/([^/]+)/(.+?)(?:\.git)?/?$", url.strip())
    if not m:
        return None
    host, owner, name = m.groups()
    t = {"github.com": "github", "gitlab.com": "gitlab", "bitbucket.org": "bitbucket"}[host]
    return f"pkg:{t}/{owner.lower()}/{name.lower()}" if t == "github" else f"pkg:{t}/{owner}/{name}"

def purl_for(repo_dir, files, url):
    p, basis = declared(repo_dir, files)
    if p:
        return p, "declared in " + basis
    p = from_repo_url(url)
    return (p, "repository") if p else (None, None)
