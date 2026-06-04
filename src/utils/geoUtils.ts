/** Axis-aligned geographic bounds (south ≤ north, west ≤ east) for simple regional filters. */
export interface LatLonBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Build normalized bounds from two corner coordinates (any order). */
export function normalizeLatLonBounds(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): LatLonBounds {
  return {
    south: Math.min(lat1, lat2),
    north: Math.max(lat1, lat2),
    west: Math.min(lng1, lng2),
    east: Math.max(lng1, lng2),
  };
}

/** True if (lat, lng) lies inside bounds (inclusive). Assumes south ≤ north and west ≤ east. */
export function isPointInLatLonBounds(lat: number, lng: number, bounds: LatLonBounds): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

/** Haversine distance in km between two lat/lng points */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Approximate distance in meters (fast; for circle filters). */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineKm(lat1, lon1, lat2, lon2) * 1000;
}
