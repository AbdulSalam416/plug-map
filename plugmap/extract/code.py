"""Code reader: find I/O calls in source code using the vocabulary's code patterns.

Languages: Python, Julia, R, C, C++, Java, MATLAB, Modelica, Rust, JavaScript, TypeScript and
Fortran (see LANGUAGES in vocab.py). Jupyter notebooks are not read (see harvest.py).

Text-only: files are read, never imported or executed. Comments and docstrings are skipped.

Each file is classed as main code, tests, or examples (examples, docs, notebooks, tutorials,
benchmarks). A test that writes a NetCDF fixture says little about what the tool itself writes,
so every claim records where it was found ("where"), and its evidence comes from main code
whenever the call appears there.
"""
import os
import re
from collections import Counter

from ..vocab import LANGUAGES

SKIP_DIRS = {".git", "node_modules", "site-packages", ".venv", "venv", "env", "build", "dist", "_build",
             ".tox", "__pycache__", "vendor", "third_party", "external"}
# Bundled or generated files that would only repeat a library's own code.
SKIP_SUFFIXES = (".min.js", ".d.ts", ".bundle.js")
MAX_BYTES = 400_000
MAX_FILES = 4000  # per language, so a large web front end can't crowd out a tool's Python

TEST_DIRS = {"test", "tests", "testing", "__tests__"}
EXAMPLE_DIRS = {"example", "examples", "doc", "docs", "documentation", "notebook", "notebooks", "tutorial",
                "tutorials", "demo", "demos", "benchmark", "benchmarks", "gallery"}
TEST_FILE = re.compile(r"^(test_.*|.*_tests?|conftest|runtests)\.\w+$|^.*\.(test|spec)\.[cm]?[jt]sx?$", re.I)
JAVA_TEST_FILE = re.compile(r"(Test|Tests|IT)\.java$")  # case matters: Latest.java is not a test
# Lower is better evidence.
PRIORITY = {"main": 0, "examples": 1, "tests": 2}
DOCSTRING = re.compile(r"^[rRbBuUfF]{0,2}(\"\"\"|''')")

# Language of each extension (".h" is read as C; C and C++ share their comment syntax).
EXT_LANG = {}
for _lang, _exts in LANGUAGES.items():
    for _e in _exts:
        EXT_LANG.setdefault(_e, _lang)
# Comment syntax for languages other than Python, Julia and R:
# (line comment marker, block comment (open, close) or None, string quotes, backslash escapes)
SLASH = ("//", ("/*", "*/"), "\"'`", True)
PERCENT = ("%", None, "\"'", False)  # MATLAB; %{ ... %} blocks are handled line by line
BANG = ("!", None, "\"'", False)  # Fortran
STYLES = {"c": SLASH, "cpp": SLASH, "java": SLASH, "rust": SLASH, "javascript": SLASH, "typescript": SLASH,
          "modelica": SLASH, "matlab": PERCENT, "fortran": BANG}
# Fixed-form Fortran: a C, c, * or ! in the first column makes the whole line a comment.
FIXED_FORM = {".f", ".for", ".f77", ".F", ".FOR"}
# A string literal that could be a variable name, for profiles ("t2m", 'air_temperature').
NAME_LITERAL = re.compile(r"""["']([A-Za-z][A-Za-z0-9_]{1,100})["']""")
MAX_PROFILE = 100  # names kept per claim


def where(rel):
    """'tests', 'examples' or 'main' for a path relative to the repository root."""
    parts = rel.replace(os.sep, "/").lower().split("/")
    if TEST_FILE.match(parts[-1]) or JAVA_TEST_FILE.search(rel) or any(p in TEST_DIRS for p in parts[:-1]):
        return "tests"
    if any(p in EXAMPLE_DIRS for p in parts[:-1]):
        return "examples"
    return "main"


