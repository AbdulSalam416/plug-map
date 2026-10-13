# Mapping the next category

The planned order is in `config/categories.yml`. The three energy categories are done. Next is the Earth science group: Atmosphere, Climate Change, Hydrosphere and Cryosphere.

## 1. Look at the category first

```bash
python -m plugmap catalog
python -m plugmap run --category "Atmosphere"
```

Running a category with only the core vocabulary is a useful baseline: core already covers NetCDF, HDF5, Zarr, Parquet, GeoTIFF, Shapefile/GeoPackage, ERA5/Copernicus, Earth observation imagery, OpenStreetMap and more. GRIB is an obvious first term for an Earth science pack. Open the site and check:

- coverage: what share of tools show any plug?
- the tools with zero plugs: what do their READMEs and code talk about?

## 2. Find what the vocabulary is missing

Two ways, and they work well together:

- **AI proposals:** `python -m plugmap propose --category "Atmosphere" --limit 30` reads the READMEs of the least-covered tools and writes candidate terms with quotes to `vocab/proposals.yml` (see [ai.md](ai.md)).
- **By hand:** skim the code of a few zero-plug tools, and look at which dependencies are common in the category:

```bash
python - <<'EOF'
import collections, os
from plugmap.extract.deps import dependencies
from plugmap.harvest import repo_dir, top_files
from plugmap.catalog import projects
c = collections.Counter()
for r in projects("Atmosphere"):
    d = repo_dir(r["git_url"])
    if d and os.path.isdir(d):
        c.update(dependencies(d, top_files(d)))
for name, n in c.most_common(60): print(n, name)
EOF
```

## 3. Create the pack

Create `vocab/packs/earth_science.yml`:

```yaml
# Earth science pack: Atmosphere, Climate Change, Hydrosphere, Cryosphere.
layer: earth_science
terms:
- id: cf_conventions
  label: CF conventions
  kind: standard
  dependencies: [cf-xarray, cfdm, cf-python]
  readme: '\bCF[- ]conventions?\b|\bCF[- ]compliant\b'
- id: cmip
  label: CMIP / ESGF
  kind: source
  dependencies: [intake-esm, esgf-pyclient]
  readme: '\bCMIP[56]?\b|\bESGF\b'
  code:
  - role: pulls
    languages: [python]
    pattern: '\bSearchConnection\s*\(|intake\.open_esm_datastore\s*\('
```

These are examples to start from; write patterns from what the category actually uses. See [vocabulary.md](vocabulary.md).

For each format term, decide whether it is a domain format and set `semantic: true` if so (see [vocabulary.md](vocabulary.md#domain-formats-semantic-true)). Without it, links through the term show as "Container format only". If the category mostly exchanges data through containers, consider a profile in `vocab/profiles.yml` for the variable or column names it uses.

Then, in `config/categories.yml`:

```yaml
  - {name: Atmosphere, pack: [earth_science], status: next}
```

## 4. Run, check, commit

```bash
python -m plugmap validate
python -m unittest discover -s tests -t .
python -m plugmap run --category "Atmosphere" --category "Climate Change" --category "Hydrosphere" --category "Cryosphere"
python -m plugmap serve        # check coverage, spot-check evidence of new terms
git add vocab config data site/data
git commit -m "Map Earth science categories"
```

Spot-check precision before committing. Open ten claims of each new term on the site and read the evidence. Tighten any pattern that's wrong.

## Notes

- A category with data in `data/claims/` shows as **mapped** automatically. `status` only matters before that.
- A tool can appear in only one catalog category, but terms are shared. The overview's "bridges" panel shows terms used across mapped categories.
- Tools whose repositories can't be cloned (moved, private, not git) are kept in `data/tools/` with `read: false` and the error.
