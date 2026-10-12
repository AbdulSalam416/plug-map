"""Command line: python -m plugmap <command>. Run `python -m plugmap --help` for the list."""
import argparse
import http.server
import json
import os
import socketserver
import sys
from functools import partial

from .paths import ROOT, SITE_DATA, load_config


def cmd_catalog(a):
    from . import catalog
    path = catalog.fetch(refresh=a.refresh)
    counts = catalog.category_counts()
    print(f"Catalog: {path}\n{sum(counts.values())} projects in {len(counts)} categories:")
    for name, n in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"  {n:5d}  {name}")


def cmd_run(a):
    from . import aggregate, catalog, pipeline
    catalog.fetch()
    if a.all:
        names = [c["name"] for c in load_config()["categories"] if c.get("pack")]
    elif a.category:
        names = a.category
    else:
        sys.exit("Give --category NAME (repeatable) or --all.")
    for name in names:
        pipeline.run_category(name, refresh=a.refresh, workers=a.workers)
    print("Building site data…")
    aggregate.build_site_data()


def cmd_site(a):
    from . import aggregate
    aggregate.build_site_data()


def cmd_validate(a):
    from .vocab import validate
    problems = validate()
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print("Vocabulary is valid.")


def cmd_propose(a):
    from . import ai
    ai.propose(a.category, limit=a.limit, model=a.model, provider=a.provider)
    if not a.no_site:
        from . import aggregate
        aggregate.build_site_data()


def cmd_status(a):
    from .paths import slugify
    from .paths import TOOLS_DIR
    for c in load_config()["categories"]:
        p = os.path.join(TOOLS_DIR, slugify(c["name"]) + ".json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                tools = json.load(f)
            print(f"  mapped   {c['name']}: {sum(t['read'] for t in tools)}/{len(tools)} tools read")
        else:
            print(f"  {c.get('status', 'queued'):8s} {c['name']}")


class _NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Without a Cache-Control header browsers cache styles.css and app.js by guesswork,
    so after an edit the page can load the new HTML with the old CSS or JS."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def cmd_serve(a):
    site = os.path.join(ROOT, "site")
    if not os.path.exists(os.path.join(SITE_DATA, "index.json")):
        sys.exit("No site data yet: run `python -m plugmap site` first.")
    handler = partial(_NoCacheHandler, directory=site)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", a.port), handler) as httpd:
        print(f"Plug Map on http://localhost:{a.port}  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


def main(argv=None):
    p = argparse.ArgumentParser(prog="python -m plugmap", description="Plug Map: which sustainability tools can exchange data.")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("catalog", help="download the OpenSustain.tech catalog and list its categories")
    s.add_argument("--refresh", action="store_true", help="pull the latest catalog")
    s.set_defaults(func=cmd_catalog)
    s = sub.add_parser("run", help="map one or more categories, then rebuild the site data")
    s.add_argument("--category", action="append", help='catalog category, e.g. "Renewable Energy" (repeatable)')
    s.add_argument("--all", action="store_true", help="every category that has a vocabulary pack in config")
    s.add_argument("--refresh", action="store_true", help="re-clone repositories instead of reusing the cache")
    s.add_argument("--workers", type=int, default=12, help="parallel clones (default 12)")
    s.set_defaults(func=cmd_run)
    s = sub.add_parser("site", help="rebuild site/data from data/claims and data/tools")
    s.set_defaults(func=cmd_site)
    s = sub.add_parser("validate", help="check the vocabulary files")
    s.set_defaults(func=cmd_validate)
    s = sub.add_parser("propose", help="AI step: propose new vocabulary terms from READMEs")
    s.add_argument("--category", required=True)
    s.add_argument("--limit", type=int, default=20, help="number of READMEs to send (default 20)")
    s.add_argument("--provider", choices=["openai", "anthropic"], help="default from config/categories.yml")
    s.add_argument("--model", help="model ID (default from config/categories.yml)")
    s.add_argument("--no-site", action="store_true", help="don't rebuild site data afterwards")
    s.set_defaults(func=cmd_propose)
    s = sub.add_parser("status", help="show which categories are mapped")
    s.set_defaults(func=cmd_status)
    s = sub.add_parser("serve", help="serve the site locally")
    s.add_argument("--port", type=int, default=8080)
    s.set_defaults(func=cmd_serve)
    a = p.parse_args(argv)
    a.func(a)
