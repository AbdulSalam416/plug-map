"""End to end: map a category made of the fixture repository, then build the site data.
Cloning and the catalog are replaced by fakes, so no network is needed."""
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from plugmap import aggregate, harvest, pipeline
from plugmap.harvest import repo_dir, top_files

REPO = os.path.join(os.path.dirname(__file__), "fixtures", "sample_repo")
URL = "https://github.com/example/sample-solar"


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        d = {k: os.path.join(self.tmp, k) for k in ("claims", "tools", "site")}
        row = {"git_url": URL, "project_names": "sample-solar", "category": "Renewable Energy",
               "sub_category": "Photovoltaics and Solar Energy", "description": "Synthetic fixture",
               "stars": "12.0", "latest_commit_activity": "2026-10-01 10:00:00"}
        rec = {"url": URL, "dir": REPO, "ok": True, "files": top_files(REPO), "commit": "abc123", "error": None}
        self.patches = [
            mock.patch.object(pipeline, "CLAIMS_DIR", d["claims"]),
            mock.patch.object(pipeline, "TOOLS_DIR", d["tools"]),
            mock.patch.object(pipeline.catalog, "projects", lambda name: [row]),
            mock.patch.object(pipeline.harvest, "harvest_many", lambda urls, **kw: {URL: rec}),
            mock.patch.object(aggregate, "CLAIMS_DIR", d["claims"]),
            mock.patch.object(aggregate, "TOOLS_DIR", d["tools"]),
            mock.patch.object(aggregate, "SITE_DATA", d["site"]),
            mock.patch.object(aggregate, "PROPOSALS", os.path.join(self.tmp, "proposals.yml")),
            mock.patch.object(aggregate, "category_counts", lambda: {"Renewable Energy": 1}),
        ]
        for p in self.patches:
            p.start()
        self.d = d

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.tmp)

    def test_category_to_site_data(self):
        res = pipeline.run_category("Renewable Energy", log=lambda *a: None)
        self.assertEqual((res["tools"], res["read"]), (1, 1))
        with open(os.path.join(self.d["claims"], "renewable-energy.jsonl"), encoding="utf-8") as f:
            claims = [json.loads(line) for line in f]
        self.assertTrue(all(c["repo"] == URL and c["commit"] == "abc123" for c in claims))
        self.assertTrue(all(c["tool"] == "pkg:pypi/sample-solar-tools" for c in claims))

        index = aggregate.build_site_data(log=lambda *a: None)
        cat = next(c for c in index["cats"] if c["slug"] == "renewable-energy")
        self.assertEqual((cat["s"], cat["read"], cat["total"]), ("mapped", 1, 1))
        with open(os.path.join(self.d["site"], "renewable-energy.json"), encoding="utf-8") as f:
            tool = json.load(f)["tools"][0]
        self.assertEqual((tool["n"], tool["st"], tool["a"], tool["k"]), ("sample-solar", 12, "2026-10-01", "abc123"))
        rows = {(c["i"], c["r"], c["m"]): c for c in tool["cl"]}
        self.assertEqual(rows[("hdf5", "writes", "code")]["x"], "tests", "test-only calls are marked for the site")
        self.assertNotIn("x", rows[("netcdf", "reads", "code")])
        self.assertFalse([c for c in tool["cl"] if c["e"] == "declares dependency xarray"], "weak claims stay out")


class RepoDirTest(unittest.TestCase):
    def test_hosts_do_not_collide(self):
        a = repo_dir("https://gitlab.com/org/tool")
        b = repo_dir("https://gitlab.example.org/org/tool")
        self.assertNotEqual(a, b)
        self.assertEqual(os.path.basename(a), "gitlab__org__tool", "existing cache folders keep their names")
        self.assertEqual(os.path.basename(repo_dir("https://github.com/PyPSA/pypsa.git")), "github__PyPSA__pypsa")
        self.assertIsNone(repo_dir("not a url"))

    def test_long_names_stay_unique(self):
        long = "https://github.com/org/" + "x" * 200
        a, b = repo_dir(long + "a"), repo_dir(long + "b")
        self.assertNotEqual(a, b)
        self.assertLessEqual(len(os.path.basename(a)), 150)

    def test_git_never_prompts_or_fetches_lfs(self):
        with mock.patch.object(harvest.subprocess, "run") as run:
            harvest._git(["status"])
        env = run.call_args.kwargs["env"]
        self.assertEqual((env["GIT_TERMINAL_PROMPT"], env["GIT_LFS_SKIP_SMUDGE"]), ("0", "1"))


if __name__ == "__main__":
    unittest.main()
