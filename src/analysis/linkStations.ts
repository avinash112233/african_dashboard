import { haversineKm } from '../utils/geoUtils';
import { MERRA2_STATION_LINK_MAX_KM } from './constants';

export interface GeoStation {
  latitude: number;
  longitude: number;
  sitename: string;
}

/** Pick closest station within maxKm (default {@link MERRA2_STATION_LINK_MAX_KM}). */
export function findNearestStation(
  lat: number,
  lon: number,
  stations: GeoStation[],
  maxKm = MERRA2_STATION_LINK_MAX_KM
): GeoStation | null {
  if (!stations.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: GeoStation | null = null;
  let bestDist = Infinity;
  for (const s of stations) {
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    const d = haversineKm(lat, lon, s.latitude, s.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best && bestDist <= maxKm ? best : null;
}

/**
 * Always returns the absolute nearest station (never null when stations exist).
 * `isBeyondPreferred` is true when the distance exceeds MERRA2_STATION_LINK_MAX_KM,
 * so callers can warn the user without hiding the data.
 */
export function findNearestStationWithDistance(
  lat: number,
  lon: number,
  stations: GeoStation[]
): { station: GeoStation; distanceKm: number; isBeyondPreferred: boolean } | null {
  if (!stations.length || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best: GeoStation | null = null;
  let bestDist = Infinity;
  for (const s of stations) {
    if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    const d = haversineKm(lat, lon, s.latitude, s.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  if (!best) return null;
  return {
    station: best,
    distanceKm: bestDist,
    isBeyondPreferred: bestDist > MERRA2_STATION_LINK_MAX_KM,
  };
}
