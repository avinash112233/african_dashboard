import { haversineKm } from '../utils/geoUtils';

export interface GeoStation {
  latitude: number;
  longitude: number;
  sitename: string;
}

/** Pick closest station within maxKm (default 50 km). */
export function findNearestStation(
  lat: number,
  lon: number,
  stations: GeoStation[],
  maxKm = 50
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
