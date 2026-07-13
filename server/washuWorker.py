#!/usr/bin/env python3
"""
WashU ACAG SatPM2.5 (V6.GL.03 Africa fine resolution) grid worker.
Called by washu.js via execFile.

Requires: pip install netCDF4 numpy
"""
import argparse
import json
import math
import os
from pathlib import Path

import netCDF4 as nc
import numpy as np

NO_DATA = -9999.0
MAX_DIM = int(os.environ.get("WASHU_MAX_GRID_DIM", "420"))


def fail(code: int, msg: str):
    print(json.dumps({"error": msg}))
    raise SystemExit(code)


def round_pm25(value) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    if value <= -900 or value >= 900:
        return None
    return round(float(value), 2)


def nearest_index(arr: np.ndarray, value: float) -> int:
    return int(np.argmin(np.abs(arr - value)))


def downsample_block_mean(pm25: np.ndarray, lat: np.ndarray, lon: np.ndarray, max_dim: int):
    h, w = pm25.shape
    stride_y = max(1, int(math.ceil(h / max_dim)))
    stride_x = max(1, int(math.ceil(w / max_dim)))
    out_h = int(math.ceil(h / stride_y))
    out_w = int(math.ceil(w / stride_x))
    values = []
    min_v = math.inf
    max_v = -math.inf

    for out_row in range(out_h):
        r0 = (out_h - 1 - out_row) * stride_y
        r1 = min(h, r0 + stride_y)
        for col in range(out_w):
            c0 = col * stride_x
            c1 = min(w, c0 + stride_x)
            block = pm25[r0:r1, c0:c1]
            valid = block[(block > -900) & (block < 900) & np.isfinite(block)]
            if valid.size == 0:
                values.append(NO_DATA)
                continue
            v = round(float(valid.mean()), 2)
            values.append(v)
            min_v = min(min_v, v)
            max_v = max(max_v, v)

    south = float(lat[0])
    north = float(lat[h - 1])
    west = float(lon[0])
    east = float(lon[w - 1])

    return {
        "bounds": {"south": south, "west": west, "north": north, "east": east},
        "width": out_w,
        "height": out_h,
        "values": values,
        "min": 0 if min_v is math.inf else round(min_v, 2),
        "max": 50 if max_v is -math.inf else round(max_v, 2),
        "strideY": stride_y,
        "strideX": stride_x,
        "nativeWidth": w,
        "nativeHeight": h,
    }


def read_grid_from_nc(path: Path, period: str, year: int, month: int | None):
    ds = nc.Dataset(str(path))
    try:
        pm = ds.variables["PM25"][:]
        lat = ds.variables["lat"][:]
        lon = ds.variables["lon"][:]
    finally:
        ds.close()

    pm = np.array(pm, dtype=np.float64)
    lat = np.array(lat, dtype=np.float64)
    lon = np.array(lon, dtype=np.float64)

    grid = downsample_block_mean(pm, lat, lon, MAX_DIM)
    period_label = f"{year:04d}" if period == "annual" else f"{year:04d}-{month:02d}"

    return {
        "period": period,
        "year": year,
        "month": month,
        "periodLabel": period_label,
        "units": "µg/m³",
        "noDataValue": NO_DATA,
        "nativeResolution": "0.01°",
        "source": "satpm",
        **grid,
    }


def sample_value_at(path: Path, lat: float, lon: float):
    ds = nc.Dataset(str(path))
    try:
        lat_arr = np.array(ds.variables["lat"][:], dtype=np.float64)
        lon_arr = np.array(ds.variables["lon"][:], dtype=np.float64)
        li = nearest_index(lat_arr, lat)
        lj = nearest_index(lon_arr, lon)
        raw = float(ds.variables["PM25"][li, lj])
    finally:
        ds.close()
    return round_pm25(raw)


def iter_months(start_year: int, start_month: int, end_year: int, end_month: int):
    y, m = start_year, start_month
    while (y, m) <= (end_year, end_month):
        yield y, m
        m += 1
        if m > 12:
            m = 1
            y += 1


def cmd_grid(args):
    path = Path(args.path)
    if not path.exists():
        fail(4, f"NetCDF file not found: {path}")
    print(json.dumps(read_grid_from_nc(path, args.period, args.year, args.month)))


def cmd_timeseries(args):
    cache_dir = Path(args.cache_dir)
    prefix = args.prefix.rstrip("/") + "/"
    points = []

    for y, m in iter_months(args.start_year, args.start_month, args.end_year, args.end_month):
        ym = f"{y:04d}{m:02d}"
        rel = f"{prefix}Monthly/{y}/V6GL03.CNNPM25.AF.{ym}-{ym}.nc"
        path = cache_dir / rel.replace("/", os.sep)
        if not path.exists():
            continue
        val = sample_value_at(path, args.lat, args.lon)
        if val is None:
            continue
        points.append({"period": f"{y:04d}-{m:02d}", "year": y, "month": m, "pm25": val})

    print(json.dumps({"points": points, "units": "µg/m³", "lat": args.lat, "lon": args.lon}))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    grid = sub.add_parser("grid")
    grid.add_argument("--path", required=True)
    grid.add_argument("--period", choices=["monthly", "annual"], required=True)
    grid.add_argument("--year", type=int, required=True)
    grid.add_argument("--month", type=int, default=1)

    ts = sub.add_parser("timeseries")
    ts.add_argument("--cache-dir", required=True)
    ts.add_argument("--prefix", default="V6GL03/FineResolution/AF")
    ts.add_argument("--lat", type=float, required=True)
    ts.add_argument("--lon", type=float, required=True)
    ts.add_argument("--start-year", type=int, required=True)
    ts.add_argument("--start-month", type=int, default=1)
    ts.add_argument("--end-year", type=int, required=True)
    ts.add_argument("--end-month", type=int, default=12)

    args = parser.parse_args()
    if args.command == "grid":
        cmd_grid(args)
    elif args.command == "timeseries":
        cmd_timeseries(args)


if __name__ == "__main__":
    main()
