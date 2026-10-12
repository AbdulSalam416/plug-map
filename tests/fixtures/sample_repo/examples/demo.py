"""Synthetic fixture: an example script. Sorts before src/, so it is read first."""
import xarray as xr

ds = xr.open_dataset("demo.nc")
