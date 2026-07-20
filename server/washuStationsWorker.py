#!/usr/bin/env python3
"""
WashU ACAG AAQE station Parquet worker — monthly + annual station PM2.5.
Expects files like:
  AAQE_WASHU_PM25_V6GL0204_MONTHLY*.parquet
  AAQE_WASHU_PM25_V6GL0204_ANNUAL.parquet
"""
import argparse
import calendar
import json
import os
import re
from pathlib import Path

import pandas as pd

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PERIOD_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

_CACHE = {"monthly": None, "annual": None, "monthly_path": None, "annual_path": None}


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
    p = os.environ.get("WASHU_PARQUET_DIR", "").strip()
    if not p:
        fail(3, "WASHU_PARQUET_DIR is not set.")
    d = Path(p)
    if not d.exists() or not d.is_dir():
        fail(3, f"WashU parquet directory not found: {p}")
    return d


def find_parquet(kind: str) -> Path:
    d = parquet_dir()
    if kind == "monthly":
        matches = sorted(d.glob("*MONTHLY*.parquet"))
    else:
        matches = sorted(d.glob("*ANNUAL*.parquet"))
    if not matches:
        fail(4, f"No WashU {kind} parquet file found in WASHU_PARQUET_DIR.")
    return matches[0]


def normalize_monthly(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame()
    out["sitename"] = df["sitename"].astype(str).str.strip()
    out["country"] = df["Country or Area Name"].astype(str).str.strip()
    out["fullAddress"] = df["Full Address"].astype(str).str.strip()
    out["latitude"] = pd.to_numeric(df["Latitude"], errors="coerce")
    out["longitude"] = pd.to_numeric(df["Longitude"], errors="coerce")
    out["pm25"] = pd.to_numeric(df["pm25"], errors="coerce")
    out["period"] = df["date"].astype(str).str.strip()
    out["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")
    out["month"] = pd.to_numeric(df["month"], errors="coerce").astype("Int64")
    out = out.dropna(subset=["sitename", "latitude", "longitude", "period"])
    return out[out["sitename"] != ""]


def normalize_annual(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame()
    out["sitename"] = df["sitename"].astype(str).str.strip()
    out["country"] = df["Country or Area Name"].astype(str).str.strip()
    out["fullAddress"] = df["Full Address"].astype(str).str.strip()
    out["latitude"] = pd.to_numeric(df["Latitude"], errors="coerce")
    out["longitude"] = pd.to_numeric(df["Longitude"], errors="coerce")
    out["pm25"] = pd.to_numeric(df["pm25"], errors="coerce")
    out["year"] = pd.to_numeric(df["year"], errors="coerce").astype("Int64")
    out["period"] = out["year"].astype(str)
    out["month"] = 1
    out = out.dropna(subset=["sitename", "latitude", "longitude", "year"])
    return out[out["sitename"] != ""]


def load_monthly() -> pd.DataFrame:
    path = find_parquet("monthly")
    if _CACHE["monthly"] is not None and _CACHE["monthly_path"] == str(path):
        return _CACHE["monthly"]
    df = normalize_monthly(pd.read_parquet(path))
    _CACHE["monthly"] = df
    _CACHE["monthly_path"] = str(path)
    return df


def load_annual() -> pd.DataFrame:
    path = find_parquet("annual")
    if _CACHE["annual"] is not None and _CACHE["annual_path"] == str(path):
        return _CACHE["annual"]
    df = normalize_annual(pd.read_parquet(path))
    _CACHE["annual"] = df
    _CACHE["annual_path"] = str(path)
    return df


def calendar_date_to_period(date_str: str) -> str:
    validate_date(date_str, "date")
    y, m, _ = date_str.split("-")
    return f"{y}-{int(m):02d}"


def period_to_datetime(period: str, granularity: str) -> str:
    if granularity == "annual":
        return f"{period}-01-01T00:00:00Z"
    y, m = period.split("-")
    return f"{y}-{int(m):02d}-01T00:00:00Z"


def clamp_period(period: str, granularity: str) -> str:
    monthly = load_monthly()
    if granularity == "annual":
        annual = load_annual()
        min_year = int(annual["year"].min())
        max_year = int(annual["year"].max())
        year = max(min_year, min(max_year, int(period[:4])))
        return str(year)
    periods = sorted(monthly["period"].unique())
    if period in periods:
        return period
    if period < periods[0]:
        return periods[0]
    if period > periods[-1]:
        return periods[-1]
    return period


def cmd_stations(date_str: str):
    period = calendar_date_to_period(date_str)
    df = load_monthly()
    available = sorted(df["period"].unique())
    if not available:
        fail(6, "No WashU monthly station data found.")
    if period not in available:
        period = clamp_period(period, "monthly")

    sub = df[df["period"] == period].dropna(subset=["pm25"])
    if sub.empty:
        fail(6, f"No WashU station data found for period {period}.")

    records = []
    for row in sub.sort_values("sitename").itertuples(index=False):
        records.append({
            "sitename": row.sitename,
            "country": row.country,
            "fullAddress": row.fullAddress,
            "latitude": float(row.latitude),
            "longitude": float(row.longitude),
            "pm25": round_pm25(row.pm25),
            "period": row.period,
            "periodLabel": row.period,
            "date": date_str,
            "datetime": period_to_datetime(row.period, "monthly"),
        })

    print(json.dumps({
        "date": date_str,
        "period": period,
        "granularity": "monthly",
        "stations": records,
    }))


def cmd_timeseries(sitename: str, start: str, end: str, granularity: str):
    if not sitename or not sitename.strip():
        fail(2, "Missing required query param: sitename")
    validate_date(start, "start")
    validate_date(end, "end")
    if start > end:
        fail(2, "Invalid range: start must be on or before end.")

    gran = (granularity or "monthly").strip().lower()
    if gran not in ("monthly", "annual"):
        fail(2, "Invalid granularity. Expected monthly or annual.")

    station_lower = sitename.strip().lower()
    rows = []
    meta = None

    if gran == "monthly":
        start_period = calendar_date_to_period(start)
        end_period = calendar_date_to_period(end)
        if start_period > end_period:
            start_period, end_period = end_period, start_period
        df = load_monthly()
        sub = df[
            (df["sitename"].str.lower() == station_lower)
            & (df["period"] >= start_period)
            & (df["period"] <= end_period)
        ].dropna(subset=["pm25"])
        for row in sub.sort_values("period").itertuples(index=False):
            if meta is None:
                meta = {
                    "sitename": row.sitename,
                    "country": row.country,
                    "fullAddress": row.fullAddress,
                    "latitude": float(row.latitude),
                    "longitude": float(row.longitude),
                }
            rows.append({
                "period": row.period,
                "year": int(row.year),
                "month": int(row.month),
                "pm25": round_pm25(row.pm25),
                "datetime": period_to_datetime(row.period, "monthly"),
            })
    else:
        start_year = int(start[:4])
        end_year = int(end[:4])
        if start_year > end_year:
            start_year, end_year = end_year, start_year
        df = load_annual()
        sub = df[
            (df["sitename"].str.lower() == station_lower)
            & (df["year"] >= start_year)
            & (df["year"] <= end_year)
        ].dropna(subset=["pm25"])
        for row in sub.sort_values("year").itertuples(index=False):
            if meta is None:
                meta = {
                    "sitename": row.sitename,
                    "country": row.country,
                    "fullAddress": row.fullAddress,
                    "latitude": float(row.latitude),
                    "longitude": float(row.longitude),
                }
            rows.append({
                "period": str(int(row.year)),
                "year": int(row.year),
                "month": 1,
                "pm25": round_pm25(row.pm25),
                "datetime": period_to_datetime(str(int(row.year)), "annual"),
            })

    if not rows:
        fail(6, f'No WashU {gran} PM2.5 data for station "{sitename}" in the requested range.')

    print(json.dumps({
        "station": meta or {"sitename": sitename.strip()},
        "start": start,
        "end": end,
        "granularity": gran,
        "points": rows,
    }))


def cmd_station_list():
    df = load_monthly()
    meta = (
        df.groupby("sitename", as_index=False)
        .agg(
            country=("country", "first"),
            fullAddress=("fullAddress", "first"),
            latitude=("latitude", "first"),
            longitude=("longitude", "first"),
        )
        .sort_values("sitename")
    )
    stations = [
        {
            "sitename": row.sitename,
            "country": row.country,
            "fullAddress": row.fullAddress,
            "latitude": float(row.latitude),
            "longitude": float(row.longitude),
        }
        for row in meta.itertuples(index=False)
    ]
    print(json.dumps({"stations": stations, "count": len(stations)}))


def cmd_latest_date():
    df = load_monthly()
    latest_period = str(df["period"].max())
    y, m = latest_period.split("-")
    last_day = calendar.monthrange(int(y), int(m))[1]
    latest_date = f"{y}-{int(m):02d}-{last_day}"
    print(json.dumps({
        "latestDate": latest_date,
        "latestPeriod": latest_period,
        "latestDatetimeUtc": period_to_datetime(latest_period, "monthly"),
        "sourceFile": _CACHE.get("monthly_path") or str(find_parquet("monthly")),
        "coverage": "1998-01 to 2023-12 (monthly); 1998-2023 (annual)",
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
    p_ts.add_argument("--granularity", default="monthly")

    sub.add_parser("station-list")
    sub.add_parser("latest-date")
    args = parser.parse_args()

    if args.cmd == "stations":
        cmd_stations(args.date)
    elif args.cmd == "station-timeseries":
        cmd_timeseries(args.sitename, args.start, args.end, args.granularity)
    elif args.cmd == "station-list":
        cmd_station_list()
    elif args.cmd == "latest-date":
        cmd_latest_date()


if __name__ == "__main__":
    main()
