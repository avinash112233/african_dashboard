import { pm25ToAqiCategoryRgb } from './aqiUtils';

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

/** CSS linear-gradient string (left = low, right = high) for horizontal colorbar */
export function pm25LegendGradientHorizontal(
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
  return `linear-gradient(to right, ${parts.join(', ')})`;
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

/** Nearest native grid cell (no bilinear interpolation). */
export function samplePm25AtLatLonNearest(
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
  const { south, west, north, east } = grid.bounds;
  if (lon < west || lon > east || lat < south || lat > north) return null;

  const colFrac = ((lon - west) / (east - west)) * (grid.width - 1);
  const rowFrac = ((north - lat) / (north - south)) * (grid.height - 1);
  const col = Math.max(0, Math.min(grid.width - 1, Math.round(colFrac)));
  const row = Math.max(0, Math.min(grid.height - 1, Math.round(rowFrac)));
  const v = grid.values[row * grid.width + col];
  if (v === grid.noDataValue || v == null || Number.isNaN(v)) return null;
  return v;
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
  return samplePm25AtLatLonNearest(grid, lat, lon);
}

/** Paint native grid cells (blocky, no value interpolation). */
export function renderPm25GridNativeCells(
  grid: {
    values: number[];
    width: number;
    height: number;
    noDataValue: number;
  },
  vmin: number = PM25_COLORBAR_MIN,
  vmax: number = PM25_COLORBAR_MAX,
  pxPerLonCell = 5,
  pxPerLatCell = 4
): string {
  const { width, height, values, noDataValue } = grid;
  const canvas = document.createElement('canvas');
  canvas.width = width * pxPerLonCell;
  canvas.height = height * pxPerLatCell;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const v = values[row * width + col];
      if (v == null || v === noDataValue || Number.isNaN(v)) continue;
      const [r, g, b] = pm25ToRgb(v, vmin, vmax);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(col * pxPerLonCell, row * pxPerLatCell, pxPerLonCell, pxPerLatCell);
    }
  }

  return canvas.toDataURL('image/png');
}

/** Paint native grid cells using EPA AQI category colors (matches MERRA2 station markers). */
export function renderPm25GridAqiCells(
  grid: {
    values: number[];
    width: number;
    height: number;
    noDataValue: number;
  },
  pxPerLonCell = 5,
  pxPerLatCell = 4
): string {
  const { width, height, values, noDataValue } = grid;
  const canvas = document.createElement('canvas');
  canvas.width = width * pxPerLonCell;
  canvas.height = height * pxPerLatCell;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const v = values[row * width + col];
      if (v == null || v === noDataValue || Number.isNaN(v)) continue;
      const rgb = pm25ToAqiCategoryRgb(v);
      if (!rgb) continue;
      const [r, g, b] = rgb;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(col * pxPerLonCell, row * pxPerLatCell, pxPerLonCell, pxPerLatCell);
    }
  }

  return canvas.toDataURL('image/png');
}

/**
 * Light MERRA2 smooth — modest bilinear upsample (not WashU-level).
 * Softens cell edges while keeping the coarse MERRA2 structure visible.
 */
