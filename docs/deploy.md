# Deploying the site

The site is the `site/` folder: `index.html`, `app.js`, `styles.css` and `data/*.json`. It needs no build step and no server code, so any static host works.

## Locally

```bash
python -m plugmap serve            # http://localhost:8080
```

Browsers won't load the data from `file://`, so serve the folder instead of double-clicking `index.html`. Any static server works, e.g. `python3 -m http.server -d site 8080`.

## Render

1. Push the repository to GitHub (see the README).
2. In Render: **New → Blueprint**, then select the repository. Render reads `render.yaml` and creates a static site that publishes `./site`.
3. Each push to the default branch redeploys.

Without the Blueprint: **New → Static Site**, leave the build command empty, and set the publish directory to `site`.

## GitHub Pages

`.github/workflows/pages.yml` publishes the `site/` folder on every push to `main` (or on demand from the Actions tab).

One-time setup: Settings → Pages → Build and deployment → Source: **GitHub Actions**.

The site uses relative paths and hash routing, so it works at the project URL (`https://<user>.github.io/plug-map/`) without changes. GitHub Pages doesn't allow custom headers; the `?v=` query on `styles.css` and `app.js` in `index.html` is what keeps browsers from pairing new HTML with an old cached script, so bump it when either file changes.

## Updating the data

The pipeline runs on your machine, because it needs `cache/` and network access to clone repositories:

```bash
python -m plugmap run --all        # or --category "…"
python -m plugmap serve            # check
git add data site/data vocab
git commit -m "Refresh map"
git push                           # the host redeploys
```

CI checks that `site/data` is in sync with `data/`. If it fails, run `python -m plugmap site` and commit.

## Size

The three energy categories produce about 600 KB of JSON. Every mapped category file is loaded at start, because upstream and downstream span categories. Once the whole catalog is mapped (roughly 5 MB), consider loading category files on demand and precomputing neighbours in `aggregate.py`.
