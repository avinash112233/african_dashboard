/**
 * WashU ACAG SatPM2.5 publication-style colormap (low blue → high red).
 * Scale aligned with common ACAG map figures (≈ 0–80 µg/m³).
 */

export const WASHU_COLORBAR_MIN = 0;
export const WASHU_COLORBAR_MAX = 80;

/** Normalized 0..1 stops — blue → cyan → yellow → orange → red */
const WASHU_STOPS: [number, number, number, number][] = [
  [0.0, 49, 54, 149],
  [0.08, 69, 117, 180],
  [0.18, 116, 173, 209],
  [0.32, 171, 217, 233],
  [0.45, 224, 243, 248],
  [0.55, 255, 255, 191],
  [0.65, 254, 224, 139],
  [0.75, 253, 174, 97],
  [0.85, 244, 109, 67],
  [0.93, 215, 48, 39],
  [1.0, 165, 0, 38],
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function washuPm25ToRgb(
  value: number,
  vmin: number = WASHU_COLORBAR_MIN,
  vmax: number = WASHU_COLORBAR_MAX
): [number, number, number] {
  if (value == null || Number.isNaN(value)) return [200, 200, 200];
  const span = vmax - vmin;
  const t = span <= 0 ? 0 : Math.max(0, Math.min(1, (value - vmin) / span));
  let i = 0;
  for (let s = 0; s < WASHU_STOPS.length - 1; s++) {
    if (t >= WASHU_STOPS[s][0] && t <= WASHU_STOPS[s + 1][0]) {
      i = s;
      break;
    }
    if (t > WASHU_STOPS[s + 1][0]) i = s + 1;
  }
  const j = Math.min(i + 1, WASHU_STOPS.length - 1);
  const [t0, r0, g0, b0] = WASHU_STOPS[i];
  const [t1, r1, g1, b1] = WASHU_STOPS[j];
  if (t1 <= t0) return [r0, g0, b0];
  const u = (t - t0) / (t1 - t0);
  return [lerp(r0, r1, u), lerp(g0, g1, u), lerp(b0, b1, u)];
}

export function washuPm25ToCssRgb(
  value: number,
  vmin: number = WASHU_COLORBAR_MIN,
  vmax: number = WASHU_COLORBAR_MAX
): string {
  const [r, g, b] = washuPm25ToRgb(value, vmin, vmax);
  return `rgb(${r},${g},${b})`;
}

export function washuLegendGradientHorizontal(
  vmin: number = WASHU_COLORBAR_MIN,
  vmax: number = WASHU_COLORBAR_MAX
): string {
  const steps = 16;
  const parts: string[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const v = vmin + t * (vmax - vmin);
    parts.push(`${washuPm25ToCssRgb(v, vmin, vmax)} ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
