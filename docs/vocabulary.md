# The vocabulary

Everything Plug Map recognises is defined in YAML:

| File | Applies to |
|---|---|
| `vocab/core.yml` | every category: general and cross-domain formats, sources, ecosystems |
| `vocab/packs/<name>.yml` | categories that list `<name>` under `pack:` in `config/categories.yml` |
| `vocab/proposals.yml` | nothing yet: candidate terms waiting for review (see [ai.md](ai.md)) |

After any edit, run:

```bash
python -m plugmap validate                      # structure, kinds, roles, regexes compile
python -m unittest tests.test_vocab -v          # pattern regression tests
python -m plugmap run --category "…"            # re-extract (reuses cached clones)
```

## A term

```yaml
- id: entsoe                      # unique across all files; lowercase, used in data/claims
  label: ENTSO-E Transparency     # shown on the site
  kind: source                    # format | protocol | standard | source | ecosystem | generic
  dependencies:                   # package names that imply this term (any language, case-insensitive,
  - entsoe-py                     #   _ and - treated the same)
  weak_dependencies: []           # hints only: recorded with weak: true, not shown or counted
  readme: entso-?e                # regex, case-insensitive, matched per README line
  home_repos: []                  # catalog project names that ARE this term (never "use" themselves)
  code:                           # regexes for calls in source code (case-sensitive)
  - role: pulls                   # reads | writes | speaks | pulls
    languages: [python]           # python julia r c cpp java matlab modelica rust javascript typescript fortran
    pattern: '\bEntsoe(Pandas|Raw)Client\s*\('
```

All fields except `id`, `label` and `kind` are optional. A term with only `readme` works; it just never gets a direction.

### Kinds

| kind | meaning | counted as a "plug"? |
|---|---|---|
| `format` | a file or data format (NetCDF, MATPOWER case) | yes |
| `protocol` | a wire or API protocol (OCPP, Modbus, MQTT) | yes |
| `standard` | a data model or schema standard (CIM, IAMC) | yes |
| `source` | a data provider or API (ERA5, ENTSO-E, EIA) | yes |
| `ecosystem` | another tool whose data model you build on (PyPSA, pvlib) | yes |
| `generic` | ubiquitous formats (CSV, JSON, YAML, Excel) | no: shown on tool pages, excluded from plug counts and upstream/downstream |

### Roles (code patterns only)

- `reads`, `writes`: file or data I/O. Used for upstream and downstream.
- `speaks`: implements or talks a protocol.
- `pulls`: fetches from a data source or API.

Dependency and README claims get the role `uses` (direction unknown).

## Writing good patterns

**Code patterns** should match a *call*, not a word. Anchor with `\b` and require the `(`:

```yaml
pattern: '\.to_netcdf\s*\(|netCDF4\.Dataset\s*\([^)]*[''"](w|a)[''"]'
```

**Separate reads from writes when one function does both.** Look at the mode argument. The reads pattern excludes write modes with a negative lookahead:

```yaml
- role: reads
  pattern: '\bHDFStore\s*\((?![^)]*mode\s*=\s*[''"][wa][''"])'
- role: writes
  pattern: '\bHDFStore\s*\([^)]*mode\s*=\s*[''"][wa][''"]'
```

Add a case to `tests/test_vocab.py` for each fix like this, so it stays fixed.

**README patterns** run per line on cleaned text (badges, images, HTML and code blocks removed). Keep them specific: `\beia\b` rather than `eia`. For `kind: ecosystem`, a match also needs a usage word on the same line ("based on", "uses", "export", "compatible", …; see `settings.ecosystem_usage_words` in `core.yml`). That keeps "thanks to the PyPSA community" from counting.

**Other languages.** Fortran is case-insensitive, so start Fortran patterns with `(?i)`. C and C++ share most I/O libraries (netCDF-C, HDF5, GDAL), so list both: `languages: [c, cpp]`. Data-source patterns that match an API host or dataset name, such as `api\.eia\.gov`, work in every language. General formats (CSV, JSON, Excel, YAML) are only scanned in Python, Julia and R.

**YAML quoting:** use single quotes around regexes. Inside them, write a literal single quote as `''`. Backslashes need no escaping in single quotes.

## Adding a pack

1. Create `vocab/packs/<name>.yml` with `layer: <name>` (the same as the file name) and a `terms:` list.
2. Add `<name>` to `pack:` for the categories it applies to in `config/categories.yml`.
3. Run `python -m plugmap validate`. Term `id`s must be unique across all files.

The site picks up the new layer automatically.

## Checking precision

After a run, sample claims for a term and read the evidence:

```bash
grep '"term": "cim"' data/claims/energy-systems.jsonl | head
```

If a pattern is too loose, tighten it, add a test, and re-run. The site shows the evidence of every claim, so users can spot mistakes as well.
