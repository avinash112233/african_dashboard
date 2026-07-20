#!/usr/bin/env python3
"""Extract MERRA2 CNN PM2.5 Africa daily cube from a local NetCDF granule."""
import argparse
import json
import sys

import numpy as np
from netCDF4 import Dataset

AFRICA_BOUNDS = {"south": -35, "west": -25, "north": 38, "east": 55}
GLOBAL_WIDTH = 576
GLOBAL_HEIGHT = 361
NO_DATA = -9999
HOURS = 24


def fail(code: int, msg: str):
    print(json.dumps({"error": msg}))
    raise SystemExit(code)


def lat_to_row(lat: float) -> int:
    return int(max(0, min(GLOBAL_HEIGHT - 1, round((90 - lat) / 180 * (GLOBAL_HEIGHT - 1)))))


def lon_to_col(lon: float) -> int:
    return int(max(0, min(GLOBAL_WIDTH - 1, round((lon + 180) / 360 * (GLOBAL_WIDTH - 1)))))


def africa_indices():
    lat_min = lat_to_row(AFRICA_BOUNDS["north"])
    lat_max = lat_to_row(AFRICA_BOUNDS["south"])
    lon_min = lon_to_col(AFRICA_BOUNDS["west"])
    lon_max = lon_to_col(AFRICA_BOUNDS["east"])
    return lat_min, lat_max, lon_min, lon_max


def africa_bounds():
    lat_step = 180 / (GLOBAL_HEIGHT - 1)
    lon_step = 360 / GLOBAL_WIDTH
    lat_min, lat_max, lon_min, lon_max = africa_indices()
    half_lat = lat_step / 2
    half_lon = lon_step / 2
    return {
        "north": 90 - lat_min * lat_step + half_lat,
        "south": 90 - lat_max * lat_step - half_lat,
        "west": -180 + lon_min * lon_step - half_lon,
        "east": -180 + (lon_max + 1) * lon_step - half_lon,
    }


def round_pm25(value) -> float:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return NO_DATA
    return round(float(value), 1)


def extract_daily_cube(path: str, date: str):
    lat_min, lat_max, lon_min, lon_max = africa_indices()
    n_lat = lat_max - lat_min + 1
    n_lon = lon_max - lon_min + 1

    with Dataset(path) as ds:
        if "MERRA2_CNN_Surface_PM25" not in ds.variables:
            fail(4, "MERRA2_CNN_Surface_PM25 not found in NetCDF file.")
        pm = ds.variables["MERRA2_CNN_Surface_PM25"][:, lat_min : lat_max + 1, lon_min : lon_max + 1]
        if pm.shape[0] < HOURS:
            fail(4, f"Expected at least {HOURS} hourly slices, got {pm.shape[0]}.")

    values = []
    hour_min = []
    hour_max = []
    for h in range(HOURS):
        slice2d = pm[h]
        flat = []
        mn = float("inf")
        mx = float("-inf")
        for v in np.asarray(slice2d).flatten():
            rv = round_pm25(v)
            flat.append(rv)
            if rv != NO_DATA:
                if rv < mn:
                    mn = rv
                if rv > mx:
                    mx = rv
        values.extend(flat)
        hour_min.append(0 if mn == float("inf") else mn)
        hour_max.append(50 if mx == float("-inf") else mx)

    return {
        "date": date,
        "hours": HOURS,
        "units": "µg/m³",
        "bounds": africa_bounds(),
        "width": n_lon,
        "height": n_lat,
        "noDataValue": NO_DATA,
        "hourMin": hour_min,
        "hourMax": hour_max,
        "values": values,
        "source": "gesdisc",
    }


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    daily = sub.add_parser("daily-cube")
    daily.add_argument("--date", required=True)
    daily.add_argument("--path", required=True)
    args = parser.parse_args()

    if args.cmd == "daily-cube":
        try:
            print(json.dumps(extract_daily_cube(args.path, args.date)))
        except FileNotFoundError:
            fail(4, f"NetCDF file not found: {args.path}")
        except OSError as e:
            fail(4, f"Failed to read NetCDF: {e}")


if __name__ == "__main__":
    main()
