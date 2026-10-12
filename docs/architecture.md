# Architecture

Plug Map is a small batch pipeline that produces a dataset, plus a static website that displays it. It has no server, no database, and one Python dependency (PyYAML).

```
config/categories.yml ─┐
                       ▼
 1. select     catalog.py     OpenSustain.tech projects.csv  →  rows for one category
 2. harvest    harvest.py     sparse, shallow git clone per tool  →  cache/repos/
 3. extract    extract/*.py   three readers apply vocab/*.yml  →  claims
                 code.py        I/O calls in 12 languages          role: reads | writes | speaks | pulls
                 deps.py        dependency manifests            role: uses
                 readme.py      README sentences                role: uses
               purl.py        Package-URL for each tool
 4. record     pipeline.py    data/claims/<slug>.jsonl + data/tools/<slug>.json   (committed)
 5. aggregate  aggregate.py   site/data/index.json + site/data/<slug>.json        (committed)
 6. view       site/          static HTML/JS reads site/data/

 optional      ai.py          README → model → verified proposals → vocab/proposals.yml → human review
```

## Design decisions

**Knowledge lives in data, not code.** No Python file names a format, library or standard. Everything the extractors recognise is defined in `vocab/core.yml` and `vocab/packs/*.yml`, so improving recall or fixing a false positive means editing YAML, by pull request. `python -m plugmap validate` and the CI keep those files well-formed.

**Category by category.** The catalog has 13 categories and about 2,800 projects. Each category is mapped with the core vocabulary plus the pack(s) listed for it in `config/categories.yml`. That keeps each vocabulary focused: energy protocols aren't searched for in glaciology tools. The order of `categories` is the rollout order shown on the site.

**Claims, not conclusions.** The unit of data is one claim: *tool X reads/writes/speaks/pulls/uses term Y, because of evidence Z*. Claims carry their method and evidence, so users can judge them and the site can rank or filter them. Conclusions such as upstream and downstream are computed later, in the browser, from claims.

**Three readers with different strengths.**

| Reader | Finds | Direction? | Precision |
|---|---|---|---|
| Code calls | `to_netcdf(`, `pd.read_parquet(`, `EntsoePandasClient(`… | yes | high (30/30 in a spot check) |
| Dependencies | `netcdf4` in requirements, `PowerModels` in Project.toml… | no | high, but a dependency may be unused |
| README | "supports CIM", "data from ERA5"… | no | lower; ecosystem names need a usage word on the same line |

Weak dependencies (e.g. `xarray`, which suggests but doesn't prove NetCDF) are recorded with `weak: true` and left out of the site.

**Safety.** Repositories are third-party content:
- Clones are `--depth 1 --filter=blob:none` with a sparse checkout of top-level docs and manifests plus source files in the languages listed in `LANGUAGES` (`plugmap/vocab.py`). Jupyter notebooks are left out: saved outputs make them large (1.4 GB for the energy categories), and a call in one would only count as an example. Minified bundles, `node_modules/`, `vendor/` and `third_party/` are left out. When `SPARSE` changes, existing clones are updated at the commit already recorded, so claims stay pinned.
- Nothing is imported, built or executed. Files over 400 KB and symlinks are skipped.
- `GIT_TERMINAL_PROMPT=0` means a private or moved repository fails rather than asking for credentials. `GIT_LFS_SKIP_SMUDGE=1` keeps Git LFS from downloading large data files.
- In the AI step, README text is fenced with a random token and treated as data.
- The site inserts all repository text as text nodes, never as HTML.

**Committed outputs.** `data/` and `site/data/` are committed. Viewing or deploying the site needs no cloning, and git history shows how the map changed. `cache/` (cloned repositories, about 1 GB) is not committed.

## Modules

| File | Responsibility |
|---|---|
| `plugmap/paths.py` | folder layout, config loading, `.env` loading |
| `plugmap/catalog.py` | sparse-clone the catalog repository, read `projects.csv`, filter by category |
| `plugmap/harvest.py` | parallel clones into `cache/repos/<host>__<owner>__<repo>` (`github`, `gitlab`, `bitbucket` for the big hosts, the full host name otherwise), reused across runs |
| `plugmap/vocab.py` | load core + packs, compile patterns, build the dependency index, `validate()` |
| `plugmap/extract/deps.py` | parsers for requirements*.txt, pyproject.toml (including optional dependencies and dependency groups), setup.py, setup.cfg, environment*.yml, Pipfile, package.json, composer.json, Gemfile, Cargo.toml, Project.toml (Julia, including weak deps), go.mod, DESCRIPTION (R), pom.xml, build.gradle |
| `plugmap/extract/readme.py` | strip badges, images, HTML and code blocks; match line by line |
| `plugmap/extract/code.py` | walk source files (up to 4,000 per language per repo), skip comments (in each language's syntax), docstrings, vendored folders and minified bundles, class each file as main code, examples or tests, one claim per (term, role) with a count and the best evidence line (main code first) |
| `plugmap/purl.py` | Package-URL from the declared package name, falling back to `pkg:github/...` |
| `plugmap/pipeline.py` | run a category; exclude "home" terms (PyPSA doesn't *use* PyPSA) |
| `plugmap/aggregate.py` | compact JSON for the site; catalog totals cache |
| `plugmap/ai.py` | providers (OpenAI Responses API, Anthropic Messages API), prompt, verification, proposals file |
| `plugmap/cli.py` | the `python -m plugmap` commands |

## The site

`site/index.html`, `site/app.js` and `site/styles.css` are a dependency-free single page with hash routing:

- `#/`: catalog overview, category cards, cross-category bridges, how facts were found
- `#/category/<slug>`: coverage, read/write chart, sources, ecosystems, protocols, filterable tool list
- `#/tool/<host/owner/repo>`: claims grouped by role, each linking to the exact file and line at the commit that was read; upstream and downstream tools
- `#/vocabulary`: proposals and every term per layer with usage counts
- `#/about`: method and caveats

**Upstream and downstream** use code claims only, because direction is needed, and only calls in the tool's own code: a call found only in tests or examples (`where` in the claims) is shown on the tool page but not counted. Tool B is upstream of A if B writes a specific term (not CSV or JSON) that A reads. Matches are weighted by inverse document frequency, `log(N / tools using term)`, so a shared MATPOWER file counts for more than shared NetCDF.

**Profiles** (`vocab/profiles.yml`) say what's inside a file beyond its format. For a read or write of NetCDF, Zarr or HDF5 in main code, the code reader records the CF standard names, ERA5 variable names and CF conventions marker found as string literals in the code of the same file (`profile` on the claim, `pf` on the site). Neighbours that share a profile entry are listed first and show the shared names. It's file-scoped on purpose: names in another module aren't linked to the call, so a missing match is not evidence of a mismatch.

The only external resource is Google Fonts; the page falls back to system fonts without it.
