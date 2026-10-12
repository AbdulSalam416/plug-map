import os
import unittest
from unittest import mock

from plugmap.extract import code, deps
from plugmap.harvest import top_files
from plugmap.pipeline import extract_tool, home_terms
from plugmap.purl import from_repo_url, purl_for
from plugmap.vocab import Vocabulary, pack_names

REPO = os.path.join(os.path.dirname(__file__), "fixtures", "sample_repo")


class ExtractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vocab = Vocabulary(pack_names())
        cls.files = top_files(REPO)
        cls.claims, cls.nfiles = extract_tool(cls.vocab, REPO, cls.files, "sample-solar")
        cls.by = {(c["term"], c["role"], c["method"]): c for c in cls.claims}

    def test_dependencies_are_parsed_from_all_manifests(self):
        names = deps.dependencies(REPO, self.files)
        for n in ("pandas", "xarray", "netcdf4", "pyarrow", "paho-mqtt", "geopandas", "pvlib"):
            self.assertIn(n, names)

    def test_dependency_claims(self):
        self.assertIn(("netcdf", "uses", "dependency"), self.by)
        self.assertIn(("mqtt", "uses", "dependency"), self.by)
        self.assertIn(("pvlib", "uses", "dependency"), self.by)
        weak = [c for c in self.claims if c["evidence"] == "declares dependency xarray"]
        self.assertTrue(weak and all(c["weak"] for c in weak), "xarray only hints at NetCDF")

    def test_readme_claims_ignore_badges_images_and_code_blocks(self):
        self.assertIn(("era5", "uses", "readme"), self.by)
        self.assertIn(("netcdf", "uses", "readme"), self.by)
        self.assertNotIn(("frictionless", "uses", "readme"), self.by)
        self.assertNotIn(("geojson", "uses", "readme"), self.by)
        self.assertNotIn(("modbus", "uses", "readme"), self.by)

    def test_ecosystem_needs_a_usage_word(self):
        c = self.by.get(("pypsa", "uses", "readme"))
        self.assertIsNotNone(c)
        self.assertIn("exported to a PyPSA network", c["evidence"])

    def test_code_claims_have_direction_and_counts(self):
        self.assertIn(("netcdf", "reads", "code"), self.by)
        self.assertIn(("netcdf", "writes", "code"), self.by)
        self.assertEqual(self.by[("parquet", "writes", "code")]["count"], 2)
        self.assertIn(("mqtt", "speaks", "code"), self.by)
        self.assertEqual(self.nfiles, 3)

    def test_evidence_comes_from_main_code(self):
        c = self.by[("netcdf", "reads", "code")]
        # examples/demo.py is read first, but the evidence must be the tool's own code
        self.assertEqual((c["file"], c["line"], c["where"]), ("src/io_example.py", 7, "main"),
                         "commented line must be skipped")
        self.assertEqual(c["count"], 2)

    def test_calls_only_in_tests_are_marked(self):
        c = self.by[("hdf5", "writes", "code")]
        self.assertEqual((c["file"], c["where"]), ("tests/fixture_io.py", "tests"))

    def test_file_cap_stops_the_walk(self):
        with mock.patch.object(code, "MAX_FILES", 1):
            _, nfiles = code.claims(self.vocab, REPO)
        self.assertEqual(nfiles, 1)

    def test_home_repository_never_uses_itself(self):
        self.assertEqual(home_terms(self.vocab, "pvlib-python"), {"pvlib"})
        claims, _ = extract_tool(self.vocab, REPO, self.files, "pvlib-python")
        self.assertFalse([c for c in claims if c["term"] == "pvlib"])

    def test_package_url_fallbacks(self):
        self.assertEqual(from_repo_url("https://bitbucket.org/Org/Tool"), "pkg:bitbucket/Org/Tool")
        self.assertIsNone(from_repo_url("https://example.org/tool"))
        self.assertEqual(purl_for(REPO, [], "https://github.com/Org/Tool"), ("pkg:github/org/tool", "repository"))

    def test_package_url(self):
        self.assertEqual(purl_for(REPO, self.files, "https://github.com/x/y"),
                         ("pkg:pypi/sample-solar-tools", "declared in pyproject.toml"))
        self.assertEqual(from_repo_url("https://github.com/PyPSA/PyPSA-Eur"), "pkg:github/pypsa/pypsa-eur")
        self.assertEqual(from_repo_url("https://gitlab.com/dlr-ve/esy/amiris"), "pkg:gitlab/dlr-ve/esy/amiris")


