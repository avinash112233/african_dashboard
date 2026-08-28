// MERRA2 African stations are sparse; 200 km is a practical colocation radius
// for pairing ground/AERONET anchors with the nearest CNN station.
export const MERRA2_STATION_LINK_MAX_KM = 200;

/** OpenAQ monitors are denser in cities; prefer links within 50 km. */
export const OPENAQ_LINK_PREFERRED_KM = 50;
