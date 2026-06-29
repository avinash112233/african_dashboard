#!/usr/bin/env python3
"""
MERRA2 station Parquet worker — called by merra2Stations.js via execFile.
Commands: stations, station-timeseries, station-list, latest-date
Parquet files must follow the naming convention: YYYY_AfricanStationsFull.parquet
"""
import argparse
import json
import os
import re
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
YEAR_FILE_RE = re.compile(r"^(\d{4})_AfricanStationsFull\.parquet$", re.IGNORECASE)


def fail(code: int, msg: str):
    print(json.dumps({"error": msg}))
    raise SystemExit(code)


def validate_date(value: str, field_name: str) -> str:
    if not value or not DATE_RE.match(value):
        fail(2, f"Invalid {field_name}. Expected YYYY-MM-DD.")
    return value


def round_pm25(value) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return round(float(value), 2)


def parquet_dir() -> Path:
    p = os.environ.get("MERRA2_PARQUET_DIR", "").strip()
    if not p:
        fail(3, "MERRA2_PARQUET_DIR is not set.")
    d = Path(p)
    if not d.exists() or not d.is_dir():
        fail(3, f"Parquet directory not found: {p}")
    return d


def year_file(year: int) -> Path:
    p = parquet_dir() / f"{year}_AfricanStationsFull.parquet"
    if not p.exists():
        fail(4, f"Parquet file not found for year {year}: {p.name}")
    return p


def list_year_files():
    d = parquet_dir()
    files = sorted([f for f in d.iterdir() if YEAR_FILE_RE.match(f.name)])
    if not files:
        fail(4, "No yearly parquet files found in MERRA2_PARQUET_DIR.")
    return files


def max_datetime_for_file(p: Path):
    schema = pq.read_schema(p)
    lower_map = {c.lower(): c for c in schema.names}
    dt_col = lower_map.get("datetime") or lower_map.get("date_time")
    if not dt_col:
        return None
    df = pd.read_parquet(p, columns=[dt_col])
    if df.empty:
        return None
    dt = pd.to_datetime(df[dt_col], utc=True, errors="coerce")
    return None if dt.isna().all() else dt.max()


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    lower_map = {c.lower(): c for c in df.columns}

    def pick(*candidates):
        for c in candidates:
            if c.lower() in lower_map:
                return lower_map[c.lower()]
        return None

    datetime_col = pick("DATETIME", "datetime", "DateTime", "date_time")
    sitename_col = pick("sitename", "siteName", "SITE_NAME", "StationName")
    country_col  = pick("Country or Area Name", "country", "Country")
    address_col  = pick("Full Address", "full_address", "address")
    lat_col      = pick("Latitude", "latitude", "LATITUDE")
    lon_col      = pick("Longitude", "longitude", "LONGITUDE")
    pm25_col     = pick("MERRA2_CNN_Surface_PM25", "merra2_cnn_surface_pm25", "PM25", "pm25", "PM2.5")

    if not datetime_col or not sitename_col or not lat_col or not lon_col:
        fail(5, "Required columns missing in parquet file.")

    out = pd.DataFrame()
    out["datetime"]    = pd.to_datetime(df[datetime_col], utc=True, errors="coerce")
    out["sitename"]    = df[sitename_col].astype(str).str.strip()
    out["country"]     = df[country_col].astype(str).str.strip() if country_col else None
    out["fullAddress"] = df[address_col].astype(str).str.strip() if address_col else None
    out["latitude"]    = pd.to_numeric(df[lat_col], errors="coerce")
    out["longitude"]   = pd.to_numeric(df[lon_col], errors="coerce")
    out["pm25"]        = pd.to_numeric(df[pm25_col], errors="coerce") if pm25_col else None

    out = out.dropna(subset=["datetime", "sitename", "latitude", "longitude"])
    return out[out["sitename"] != ""]


def read_parquet_for_range(p: Path, start_ts: pd.Timestamp, end_ts: pd.Timestamp) -> pd.DataFrame:
    """Read only rows in [start_ts, end_ts) — much faster than loading a full year."""
    schema = pq.read_schema(p)
    lower_map = {c.lower(): c for c in schema.names}
    dt_col = lower_map.get("datetime") or lower_map.get("date_time")
    if dt_col:
        try:
            raw = pd.read_parquet(
                p,
                filters=[
                    (dt_col, ">=", start_ts),
                    (dt_col, "<", end_ts),
                ],
            )
            if not raw.empty:
                out = normalize_columns(raw)
                return out[(out["datetime"] >= start_ts) & (out["datetime"] < end_ts)]
        except Exception:
            pass
    df = normalize_columns(pd.read_parquet(p))
    return df[(df["datetime"] >= start_ts) & (df["datetime"] < end_ts)]


