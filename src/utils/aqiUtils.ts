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

/** Text on AQI-colored bars (matches NASA aqforecast / aeronet_aq `setTextColor`). */
export function getAqiBarLabelColor(aqi: number): string {
  if (aqi <= 50) return '#ffffff';
  if (aqi <= 150) return '#111827';
  return '#ffffff';
}

