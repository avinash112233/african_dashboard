/**
 * Spatial colocation limits for cross-layer analysis (km).
 * MERRA2 African stations are sparse; 200 km is a practical upper bound for
 * pairing ground/AERONET anchors with the nearest CNN station.
 */
export const MERRA2_STATION_LINK_MAX_KM = 200;
