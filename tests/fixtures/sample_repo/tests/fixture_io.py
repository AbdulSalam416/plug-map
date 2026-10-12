"""Synthetic fixture: a test helper that writes an HDF5 file the tool then reads. Never executed."""
import h5py

with h5py.File("fixture.h5", "w") as f:
    f["x"] = [1, 2, 3]
