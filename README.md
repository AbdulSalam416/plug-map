# Plug Map

**Which open-source sustainability tools can exchange data?**

Plug Map goes through the [OpenSustain.tech](https://opensustain.tech) catalog one category at a time. For each tool it records which data formats, protocols, standards, data sources and code ecosystems the tool **reads**, **writes**, **speaks** or **pulls**. Every record is a *claim* with evidence: the file and line of code, the dependency it declares, or the README sentence it came from.

The result is a dataset (`data/claims/*.jsonl`) and a static website (`site/`) for browsing it: categories, a tool's plugs, and which tools sit upstream or downstream of it.

The first three catalog categories are mapped and included: Renewable Energy, Energy Systems and Energy Storage. That is 520 tools and about 3,200 claims.

```
catalog CSV ──► harvest (sparse git clones) ──► extract (code · dependencies · README)
                                                     │  rules live in vocab/*.yml
                                                     ▼
                       site/data/*.json ◄── aggregate ◄── data/claims/*.jsonl
                                                     ▲
             optional AI step: README ──► proposed new terms ──► vocab/proposals.yml ──► human review
```

---

## Quick start (macOS)

You need **Python 3.9 or newer** and **git**. Both come with Apple's command line tools. If `git --version` asks you to install them, accept.

```bash
cd plug-map

# 1. Create an isolated Python environment and install the one dependency (PyYAML)
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Look at the site with the data that is already included
python -m plugmap serve
# open http://localhost:8080   (Ctrl+C to stop)
```

That's it for viewing. The data is committed, so nothing needs downloading.

Activate the environment (`source .venv/bin/activate`) each time you open a new terminal.

### Re-map a category (downloads repositories)

```bash
python -m plugmap catalog                              # fetch the catalog, list categories and counts
python -m plugmap run --category "Renewable Energy"    # clone, extract, rebuild site data
python -m plugmap run --all                            # every category that has a vocabulary pack
python -m plugmap status                               # which categories are mapped
```

A first run of all three energy categories clones about 530 repositories into `cache/` (about 1 GB) and takes 10–20 minutes, depending on your connection. Later runs reuse the cache. Add `--refresh` to pull fresh copies.

**Nothing from a cloned repository is ever executed.** Files are only read as text.

### All commands

| Command | What it does |
|---|---|
| `python -m plugmap catalog [--refresh]` | Download the OpenSustain.tech catalog CSV; list categories |
| `python -m plugmap run --category NAME` | Map one category (repeatable) and rebuild site data |
| `python -m plugmap run --all` | Map every category with a vocabulary pack in `config/categories.yml` |
| `python -m plugmap site` | Rebuild `site/data/` from `data/` (fast, no network needed) |
| `python -m plugmap validate` | Check the vocabulary files |
| `python -m plugmap propose --category NAME` | Optional AI step: propose new vocabulary terms |
| `python -m plugmap status` | Show which categories are mapped |
| `python -m plugmap serve [--port 8080]` | Serve the site locally |

Run `python -m plugmap <command> --help` for options.

### Run the tests

```bash
python -m unittest discover -s tests -t . -v
```

The tests need no network and no API keys. The AI tests use a fake model.

---

## The optional AI step

The rules only find what the vocabulary knows. The AI step reads the READMEs of tools where the rules found the least, and proposes terms the vocabulary is missing. It **never edits the vocabulary itself**: proposals go to `vocab/proposals.yml` for a person to accept or reject.

```bash
cp .env.example .env          # then open .env and paste your key after OPENAI_API_KEY=
python -m plugmap propose --category "Renewable Energy" --limit 20
```

- The default provider is **OpenAI** (Responses API, model set in `config/categories.yml`). Use `--provider anthropic` with `ANTHROPIC_API_KEY` to use Claude instead. `--model` overrides the model.
- `.env` is git-ignored. **Never put a key in any other file.** Keys in the environment take priority over `.env`.
- Safeguards:
  - README text is treated as untrusted. It is fenced with a random token, and the model is told not to follow instructions inside it.
  - Every proposal must quote the README; proposals whose quote isn't found word for word, or that only repeat the term's name, are dropped.
  - Terms already in the vocabulary are dropped.
- Cost: each README is capped at 12,000 characters (about 3,000 tokens), so a 20-tool run sends roughly 80,000 input tokens. Check your provider's pricing for the model you use.

See [docs/ai.md](docs/ai.md) for details and how to review proposals.

---

## Repository layout

```
plug-map/
├── README.md               you are here
├── requirements.txt        PyYAML
├── .env.example            template for API keys (copy to .env)
├── render.yaml             one-click static deploy on Render
├── config/
│   └── categories.yml      categories in rollout order, which vocabulary pack each uses, AI settings
├── vocab/
│   ├── core.yml            terms for every category (NetCDF, Parquet, ERA5, OpenStreetMap, …)
│   ├── packs/energy.yml    energy terms (PyPSA, MATPOWER, CIM, OCPP, ENTSO-E, …)
│   └── proposals.yml       AI-proposed terms awaiting review
├── plugmap/                the Python package (standard library + PyYAML only)
│   ├── cli.py              commands
│   ├── catalog.py          fetch the catalog, select a category
│   ├── harvest.py          sparse, shallow git clones
│   ├── extract/            three readers: code.py, deps.py, readme.py
│   ├── purl.py             Package-URL for each tool
│   ├── pipeline.py         run one category end to end
│   ├── aggregate.py        build site/data from data/
│   ├── vocab.py            load, compile and validate the vocabulary
│   └── ai.py               the optional AI step
├── data/
│   ├── claims/<slug>.jsonl one claim per line: the core dataset
│   ├── tools/<slug>.json   one record per tool (including tools that couldn't be read)
│   └── catalog_counts.json catalog size per category
├── site/                   static website: index.html, app.js, styles.css, data/
├── tests/                  unittest suite and a small fixture repository
└── docs/                   detailed documentation (start with architecture.md)
```

`cache/` (cloned repositories) and `.env` are created on your machine and are git-ignored.

---

## Setting up git

```bash
cd plug-map
git init
git add .
git commit -m "Plug Map: first three energy categories mapped"
# create an empty repository on GitHub, then:
git remote add origin git@github.com:<you>/plug-map.git
git branch -M main
git push -u origin main
```

Before your first commit, check that `git status` doesn't list `.env` or `cache/`. The `.gitignore` excludes both.

The included GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push. It validates the vocabulary, runs the tests, and checks that `site/data` matches `data/`.

## Deploying the site

`site/` is a plain static site with no build step. On [Render](https://render.com): **New → Blueprint**, then pick the repository. `render.yaml` publishes `site/`. It is also published to GitHub Pages by `.github/workflows/pages.yml` on every push to `main` (one-time setup: Settings → Pages → Source: **GitHub Actions**).

To update the live site, re-run locally, commit `data/` and `site/data/`, and push. See [docs/deploy.md](docs/deploy.md).

---

## Documentation

| Doc | Read it to… |
|---|---|
| [docs/architecture.md](docs/architecture.md) | understand the pipeline and design choices |
| [docs/vocabulary.md](docs/vocabulary.md) | add or fix a term, write patterns |
| [docs/claims.md](docs/claims.md) | use the dataset (file formats, every field) |
| [docs/adding-a-category.md](docs/adding-a-category.md) | map the next category |
| [docs/ai.md](docs/ai.md) | run the AI step and review proposals |
| [docs/deploy.md](docs/deploy.md) | publish and update the site |
| [docs/findings.md](docs/findings.md) | what the first three categories show |

## Troubleshooting

- **`ModuleNotFoundError: No module named 'yaml'`**: the virtual environment isn't active. Run `source .venv/bin/activate`, or install with `pip install -r requirements.txt`.
- **The site says "Could not load the data"**: open it through `python -m plugmap serve`, not by double-clicking `index.html`. Browsers block loading data files from `file://`.
- **`Address already in use`**: another program uses port 8080. Run `python -m plugmap serve --port 8090`.
- **Some tools "could not be read"**: their repository moved, is private, or isn't hosted on git. The reason is in `data/tools/<slug>.json` (`error`).
- **`OPENAI_API_KEY is not set`**: create `.env` from `.env.example` and paste the key, or run `export OPENAI_API_KEY=...` in the terminal.
- **`API error 401`**: the key is wrong or revoked. Create a new one in your provider's console.
- **Clones are slow or time out**: lower parallelism with `--workers 4`. Re-running continues from the cache.

## License

- **Code, vocabulary and docs:** MIT, see [`LICENSE`](LICENSE).
- **Data** (`data/` and `site/data/`): CC BY 4.0, see [`LICENSE-DATA.md`](LICENSE-DATA.md). Some fields come from elsewhere and keep their own licence. Star counts and last-commit dates come from ecosyste.ms (CC BY-SA 4.0), and evidence quotes come from each tool's repository.

## Citing Plug Map

Use [`CITATION.cff`](CITATION.cff); GitHub shows it as "Cite this repository". Please say which data build you used: the `built` date in `site/data/index.json`.
