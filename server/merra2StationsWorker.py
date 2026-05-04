#!/usr/bin/env python3
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
    if dt.isna().all():
        return None
    return dt.max()


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    lower_map = {c.lower(): c for c in df.columns}

    def pick(*candidates):
        for c in candidates:
            key = c.lower()
            if key in lower_map:
                return lower_map[key]
        return None

    datetime_col = pick("DATETIME", "datetime", "DateTime", "date_time")
    sitename_col = pick("sitename", "siteName", "SITE_NAME", "StationName")
    country_col = pick("Country or Area Name", "country", "Country")
    address_col = pick("Full Address", "full_address", "address")
    lat_col = pick("Latitude", "latitude", "LATITUDE")
    lon_col = pick("Longitude", "longitude", "LONGITUDE")
    pm25_col = pick("MERRA2_CNN_Surface_PM25", "merra2_cnn_surface_pm25", "PM25", "pm25", "PM2.5")

    if not datetime_col or not sitename_col or not lat_col or not lon_col:
        fail(5, "Required columns missing in parquet file.")

    out = pd.DataFrame()
    out["datetime"] = pd.to_datetime(df[datetime_col], utc=True, errors="coerce")
    out["sitename"] = df[sitename_col].astype(str).str.strip()
    out["country"] = df[country_col].astype(str).str.strip() if country_col else None
    out["fullAddress"] = df[address_col].astype(str).str.strip() if address_col else None
    out["latitude"] = pd.to_numeric(df[lat_col], errors="coerce")
    out["longitude"] = pd.to_numeric(df[lon_col], errors="coerce")
    out["pm25"] = pd.to_numeric(df[pm25_col], errors="coerce") if pm25_col else None

    out = out.dropna(subset=["datetime", "sitename", "latitude", "longitude"])
    out = out[out["sitename"] != ""]
    return out


def cmd_stations(date_str: str):
    validate_date(date_str, "date")
    year = int(date_str[:4])
    p = year_file(year)
    df = pd.read_parquet(p)
    df = normalize_columns(df)
    start = pd.Timestamp(f"{date_str}T00:00:00Z")
    end = start + pd.Timedelta(days=1)
    df = df[(df["datetime"] >= start) & (df["datetime"] < end)]
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
    grouped["pm25"] = grouped["pm25"].round(2)
    grouped["date"] = date_str
    grouped["datetime"] = grouped["datetime"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    grouped = grouped.sort_values("sitename")
    print(json.dumps({"date": date_str, "stations": grouped.to_dict(orient="records")}))


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
        p = year_file(year)
        df = pd.read_parquet(p)
        df = normalize_columns(df)
        df = df[df["sitename"].str.lower() == station_lower]
        df = df[(df["datetime"] >= start_ts) & (df["datetime"] < end_ts)]
        if df.empty:
            continue
        if meta is None:
            first = df.iloc[0]
            meta = {
                "sitename": first["sitename"],
                "country": first["country"],
                "fullAddress": first["fullAddress"],
                "latitude": float(first["latitude"]),
                "longitude": float(first["longitude"]),
            }
        df = df.dropna(subset=["pm25"])
        if df.empty:
            continue
        tmp = pd.DataFrame()
        tmp["datetime"] = df["datetime"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        tmp["pm25"] = df["pm25"].round(2)
        rows.extend(tmp.to_dict(orient="records"))
    rows = sorted(rows, key=lambda r: r["datetime"])
    if not rows:
        fail(6, f'No PM2.5 time-series data found for station "{sitename}" between {start} and {end}.')
    print(
        json.dumps(
            {
                "station": meta or {"sitename": sitename.strip()},
                "start": start,
                "end": end,
                "points": rows,
            }
        )
    )


def cmd_station_list():
    files = list_year_files()
    seen = {}
    for p in files:
        df = pd.read_parquet(p)
        df = normalize_columns(df)
        for row in df.itertuples(index=False):
            key = row.sitename
            if key in seen:
                continue
            seen[key] = {
                "sitename": row.sitename,
                "country": row.country,
                "fullAddress": row.fullAddress,
                "latitude": float(row.latitude),
                "longitude": float(row.longitude),
            }
    if not seen:
        fail(6, "No stations found in parquet files.")
    stations = [seen[k] for k in sorted(seen.keys())]
    print(json.dumps({"stations": stations}))


def cmd_latest_date():
    files = list_year_files()
    # Fast path: latest timestamp should normally be in the newest yearly file.
    newest = files[-1]
    latest_ts = max_datetime_for_file(newest)
    latest_file = newest.name if latest_ts is not None else None

    # Fallback scan if newest file has no valid datetime values.
    if latest_ts is None:
        for p in reversed(files):
            max_dt = max_datetime_for_file(p)
            if max_dt is not None:
                latest_ts = max_dt
                latest_file = p.name
                break
    if latest_ts is None:
        fail(6, "No datetime data found in parquet files.")
    print(
        json.dumps(
            {
                "latestDate": latest_ts.strftime("%Y-%m-%d"),
                "latestDatetimeUtc": latest_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "sourceFile": latest_file,
            }
        )
    )


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

