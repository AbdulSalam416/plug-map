# Findings: first three categories

Run of 11 October 2026: Renewable Energy, Energy Systems, Energy Storage. Core vocabulary (44 terms) plus the energy pack (57 terms). Code scanning covers Python, Julia, R, C, C++, Fortran, Java, MATLAB, Modelica, Rust, JavaScript and TypeScript.

This is the second run of the day. It read the same commits as the first, so the changes come only from the new languages, 26 terms accepted from the AI proposals, and file profiles. The numbers in brackets are from the first run.

## Coverage

| Category | Catalog | Read | Any claim | Shows a specific plug | Read/write direction known |
|---|---|---|---|---|---|
| Renewable Energy | 169 | 169 | 91% (89%) | 63% (51%) | 30% (27%) |
| Energy Systems | 311 | 302 | 92% (91%) | 69% (65%) | 38% (37%) |
| Energy Storage | 51 | 49 | 80% (80%) | 51% (47%) | 27% (24%) |
| **Total** | **531** | **520** | | | |

- 11 projects couldn't be read: moved, private, or not on a git host.
- About 3,400 claims in total (3,200): 60% from code, 21% from dependency files, 18% from READMEs.
- "Read/write direction known" counts only calls in a tool's own code. 204 of 2,039 code claims (10%) were found only in tests (124) or examples and docs (80). They are shown on tool pages but not counted as a direction, which lowered this column by a few points compared with the first run.
- "Any claim" includes generic formats (CSV, JSON). "Specific plug" excludes them and is the more meaningful number.

## What stands out

**Code is where direction comes from.** In the Renewable Energy pilot, catalog descriptions alone mentioned a specific format or source for about 13% of tools; reading READMEs, dependencies and code raises that to about half. Only code calls say *which way* data flows, and a spot check found 30 of 30 sampled code claims were real I/O calls.

**The shared formats are general scientific ones.** The formats that bridge all three categories are Shapefile/GeoPackage, NetCDF, HDF5, Parquet/Arrow and GeoTIFF, plus ERA5 as a data source. Domain formats (PyPSA networks, MATPOWER cases, pandapower) connect tools *within* Energy Systems.

**Energy protocols are almost absent.** Only 30 of 520 tools (6%) touch any energy protocol or standard in the pack (25 in the first run; the new ones include the Hoymiles and Bladed controller protocols). Scanning Java and C++ found OCPP (OpenEMS) and BACnet (SolarNetwork) for the first time, one tool each. Nine still never appear: OCPI, IEEE 2030.5, IEC 60870-5-104, DNP3, KNX, DLMS/COSEM, OpenPAYGO, STS and Haystack. That device protocols stay this rare even when the languages device software is written in are scanned supports the first explanation: the catalog's open-source energy tools mostly work at the modelling layer, not the device layer. Device tools may also be missing from the catalog.

**More languages added little in energy, as expected.** The new languages produced 44 code claims (C++ 18, Java 8, MATLAB 8, JavaScript and TypeScript 6, Rust 2), almost all in tools whose main language they are: OGS, ERF, OpenFAST, OpenEMS, PowSyBl, WEC-Sim, VILLASnode. A spot check of all 44 found real I/O calls, except one link to the ENTSO-E website in an "awesome" list. The energy categories are mostly Python. Fortran matters for the Earth-science categories next (70 of 774 tools).

**Profiles are thin so far.** Of 2,469 NetCDF writer/reader pairs, 20 share a variable name or convention in the files with the calls, all of them ERA5 names (e.g. RESKit and atlite share `t2m`, `d2m`, `fdir` and `ssrd`). None share a CF standard name, and no HDF5 or Zarr pairs share anything. Most tools set variable names away from the file that does the I/O, in configuration or other modules, which file-scoped matching can't see. So "same format" is still the main link between tools, and a missing profile match says nothing about whether two tools fit.

**Package identity is uneven.** 279 of 520 tools declare a package name (pyproject.toml 162, setup.py 78, package.json 16, DESCRIPTION 11, setup.cfg 10, go.mod 2). The other 241 can only be identified by their repository URL.

## Known limits

- Jupyter notebooks are not read. General formats (CSV, JSON, Excel, YAML) are only scanned in Python, Julia and R. Languages other than these 12 (Go, C#, Ruby…) only get dependency and README claims.
- Profiles only see variable names in the code of the file with the read or write call.
- A claim says a code path exists, not that it's the main use.
- README claims have lower precision (about 87% on a small sample). Ecosystem names need a usage word on the same line.
- One function used for both reading and writing must be split by its mode argument. HDFStore was fixed this way after it showed up on PyPSA's page. More cases like it probably exist; the evidence on each tool page makes them easy to spot.

## AI pilot

On 12 tools where the rules found nothing specific, an AI reading the README found plausible plugs in 9. 68% of its items were outside the vocabulary. READMEs stated a direction for only about a third of the items. Conclusion: use AI to discover vocabulary and rules to apply it. See [ai.md](ai.md).
