export interface AQIBreakpoint {
  cLow: number;
  cHigh: number;
  iLow: number;
  iHigh: number;
  label: string;
  color: string;
}

export const PM25_AQI_BREAKPOINTS: AQIBreakpoint[] = [
  { cLow: 0.0, cHigh: 9.0, iLow: 0, iHigh: 50, label: 'Good', color: '#00e400' },
  { cLow: 9.1, cHigh: 35.4, iLow: 51, iHigh: 100, label: 'Moderate', color: '#ffff00' },
  { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150, label: 'Unhealthy for Sensitive Groups', color: '#ff7e00' },
  { cLow: 55.5, cHigh: 125.4, iLow: 151, iHigh: 200, label: 'Unhealthy', color: '#ff0000' },
  { cLow: 125.5, cHigh: 225.4, iLow: 201, iHigh: 300, label: 'Very Unhealthy', color: '#8f3f97' },
  { cLow: 225.5, cHigh: 325.4, iLow: 301, iHigh: 500, label: 'Hazardous', color: '#7e0023' },
];

export function truncatePm25(value: number): number {
  return Math.trunc(value * 10) / 10;
}

function interpolateAQI(c: number, bp: AQIBreakpoint): number {
  const { cLow, cHigh, iLow, iHigh } = bp;
  return ((iHigh - iLow) / (cHigh - cLow)) * (c - cLow) + iLow;
}

export function calculateAQIFromPm25(pm25: number): number | null {
  if (!Number.isFinite(pm25) || pm25 < 0) return null;
  const c = truncatePm25(pm25);
  const hit = PM25_AQI_BREAKPOINTS.find((bp) => c >= bp.cLow && c <= bp.cHigh);
  if (hit) return Math.round(interpolateAQI(c, hit));

  // Extend hazardous slope for concentrations above upper breakpoint (EPA guidance).
  const haz = PM25_AQI_BREAKPOINTS[PM25_AQI_BREAKPOINTS.length - 1];
  const extended = interpolateAQI(c, haz);
  return Math.round(extended);
}

export function getAqiCategory(aqi: number | null): { label: string; color: string } {
  if (aqi == null || !Number.isFinite(aqi)) return { label: 'Unknown', color: '#6b7280' };
  if (aqi <= 50) return { label: 'Good', color: '#00e400' };
  if (aqi <= 100) return { label: 'Moderate', color: '#ffff00' };
  if (aqi <= 150) return { label: 'Unhealthy for Sensitive Groups', color: '#ff7e00' };
  if (aqi <= 200) return { label: 'Unhealthy', color: '#ff0000' };
  if (aqi <= 300) return { label: 'Very Unhealthy', color: '#8f3f97' };
  return { label: 'Hazardous', color: '#7e0023' };
}

function hexColorToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

/** Same EPA AQI category colors used for MERRA2 station markers. */
export function pm25ToAqiCategoryRgb(pm25: number): [number, number, number] | null {
  if (!Number.isFinite(pm25) || pm25 < 0) return null;
  const aqi = calculateAQIFromPm25(pm25);
  return hexColorToRgb(getAqiCategory(aqi).color);
}

export const AQI_CATEGORY_LEGEND_ROWS = PM25_AQI_BREAKPOINTS.map((bp) => ({
  label: bp.label,
  color: bp.color,
  shortLabel:
    bp.label === 'Unhealthy for Sensitive Groups'
      ? 'USG'
      : bp.label === 'Very Unhealthy'
        ? 'Very unh.'
        : bp.label,
  aqiRange:
    bp.iHigh >= 500
      ? `${bp.iLow}+`
      : bp.iLow === 0
        ? `0–${bp.iHigh}`
        : `${bp.iLow}–${bp.iHigh}`,
  pm25Range:
    bp.cHigh >= 325
      ? `≥${bp.cLow} µg/m³`
      : `${bp.cLow}–${bp.cHigh} µg/m³`,
  pm25RangeShort:
    bp.cHigh >= 325
      ? `≥${Math.round(bp.cLow)}`
      : bp.cLow === 0
        ? `0–${Math.round(bp.cHigh)}`
        : `${bp.cLow}–${Math.round(bp.cHigh)}`,
}));

/** Text on AQI-colored bars (matches NASA aqforecast / aeronet_aq `setTextColor`). */
export function getAqiBarLabelColor(aqi: number): string {
  if (aqi <= 50) return '#ffffff';
  if (aqi <= 150) return '#111827';
  return '#ffffff';
}

