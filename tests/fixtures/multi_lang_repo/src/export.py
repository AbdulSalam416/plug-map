import xarray as xr


def export(ds):
    ds = ds.rename({"t2m": "air_temperature"})  # also "eastward_wind" later
    ds.attrs["Conventions"] = "CF-1.8"
    ds.to_netcdf("out.nc")