def strip_comment(line):
    """The line up to a # that is outside string literals."""
    if "#" not in line:
        return line
    quote, i = None, 0
    while i < len(line):
        ch = line[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#":
            return line[:i]
        i += 1
    return line


def code_lines(lines, ext):
    """Yield (line number, stripped line, code part) for lines holding code.

    Skips blank lines and comments. For Python, Julia and R that means # comments, Julia #= =#
    block comments, and docstrings or other multi-line strings (Python \"\"\" and ''', Julia \"\"\").
    Other languages use the comment syntax in STYLES.
    """
    style = STYLES.get(EXT_LANG.get(ext))
    if style:
        yield from _styled_code_lines(lines, ext, style)
        return
    triple = {".py": ('"""', "'''"), ".jl": ('"""',)}.get(ext, ())
    block = None  # closing delimiter of the docstring or block comment we are inside
    for i, line in enumerate(lines, 1):
        s = line.strip()
        if block:
            if block in s:
                block = None
            continue
        if not s:
            continue
        if ext == ".jl" and s.startswith("#="):
            if "=#" not in s[2:]:
                block = "=#"
            continue
        if s.startswith("#"):
            continue
        m = DOCSTRING.match(s) if triple else None
        if m and m.group(1) in triple:
            if s.count(m.group(1)) == 1:
                block = m.group(1)
            continue
        code = strip_comment(line)
        for q in triple:
            if code.count(q) % 2:  # a multi-line string starts here; what follows is text, not code
                block = q
                code = code[:code.index(q)]
                break
        if code.strip():
            yield i, s, code


def strip_styled(line, style, in_block):
    """(code part, still inside a block comment) for one line in a language from STYLES.

    Comment markers inside string literals are kept: "https://..." is not a // comment.
    String literals are assumed to end on the line they start.
    """
    marker, block, quotes, escapes = style
    out, quote, i, n = [], None, 0, len(line)
    while i < n:
        if in_block:
            j = line.find(block[1], i)
            if j < 0:
                return "".join(out), True
            i, in_block = j + len(block[1]), False
            out.append(" ")
            continue
        ch = line[i]
        if quote:
            out.append(ch)
            if escapes and ch == "\\":
                out.append(line[i + 1:i + 2])
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in quotes:
            quote = ch
            out.append(ch)
        elif line.startswith(marker, i):
            break
        elif block and line.startswith(block[0], i):
            in_block = True
            i += len(block[0])
            continue
        else:
            out.append(ch)
        i += 1
    return "".join(out), in_block


def _styled_code_lines(lines, ext, style):
    in_block = False
    matlab_block = False  # MATLAB %{ ... %} block comments sit on lines of their own
    for i, line in enumerate(lines, 1):
        s = line.strip()
        if style is PERCENT:
            if matlab_block:
                matlab_block = s != "%}"
                continue
            if s == "%{":
                matlab_block = True
                continue
        if ext in FIXED_FORM and line[:1] in "cC*!":
            continue
        code, in_block = strip_styled(line, style, in_block)
        if code.strip():
            yield i, s, code


def source_files(repo_dir, exts):
    for root, dirs, files in os.walk(repo_dir):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith("."))
        for fn in sorted(files):
            if os.path.splitext(fn)[1] not in exts or fn.endswith(SKIP_SUFFIXES):
                continue
            path = os.path.join(root, fn)
            if os.path.islink(path) or os.path.getsize(path) > MAX_BYTES:
                continue
            yield path


def file_profile(vocab, term, code):
    """Profile entries for one format in one file's code: "cf:air_temperature", "cf_conventions"…"""
    literals = set(NAME_LITERAL.findall(code))
    out = set()
    for pid, names, rx in vocab.profiles.get(term, ()):
        out.update(pid + ":" + n for n in literals & names)
        if rx and rx.search(code):
            out.add(pid)
    return out


def claims(vocab, repo_dir):
    """One claim per (term, role) with a count of call sites and the best line as evidence.

    The evidence line is the first one in main code, else in examples, else in tests; "where"
    says which. A claim found only in tests or examples has where != "main".

    A read or write of a format that has profiles (vocab/profiles.yml) in main code also gets
    "profile": the variable names and conventions found in the code of the same file.
    """
    exts = {e for _, _, es, _ in vocab.code for e in es}
    found, per_lang = {}, Counter()
    for path in source_files(repo_dir, exts):
        ext = os.path.splitext(path)[1]
        lang = EXT_LANG.get(ext, ext)
        if per_lang[lang] >= MAX_FILES:
            continue
        per_lang[lang] += 1
        rel = os.path.relpath(path, repo_dir)
        place = where(rel)
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except OSError:
            continue
        code_parts, here = [], set()
        for i, s, code in code_lines(lines, ext):
            code_parts.append(code)
            for term, role, term_exts, rx in vocab.code:
                if ext in term_exts and rx.search(code):
                    c = found.get((term, role))
                    if not c:
                        c = found[(term, role)] = {"term": term, "role": role, "method": "code", "weak": False,
                                                   "count": 0}
                    c["count"] += 1
                    here.add((term, role))
                    if "where" not in c or PRIORITY[place] < PRIORITY[c["where"]]:
                        c.update(evidence=s[:180], file=rel, line=i, where=place)
        if place == "main":
            joined = None
            for term, role in here:
                if term in vocab.profiles and role in ("reads", "writes"):
                    joined = joined if joined is not None else "".join(code_parts)
                    found[(term, role)].setdefault("profile", set()).update(file_profile(vocab, term, joined))
    for c in found.values():
        if "profile" in c:
            if c["profile"]:
                c["profile"] = sorted(c["profile"])[:MAX_PROFILE]
            else:
                del c["profile"]
    return list(found.values()), sum(per_lang.values())
