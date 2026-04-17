/**
 * PM2.5 colormap similar to Matplotlib "Reds" / UMBC-style daily maps:
 * near-white at low µg/m³ → deep maroon at high values.
 * Legend scale follows common publication maps (0–100 µg/m³).
 */

export const PM25_COLORBAR_MIN = 0;
export const PM25_COLORBAR_MAX = 100;

/** Normalized position 0..1 → RGB (Reds-like) */
const REDS_STOPS: [number, number, number, number][] = [
  [0.0, 255, 250, 250],
  [0.12, 255, 219, 219],
  [0.28, 252, 187, 161],
  [0.45, 251, 106, 74],
  [0.62, 230, 57, 46],
  [0.78, 189, 24, 28],
  [0.92, 122, 4, 13],
  [1.0, 65, 0, 10],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function pm25ToRgb(
  value: number,
  vmin: number = PM25_COLORBAR_MIN,
  vmax: number = PM25_COLORBAR_MAX
): [number, number, number] {
  if (value == null || Number.isNaN(value)) return [200, 200, 200];
  const span = vmax - vmin;
  const t = span <= 0 ? 0 : Math.max(0, Math.min(1, (value - vmin) / span));
  let i = 0;
  for (let s = 0; s < REDS_STOPS.length - 1; s++) {
    if (t >= REDS_STOPS[s][0] && t <= REDS_STOPS[s + 1][0]) {
      i = s;
      break;
    }
    if (t > REDS_STOPS[s + 1][0]) i = s + 1;
  }
  const j = Math.min(i + 1, REDS_STOPS.length - 1);
  const [t0, r0, g0, b0] = REDS_STOPS[i];
  const [t1, r1, g1, b1] = REDS_STOPS[j];
  if (t1 <= t0) return [r0, g0, b0];
  const u = (t - t0) / (t1 - t0);
  return [lerp(r0, r1, u), lerp(g0, g1, u), lerp(b0, b1, u)];
}

export function pm25ToCssRgb(
  value: number,
  vmin: number = PM25_COLORBAR_MIN,
  vmax: number = PM25_COLORBAR_MAX
): string {
  const [r, g, b] = pm25ToRgb(value, vmin, vmax);
  return `rgb(${r},${g},${b})`;
}

/** CSS linear-gradient string (bottom = low, top = high) for vertical colorbar */
export function pm25LegendGradientCss(
  vmin: number = PM25_COLORBAR_MIN,
  vmax: number = PM25_COLORBAR_MAX
): string {
  const steps = 12;
  const parts: string[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const v = vmin + t * (vmax - vmin);
    const pct = (t * 100).toFixed(1);
    parts.push(`${pm25ToCssRgb(v, vmin, vmax)} ${pct}%`);
  }
  return `linear-gradient(to top, ${parts.join(', ')})`;
}

export function bilinearPm25(
  values: number[],
  width: number,
  height: number,
  noDataValue: number,
  colFrac: number,
  rowFrac: number
): number | null {
  if (
    colFrac < 0 ||
    rowFrac < 0 ||
    colFrac > width - 1 ||
    rowFrac > height - 1
  ) {
    return null;
  }
  const c0 = Math.floor(colFrac);
  const r0 = Math.floor(rowFrac);
  const c1 = Math.min(c0 + 1, width - 1);
  const r1 = Math.min(r0 + 1, height - 1);
  const dc = colFrac - c0;
  const dr = rowFrac - r0;

  const v = (rr: number, cc: number) => values[rr * width + cc];
  const q = (rr: number, cc: number) => {
    const x = v(rr, cc);
    if (x === noDataValue || x == null || Number.isNaN(x)) return null;
    return x;
  };

  const q00 = q(r0, c0);
  const q10 = q(r0, c1);
  const q01 = q(r1, c0);
  const q11 = q(r1, c1);
  if (q00 == null || q10 == null || q01 == null || q11 == null) return null;

  const top = q00 * (1 - dc) + q10 * dc;
  const bot = q01 * (1 - dc) + q11 * dc;
  return top * (1 - dr) + bot * dr;
}

/** Map lat/lon to fractional row (north=0) / col for MERRA2 row-major grid */
export function latLonToGridFrac(
  lat: number,
  lon: number,
  bounds: { south: number; west: number; north: number; east: number },
  width: number,
  height: number
): { colFrac: number; rowFrac: number } | null {
  const { south, west, north, east } = bounds;
  if (lon < west || lon > east || lat < south || lat > north) return null;
  const colFrac = ((lon - west) / (east - west)) * (width - 1);
  const rowFrac = ((north - lat) / (north - south)) * (height - 1);
  return { colFrac, rowFrac };
}

/** Bilinear sample; falls back to nearest grid cell if corners include no-data. */
export function samplePm25AtLatLon(
  grid: {
    values: number[];
    width: number;
    height: number;
    noDataValue: number;
    bounds: { south: number; west: number; north: number; east: number };
  },
  lat: number,
  lon: number
): number | null {
  const frac = latLonToGridFrac(lat, lon, grid.bounds, grid.width, grid.height);
  if (!frac) return null;
  const bi = bilinearPm25(
    grid.values,
    grid.width,
    grid.height,
    grid.noDataValue,
    frac.colFrac,
    frac.rowFrac
  );
  if (bi != null) return bi;
  const cr = Math.max(0, Math.min(grid.height - 1, Math.round(frac.rowFrac)));
  const cc = Math.max(0, Math.min(grid.width - 1, Math.round(frac.colFrac)));
  const v = grid.values[cr * grid.width + cc];
  if (v === grid.noDataValue || v == null || Number.isNaN(v)) return null;
  return v;
}
