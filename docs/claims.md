# Data formats

## `data/claims/<slug>.jsonl`: the dataset

One JSON object per line, one claim each. Example:

```json
{"term": "netcdf", "role": "writes", "method": "code", "weak": false, "count": 2,
 "evidence": "self.ds.to_netcdf(_path)", "file": "pypsa/network/io.py", "line": 1299, "where": "main",
 "tool": "pkg:pypi/pypsa", "repo": "https://github.com/PyPSA/PyPSA", "layer": "core",
 "commit": "6c45594596…"}
```

| field | always | meaning |
|---|---|---|
| `term` | yes | vocabulary id (see `vocab/*.yml`) |
| `role` | yes | `reads`, `writes`, `speaks`, `pulls` (from code) or `uses` (dependency, README) |
| `method` | yes | `code`, `dependency` or `readme` |
| `weak` | yes | `true` for hint-only dependencies (e.g. xarray → NetCDF); the site ignores these |
| `evidence` | yes | the code line (≤180 chars), `declares dependency <name>`, or the README line (≤220 chars) |
| `file` | code, readme | path within the repository |
| `line` | code | 1-based line number of the evidence |
| `count` | code | number of matching lines in the repository for this term and role, wherever they are |
| `where` | code | where the evidence was found: `main` (the tool's own code), `examples` (examples, docs, notebooks, tutorials, demos, benchmarks, gallery) or `tests`. It is `main` whenever any match is in main code. |
| `profile` | code reads/writes of NetCDF, Zarr or HDF5 in main code, when found | sorted list of what's inside the file, from `vocab/profiles.yml`: `cf:<CF standard name>`, `era5:<ERA5 short name>`, or `cf_conventions`. Taken from string literals in the code of the files with the call. At most 100 entries |
| `tool` | yes | Package-URL of the tool |
| `repo` | yes | repository URL from the catalog |
| `layer` | yes | `core` or the pack the term came from |
| `commit` | yes | commit hash that was read; with `file` and `line` this pins the evidence |

To link to the evidence on GitHub: `{repo}/blob/{commit}/{file}#L{line}`. On GitLab: `{repo}/-/blob/{commit}/{file}#L{line}`.

Code claims are deduplicated per (term, role): one row with a `count` and the best evidence: the first match in main code, else in examples, else in tests. A claim with `where` other than `main` was found only in tests or examples. The site shows it but doesn't count it as a read/write direction, because a test that writes a fixture file says little about what the tool itself writes. Comments and docstrings are not scanned. Dependency claims are one per (term, dependency). README claims are one per term.

## `data/tools/<slug>.json`

All catalog projects in the category, including ones that couldn't be read.

| field | meaning |
|---|---|
| `name`, `repo`, `category`, `sub_category`, `description`, `stars`, `last_commit` | from the catalog |
| `read` | whether the repository was cloned |
| `error` | why not, if `read` is false |
| `commit` | commit hash read |
| `source_files` | number of .py/.jl/.R files scanned |
| `purl` | Package-URL |
| `purl_basis` | `declared in pyproject.toml` (or setup.py, package.json, …), or `repository` for the fallback |

Declared package names aren't checked against the registry, so `pkg:pypi/x` means "the manifest says x", not necessarily "x is on PyPI".

## `data/catalog_counts.json`

Number of catalog projects per category at the last catalog fetch. Used when the site is rebuilt offline.

## `site/data/` (generated; don't edit)

Compact versions for the browser, made by `python -m plugmap site`.

- `index.json`: `built`, `catalog_total`, `cats` (`n` name, `slug`, `s` status, `pack`, `total`, `read`), `vocab` (`id → {l label, k kind, layer}`), `layers`, `methods` (claim counts), `proposed`.
- `<slug>.json`: `{category, tools: [...]}`, one entry per tool that was read. Keys are shortened versions of the fields above.

Tool keys:

| key | field | always | meaning |
|---|---|---|---|
| `n` | `name` | yes | project name |
| `u` | `repo` | yes | repository URL |
| `c` | `category` | yes | category |
| `sc` | `sub_category` | yes | sub-category |
| `st` | `stars` | yes | stars |
| `a` | `last_commit` | yes | last activity date |
| `d` | `description` | yes | description, cut to 220 chars |
| `k` | `commit` | yes | commit hash read |
| `p` | `purl` | yes | Package-URL |
| `pb` | `purl_basis` | yes | how the PURL was found; may be `null` |
| `cl` | | yes | claims for this tool (below); may be empty |

Claim keys (weak claims are left out):

| key | field | always | meaning |
|---|---|---|---|
| `i` | `term` | yes | vocabulary id |
| `r` | `role` | yes | `reads`, `writes`, `speaks`, `pulls` or `uses` |
| `m` | `method` | yes | `code`, `dependency` or `readme` |
| `e` | `evidence` | yes | evidence line, cut to 300 chars |
| `f` | `file` | code, readme | path within the repository |
| `l` | `line` | code | 1-based line number |
| `n` | `count` | when > 1 | number of matching lines; read as 1 when absent |
| `x` | `where` | when not `main` | `tests` or `examples`: a code call found only there |
| `pf` | `profile` | when present | profile entries, see above. `index.json` has `profiles`: id → label |

`n` is the name in a tool but the count in a claim. Evidence link: `{u}/blob/{k}/{f}#L{l}`.

## Using the data

```python
import json
claims = [json.loads(l) for l in open("data/claims/energy-systems.jsonl")]
writers = {c["repo"] for c in claims if c["term"] == "matpower" and c["role"] == "writes"}
readers = {c["repo"] for c in claims if c["term"] == "matpower" and c["role"] == "reads"}
print(len(writers), "tools write MATPOWER cases;", len(readers), "read them")
```