class FileClassTest(unittest.TestCase):
    def test_where(self):
        cases = {"src/model.py": "main", "scripts/run.py": "main", "tests/test_io.py": "tests",
                 "test/runtests.jl": "tests", "pkg/io_test.py": "tests", "conftest.py": "tests",
                 "tests/testthat/test-read.R": "tests", "docs/conf.py": "examples",
                 "examples/solar.py": "examples", "notebooks/a.py": "examples", "src/latest.py": "main",
                 "src/ReaderTest.java": "tests", "src/Latest.java": "main", "web/app.spec.tsx": "tests",
                 "src/contest.cpp": "main", "src/io_test.cpp": "tests"}
        for path, want in cases.items():
            self.assertEqual(code.where(path), want, path)


class CodeLinesTest(unittest.TestCase):
    def kept(self, src, ext=".py"):
        return [c.strip() for _, _, c in code.code_lines(src.splitlines(True), ext)]

    def test_python_docstrings_and_comments(self):
        src = ('''def f():\n    """Example:\n\n    >>> ds.to_netcdf("x.nc")\n    """\n'''
               '''    df.to_parquet("a.parquet")  # then ds.to_netcdf("later.nc")\n'''
               '''    url = "https://x.org/#anchor"\n'''
               '''    """One-line docstring with to_netcdf("y")."""\n'''
               '''    sql = """\n    to_netcdf("z")\n    """; df.to_csv("b.csv")\n''')
        kept = self.kept(src)
        self.assertNotIn(True, ["to_netcdf" in k for k in kept], kept)
        self.assertIn('df.to_parquet("a.parquet")', kept)
        self.assertIn('url = "https://x.org/#anchor"', kept, "# inside a string is not a comment")
        self.assertIn("sql =", kept)

    def test_julia_block_comments(self):
        src = '#= old code:\nNCDataset("a.nc", "c")\n=#\nds = NCDataset("b.nc")\n'
        self.assertEqual(self.kept(src, ".jl"), ['ds = NCDataset("b.nc")'])

    def test_c_style_comments(self):
        src = ('/* writer:\n   H5Fcreate(f);\n*/ nc_open(a);\n'
               'x = 1; // nc_create(b)\n'
               'url = "https://api.example.org"; /* inline */ y = 2;\n'
               '#include <netcdf.h>\n')
        self.assertEqual(self.kept(src, ".cpp"),
                         ['nc_open(a);', 'x = 1;', 'url = "https://api.example.org";   y = 2;', '#include <netcdf.h>'])

    def test_matlab_comments(self):
        src = "%{\nsavecase('a.m', mpc);\n%}\nmpc = loadcase('case9'); % savecase('b.m', mpc)\n"
        self.assertEqual(self.kept(src, ".m"), ["mpc = loadcase('case9');"])

    def test_fortran_comments(self):
        self.assertEqual(self.kept('x = 1 ! nf90_create("a.nc")\ny = "a!b"\n', ".f90"), ["x = 1", 'y = "a!b"'])
        self.assertEqual(self.kept("C     CALL NF_CREATE('a.nc')\n      CALL NF_OPEN('b.nc')\n", ".f"),
                         ["CALL NF_OPEN('b.nc')"])