export function renderPm25GridLightSmooth(
  grid: {
    values: number[];
    width: number;
    height: number;
    noDataValue: number;
  },
  vmin: number = PM25_COLORBAR_MIN,
  vmax: number = PM25_COLORBAR_MAX,
  /** Upsample factor vs native cells — keep small so it stays "a little" smooth. */
  scale = 3
): string {
  const { width, height, values, noDataValue } = grid;
  const factor = Math.max(2, Math.min(4, Math.round(scale)));
  const targetWidth = Math.max(1, width * factor);
  const targetHeight = Math.max(1, height * factor);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const img = ctx.createImageData(targetWidth, targetHeight);
  const pixels = img.data;

  const sampleSoft = (colFrac: number, rowFrac: number): number | null => {
    const strict = bilinearPm25(values, width, height, noDataValue, colFrac, rowFrac);
    if (strict != null) return strict;

    // Near no-data edges: average whatever valid corners exist (avoids holes).
    if (colFrac < 0 || rowFrac < 0 || colFrac > width - 1 || rowFrac > height - 1) return null;
    const c0 = Math.floor(colFrac);
    const r0 = Math.floor(rowFrac);
    const c1 = Math.min(c0 + 1, width - 1);
    const r1 = Math.min(r0 + 1, height - 1);
    const dc = colFrac - c0;
    const dr = rowFrac - r0;
    const read = (rr: number, cc: number) => {
      const x = values[rr * width + cc];
      if (x === noDataValue || x == null || Number.isNaN(x)) return null;
      return x;
    };
    const corners: Array<{ w: number; v: number }> = [];
    const q00 = read(r0, c0);
    const q10 = read(r0, c1);
    const q01 = read(r1, c0);
    const q11 = read(r1, c1);
    if (q00 != null) corners.push({ w: (1 - dc) * (1 - dr), v: q00 });
    if (q10 != null) corners.push({ w: dc * (1 - dr), v: q10 });
    if (q01 != null) corners.push({ w: (1 - dc) * dr, v: q01 });
    if (q11 != null) corners.push({ w: dc * dr, v: q11 });
    if (corners.length === 0) return null;
    const wSum = corners.reduce((a, c) => a + c.w, 0);
    if (wSum <= 0) return corners[0].v;
    return corners.reduce((a, c) => a + c.v * c.w, 0) / wSum;
  };

  for (let py = 0; py < targetHeight; py++) {
    const rowFrac = ((py + 0.5) / targetHeight) * height - 0.5;
    for (let px = 0; px < targetWidth; px++) {
      const colFrac = ((px + 0.5) / targetWidth) * width - 0.5;
      const v = sampleSoft(colFrac, rowFrac);
      const i = (py * targetWidth + px) * 4;
      if (v == null) {
        pixels[i + 3] = 0;
        continue;
      }
      const [r, g, b] = pm25ToRgb(v, vmin, vmax);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Paint the full grid once to a PNG data URL for Leaflet ImageOverlay (much faster than per-tile GridLayer). */
export function renderPm25GridToDataUrl(
  grid: {
    values: number[];
    width: number;
    height: number;
    noDataValue: number;
  },
  vmin: number = PM25_COLORBAR_MIN,
  vmax: number = PM25_COLORBAR_MAX
): string {
  const { width, height, values, noDataValue } = grid;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const img = ctx.createImageData(width, height);
  const pixels = img.data;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const v = values[row * width + col];
      const i = (row * width + col) * 4;
      if (v == null || v === noDataValue || Number.isNaN(v)) {
        pixels[i + 3] = 0;
        continue;
      }
      const [r, g, b] = pm25ToRgb(v, vmin, vmax);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Smooth, publication-style WashU heatmap — bilinear upsample + ACAG colormap. */
export function renderWashUGridSmooth(
  grid: {
    values: number[];
    width: number;
    height: number;
    noDataValue: number;
  },
  targetWidth = 1920,
  vmin?: number,
  vmax?: number
): string {
  // Dynamic import avoided — caller passes washu colormap via callback pattern below
  return renderWashUGridSmoothWithColorFn(grid, targetWidth, vmin, vmax, defaultWashuColorFn);
}

/**
 * Light WashU render — modest upscale with strict no-data edges (no ocean bleed).
 * Keeps grid structure visible; much less blur than the 2048px publication smooth path.
 */
export function renderWashUGridLightSmoothWithColorFn(
  grid: {
    values: number[];
    width: number;
    height: number;
    noDataValue: number;
  },
  scale = 3,
  vmin: number | undefined,
  vmax: number | undefined,
  colorFn: ColorFn
): string {
  const lo = vmin ?? 0;
  const hi = vmax ?? 80;
  const { values, width, height, noDataValue } = grid;
  const factor = Math.max(2, Math.min(4, Math.round(scale)));
  const targetWidth = Math.max(1, width * factor);
  const targetHeight = Math.max(1, height * factor);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const img = ctx.createImageData(targetWidth, targetHeight);
  const pixels = img.data;

  for (let py = 0; py < targetHeight; py++) {
    const rowFrac = ((py + 0.5) / targetHeight) * height - 0.5;
    for (let px = 0; px < targetWidth; px++) {
      const colFrac = ((px + 0.5) / targetWidth) * width - 0.5;
      // Strict bilinear — skip pixels touching no-data so coastlines stay clean.
      const v = bilinearPm25(values, width, height, noDataValue, colFrac, rowFrac);
      const i = (py * targetWidth + px) * 4;
      if (v == null) {
        pixels[i + 3] = 0;
        continue;
      }
      const [r, g, b] = colorFn(v, lo, hi);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

type ColorFn = (value: number, vmin: number, vmax: number) => [number, number, number];

function defaultWashuColorFn(value: number, vmin: number, vmax: number): [number, number, number] {
  // Lazy inline to avoid circular imports; WashU layer imports washuColormap directly.
  const span = vmax - vmin;
  const t = span <= 0 ? 0 : Math.max(0, Math.min(1, (value - vmin) / span));
  const stops: [number, number, number, number][] = [
    [0, 49, 54, 149],
    [0.45, 224, 243, 248],
    [0.65, 254, 224, 139],
    [0.85, 244, 109, 67],
    [1, 165, 0, 38],
  ];
  let i = 0;
  for (let s = 0; s < stops.length - 1; s++) {
    if (t >= stops[s][0] && t <= stops[s + 1][0]) {
      i = s;
      break;
    }
    if (t > stops[s + 1][0]) i = s + 1;
  }
  const j = Math.min(i + 1, stops.length - 1);
  const [t0, r0, g0, b0] = stops[i];
  const [t1, r1, g1, b1] = stops[j];
  if (t1 <= t0) return [r0, g0, b0];
  const u = (t - t0) / (t1 - t0);
  return [
    Math.round(r0 + (r1 - r0) * u),
    Math.round(g0 + (g1 - g0) * u),
    Math.round(b0 + (b1 - b0) * u),
  ];
}

export function renderWashUGridSmoothWithColorFn(
  grid: {
    values: number[];
    width: number;
    height: number;
    noDataValue: number;
  },
  targetWidth: number,
  vmin: number | undefined,
  vmax: number | undefined,
  colorFn: ColorFn
): string {
  const lo = vmin ?? 0;
  const hi = vmax ?? 80;
  const aspect = grid.height / Math.max(1, grid.width);
  const targetHeight = Math.max(1, Math.round(targetWidth * aspect));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const img = ctx.createImageData(targetWidth, targetHeight);
  const pixels = img.data;
  const { values, width, height, noDataValue } = grid;

  for (let py = 0; py < targetHeight; py++) {
    const rowFrac = (py / Math.max(1, targetHeight - 1)) * (height - 1);
    for (let px = 0; px < targetWidth; px++) {
      const colFrac = (px / Math.max(1, targetWidth - 1)) * (width - 1);
      const v = bilinearPm25(values, width, height, noDataValue, colFrac, rowFrac);
      const i = (py * targetWidth + px) * 4;
      if (v == null) {
        pixels[i + 3] = 0;
        continue;
      }
      const [r, g, b] = colorFn(v, lo, hi);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
