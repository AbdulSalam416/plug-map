import unittest

from plugmap.vocab import Vocabulary, pack_names, validate


class VocabularyTest(unittest.TestCase):
    def test_files_are_valid(self):
        self.assertEqual(validate(), [])

    def test_core_and_pack_layers(self):
        core = Vocabulary()
        full = Vocabulary(pack_names())
        self.assertIn("netcdf", core.terms)
        self.assertNotIn("pypsa", core.terms, "energy terms belong in the energy pack, not core")
        self.assertEqual(full.terms["pypsa"]["layer"], "energy")
        self.assertEqual(full.terms["netcdf"]["layer"], "core")

    def test_domain_formats_are_semantic_and_containers_are_not(self):
        v = Vocabulary(pack_names())
        for k in ("pypsa", "pandapower", "matpower", "cim"):
            self.assertIs(v.terms[k].get("semantic"), True, k)
        for k in ("netcdf", "hdf5", "parquet", "zarr", "vector_gis", "raster_gis", "csv"):
            self.assertFalse(v.terms[k].get("semantic"), k)

    def test_code_patterns_recognise_typical_calls(self):
        v = Vocabulary(pack_names())
        cases = [
            ('ds = xr.open_dataset("a.nc")', ".py", "netcdf", "reads"),
            ('ds.to_netcdf("b.nc")', ".py", "netcdf", "writes"),
            ('n.export_to_netcdf("net.nc")', ".py", "pypsa", "writes"),
            ('net = pp.converter.from_mpc("case.m")', ".py", "matpower", "reads"),
            ('CSV.write("x.csv", df)', ".jl", "csv", "writes"),
            ('st_write(x, "a.gpkg")', ".R", "vector_gis", "writes"),
            ('client = EntsoePandasClient(api_key=k)', ".py", "entsoe", "pulls"),
        ]
        for line, ext, term, role in cases:
            hits = {(t, r) for t, r, exts, rx in v.code if ext in exts and rx.search(line)}
            self.assertIn((term, role), hits, line)

    def test_write_mode_is_not_a_read(self):
        v = Vocabulary()
        for line in ('f = h5py.File("x.h5", "w")', 'self.ds = pd.HDFStore(self.path, mode="w", **kwargs)'):
            hits = {(t, r) for t, r, exts, rx in v.code if ".py" in exts and rx.search(line)}
            self.assertIn(("hdf5", "writes"), hits, line)
            self.assertNotIn(("hdf5", "reads"), hits, line)
        hits = {(t, r) for t, r, exts, rx in v.code if ".py" in exts and rx.search('pd.HDFStore("x.h5")')}
        self.assertIn(("hdf5", "reads"), hits)


if __name__ == "__main__":
    unittest.main()