class MultiLanguageTest(unittest.TestCase):
    REPO = os.path.join(os.path.dirname(__file__), "fixtures", "multi_lang_repo")

    @classmethod
    def setUpClass(cls):
        claims, cls.nfiles = code.claims(Vocabulary(pack_names()), cls.REPO)
        cls.by = {(c["term"], c["role"]): c for c in claims}

    def test_claims_in_each_language(self):
        self.assertEqual(self.by[("netcdf", "reads")]["count"], 4, "Fortran (free and fixed form), C++, Java")
        self.assertEqual(self.by[("netcdf", "writes")]["count"], 2, "Rust and Python")
        self.assertEqual(self.by[("matpower", "reads")]["file"], "src/run_case.m")
        self.assertEqual(self.by[("weather_files", "reads")]["file"], "src/Building.mo")
        self.assertEqual((self.by[("openmeteo", "pulls")]["file"], self.by[("openmeteo", "pulls")]["line"]),
                         ("src/io.cpp", 8), "a URL in a string is not a // comment")

    def test_commented_calls_are_skipped(self):
        for key in [("hdf5", "writes"), ("matpower", "writes"), ("zarr", "writes")]:
            self.assertNotIn(key, self.by)

    def test_bundled_files_are_skipped_and_js_tests_are_marked(self):
        self.assertEqual(self.by[("mqtt", "speaks")]["file"], "web/app.ts")
        self.assertNotIn(("modbus", "speaks"), self.by, "vendor.min.js must be skipped")
        self.assertEqual(self.by[("parquet", "reads")]["where"], "tests")
        self.assertEqual(self.nfiles, 10)

    def test_profiles_come_from_code_in_the_same_file(self):
        self.assertEqual(self.by[("netcdf", "writes")]["profile"],
                         ["cf:air_temperature", "cf_conventions", "era5:t2m"],
                         "names in comments don't count")
        self.assertNotIn("profile", self.by[("netcdf", "reads")])



class ManifestTest(unittest.TestCase):
    def test_pyproject_extras_brackets_and_optional_dependencies(self):
        text = ('[project]\nname = "x"\n'
                'dependencies = ["pandas>=2", "xarray[io]>=2023", \'pyarrow; python_version>="3.9"\',\n'
                '  "netcdf4",  # comment with ] bracket\n  "pvlib"]\n'
                '[project.optional-dependencies]\ngrid = ["pypsa", "pandapower[all]"]\nio = [\n  "h5netcdf",\n]\n'
                '[dependency-groups]\ntest = ["pytest"]\n'
                '[tool.poetry.dependencies]\npython = "^3.10"\n"Shapely" = "*"\n')
        self.assertEqual(deps.pyproject(text), {"pandas", "xarray", "pyarrow", "netcdf4", "pvlib", "pypsa",
                                                "pandapower", "h5netcdf", "pytest", "python", "shapely"})

    def test_setup_py_skips_extras_names(self):
        text = ('setup(name="x", install_requires=["numpy", "xarray[io]"],\n'
                '      extras_require={"geo": ["geopandas"], "all": ["netCDF4", "zarr"]})\n'
                'INSTALL_REQUIRES = ["pandas"]\n')
        self.assertEqual(deps.setup_py(text), {"numpy", "xarray", "geopandas", "netcdf4", "zarr", "pandas"})

    def test_setup_cfg_install_requires_and_extras(self):
        text = ('[options]\ninstall_requires =\n    pandas>=1\n    xarray\npython_requires = >=3.9\n'
                '[options.extras_require]\nio = netcdf4\nall =\n    zarr\n    h5py\n')
        self.assertEqual(deps.setup_cfg(text), {"pandas", "xarray", "netcdf4", "zarr", "h5py"})

    def test_other_manifests(self):
        self.assertEqual(deps.conda_env("dependencies:\n  - python=3.11\n  - conda-forge::netcdf4\n  - pip:\n    - pvlib\n"),
                         {"netcdf4", "pvlib"})
        self.assertEqual(deps.toml_tables('[packages]\n"netcdf4" = "*"\npandas = ">=2"\n[dev-packages]\npytest = "*"\n',
                                          ["packages", "dev-packages"]), {"netcdf4", "pandas", "pytest"})
        self.assertEqual(deps.toml_tables('[deps]\nNCDatasets = "uuid"\n[weakdeps]\nPowerModels = "uuid"\n',
                                          ["deps", "weakdeps"]), {"ncdatasets", "powermodels"})
        self.assertEqual(deps.gemfile("source 'x'\ngem 'nokogiri', '~> 1'\n"), {"nokogiri"})
        self.assertEqual(deps.package_json('{"require": {"vendor/pkg": "^1"}}', ("require",)), {"vendor/pkg"})


if __name__ == "__main__":
    unittest.main()
