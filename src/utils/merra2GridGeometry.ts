/** MERRA-2 CNN PM2.5 native grid (0.625° lon × 0.5° lat). */
export const MERRA2_GLOBAL_WIDTH = 576;
export const MERRA2_GLOBAL_HEIGHT = 361;
export const MERRA2_LON_STEP = 360 / MERRA2_GLOBAL_WIDTH;
export const MERRA2_LAT_STEP = 180 / (MERRA2_GLOBAL_HEIGHT - 1);
export const MERRA2_NO_DATA = -9999;
export const MERRA2_HOURS_PER_DAY = 24;

export const AFRICA_BOUNDS = { south: -35, west: -25, north: 38, east: 55 };

export interface AfricaGridIndices {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

export function latToGlobalRow(lat: number): number {
  const row = Math.round(((90 - lat) / 180) * (MERRA2_GLOBAL_HEIGHT - 1));
  return Math.max(0, Math.min(MERRA2_GLOBAL_HEIGHT - 1, row));
}

export function lonToGlobalCol(lon: number): number {
  const col = Math.round(((lon - -180) / 360) * (MERRA2_GLOBAL_WIDTH - 1));
  return Math.max(0, Math.min(MERRA2_GLOBAL_WIDTH - 1, col));
}

export function getAfricaGridIndices(): AfricaGridIndices {
  return {
    latMin: latToGlobalRow(AFRICA_BOUNDS.north),
    latMax: latToGlobalRow(AFRICA_BOUNDS.south),
    lonMin: lonToGlobalCol(AFRICA_BOUNDS.west),
    lonMax: lonToGlobalCol(AFRICA_BOUNDS.east),
  };
}

export function africaNativeBounds() {
  const { latMin, latMax, lonMin, lonMax } = getAfricaGridIndices();
  const halfLat = MERRA2_LAT_STEP / 2;
  const halfLon = MERRA2_LON_STEP / 2;
  return {
    north: 90 - latMin * MERRA2_LAT_STEP + halfLat,
    south: 90 - latMax * MERRA2_LAT_STEP - halfLat,
    west: -180 + lonMin * MERRA2_LON_STEP - halfLon,
    east: -180 + (lonMax + 1) * MERRA2_LON_STEP - halfLon,
  };
}

export function sliceToGridResponse(
  date: string,
  hour: number,
  width: number,
  height: number,
  sliceValues: number[],
  bounds: { south: number; west: number; north: number; east: number },
  noDataValue: number,
  source: 'gesdisc' | 'sample'
) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of sliceValues) {
    if (v == null || v === noDataValue || Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    date,
    hour,
    units: 'µg/m³',
    bounds,
    width,
    height,
    noDataValue,
    min: min === Infinity ? 0 : min,
    max: max === Infinity ? 50 : max,
    values: sliceValues,
    source,
  };
}
