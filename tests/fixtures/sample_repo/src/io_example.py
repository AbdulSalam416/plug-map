"""Synthetic fixture for the code reader. Never executed."""
import pandas as pd
import xarray as xr
import paho.mqtt.client as mqtt

# ds = xr.open_dataset("commented out, must be ignored")
ds = xr.open_dataset("weather.nc")
ds.to_netcdf("out.nc")
df = pd.read_parquet("in.parquet")
df.to_parquet("out.parquet")
df.to_parquet("again.parquet")
client = mqtt.Client()