def cmd_stations(date_str: str):
    validate_date(date_str, "date")
    year = int(date_str[:4])
    start = pd.Timestamp(f"{date_str}T00:00:00Z")
    end = start + pd.Timedelta(days=1)
    df = read_parquet_for_range(year_file(year), start, end)
    if df.empty:
        fail(6, f"No station data found for date {date_str}.")

    grouped = (
        df.dropna(subset=["pm25"])
        .groupby("sitename", as_index=False)
        .agg(
            country=("country", "first"),
            fullAddress=("fullAddress", "first"),
            latitude=("latitude", "first"),
            longitude=("longitude", "first"),
            pm25=("pm25", "mean"),
            datetime=("datetime", "max"),
        )
    )
    if grouped.empty:
        fail(6, f"No station data found for date {date_str}.")
    grouped["date"] = date_str
    grouped["datetime"] = grouped["datetime"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    records = grouped.sort_values("sitename").to_dict(orient="records")
    for rec in records:
        rec["pm25"] = round_pm25(rec.get("pm25"))
    print(json.dumps({"date": date_str, "stations": records}))


def cmd_timeseries(sitename: str, start: str, end: str):
    if not sitename or not sitename.strip():
        fail(2, "Missing required query param: sitename")
    validate_date(start, "start")
    validate_date(end, "end")
    if start > end:
        fail(2, "Invalid range: start must be on or before end.")

    station_lower = sitename.strip().lower()
    start_ts = pd.Timestamp(f"{start}T00:00:00Z")
    end_ts = pd.Timestamp(f"{end}T00:00:00Z") + pd.Timedelta(days=1)
    rows = []
    meta = None

    for year in range(int(start[:4]), int(end[:4]) + 1):
        try:
            p = year_file(year)
        except SystemExit:
            continue  # skip years with no parquet file
        df = read_parquet_for_range(p, start_ts, end_ts)
        df = df[df["sitename"].str.lower() == station_lower]
        if df.empty:
            continue
        if meta is None:
            first = df.iloc[0]
            meta = {
                "sitename":    first["sitename"],
                "country":     first["country"],
                "fullAddress": first["fullAddress"],
                "latitude":    float(first["latitude"]),
                "longitude":   float(first["longitude"]),
            }
        df = df.dropna(subset=["pm25"])
        if df.empty:
            continue
        daily = (
            df.assign(date=df["datetime"].dt.strftime("%Y-%m-%d"))
            .groupby("date", as_index=False)
            .agg(pm25=("pm25", "mean"), datetime=("datetime", "max"))
        )
        daily["datetime"] = daily["datetime"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        for rec in daily.to_dict(orient="records"):
            rec["pm25"] = round_pm25(rec.get("pm25"))
            rows.append(rec)

    rows = sorted(rows, key=lambda r: r["date"])
    if not rows:
        fail(6, f'No PM2.5 time-series data found for station "{sitename}" between {start} and {end}.')
    print(json.dumps({
        "station": meta or {"sitename": sitename.strip()},
        "start": start,
        "end": end,
        "points": rows,
    }))


def _station_meta_from_file(p: Path) -> pd.DataFrame:
    """Read only identity columns from one parquet file and deduplicate by sitename."""
    schema = pq.read_schema(p)
    lower_map = {c.lower(): c for c in schema.names}

    def pick(*candidates):
        for c in candidates:
            if c.lower() in lower_map:
                return lower_map[c.lower()]
        return None

    sitename_col = pick("sitename", "siteName", "SITE_NAME", "StationName")
    country_col  = pick("country", "Country", "Country or Area Name")
    address_col  = pick("fullAddress", "Full Address", "full_address", "address")
    lat_col      = pick("latitude", "Latitude", "LATITUDE")
    lon_col      = pick("longitude", "Longitude", "LONGITUDE")

    if not sitename_col or not lat_col or not lon_col:
        return pd.DataFrame()

    cols = [c for c in [sitename_col, country_col, address_col, lat_col, lon_col] if c]
    df = pd.read_parquet(p, columns=cols)

    out = pd.DataFrame()
    out["sitename"]    = df[sitename_col].astype(str).str.strip()
    out["country"]     = df[country_col].astype(str).str.strip() if country_col else None
    out["fullAddress"] = df[address_col].astype(str).str.strip() if address_col else None
    out["latitude"]    = pd.to_numeric(df[lat_col], errors="coerce")
    out["longitude"]   = pd.to_numeric(df[lon_col], errors="coerce")

    out = out.dropna(subset=["latitude", "longitude"])
    out = out[out["sitename"] != ""]
    return out.drop_duplicates(subset=["sitename"])


def cmd_station_list():
    """Return unique stations from all year files, reading only identity columns."""
    files = list_year_files()
    frames = []
    for p in files:
        try:
            frames.append(_station_meta_from_file(p))
        except Exception:
            continue
    if not frames:
        fail(6, "No stations found in parquet files.")
    combined = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["sitename"])
    stations = [
        {
            "sitename":    row.sitename,
            "country":     row.country,
            "fullAddress": row.fullAddress,
            "latitude":    float(row.latitude),
            "longitude":   float(row.longitude),
        }
        for row in combined.sort_values("sitename").itertuples(index=False)
    ]
    print(json.dumps({"stations": stations}))


def cmd_latest_date():
    files = list_year_files()
    # Start with the newest file (most likely to have the latest timestamp).
    latest_ts = max_datetime_for_file(files[-1])
    latest_file = files[-1].name if latest_ts is not None else None

    if latest_ts is None:
        for p in reversed(files):
            max_dt = max_datetime_for_file(p)
            if max_dt is not None:
                latest_ts = max_dt
                latest_file = p.name
                break
    if latest_ts is None:
        fail(6, "No datetime data found in parquet files.")
    print(json.dumps({
        "latestDate":        latest_ts.strftime("%Y-%m-%d"),
        "latestDatetimeUtc": latest_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sourceFile":        latest_file,
    }))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_stations = sub.add_parser("stations")
    p_stations.add_argument("--date", required=True)

    p_ts = sub.add_parser("station-timeseries")
    p_ts.add_argument("--sitename", required=True)
    p_ts.add_argument("--start", required=True)
    p_ts.add_argument("--end", required=True)

    sub.add_parser("station-list")
    sub.add_parser("latest-date")
    args = parser.parse_args()

    if args.cmd == "stations":
        cmd_stations(args.date)
    elif args.cmd == "station-timeseries":
        cmd_timeseries(args.sitename, args.start, args.end)
    elif args.cmd == "station-list":
        cmd_station_list()
    elif args.cmd == "latest-date":
        cmd_latest_date()


if __name__ == "__main__":
    main()
