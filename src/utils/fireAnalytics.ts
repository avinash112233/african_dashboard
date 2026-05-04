export interface FireAnalyticsPoint {
  acq_date?: string;
  frp?: number;
  bright_ti4?: number;
  brightness?: number;
}

export interface FireDailyStats {
  date: string;
  count: number;
  /** Sum of finite FRP values for that day; null if no detection had a valid FRP */
  totalFrp: number | null;
}

function parseFinite(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

export function normalizeFireDate(date: string | undefined): string | null {
  if (!date) return null;
  const input = date.trim();
  if (!input) return null;

  // ISO-like values, including "YYYY-MM-DDTHH:mm:ssZ"
  const isoPrefix = input.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix) return isoPrefix[1];

  // Slash-separated year-first
  const ymdSlash = input.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (ymdSlash) return `${ymdSlash[1]}-${ymdSlash[2]}-${ymdSlash[3]}`;

  // Slash-separated month-first (MM/DD/YYYY)
  const mdySlash = input.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (mdySlash) return `${mdySlash[3]}-${mdySlash[1]}-${mdySlash[2]}`;

  return null;
}

export function isValidFireDate(date: string | undefined): date is string {
  return normalizeFireDate(date) !== null;
}

export function aggregateFiresByDate(points: FireAnalyticsPoint[]): FireDailyStats[] {
  const byDate = new Map<string, { count: number; frpSum: number; frpCount: number }>();

  for (const p of points) {
    const normalizedDate = normalizeFireDate(p.acq_date);
    if (!normalizedDate) continue;
    const key = normalizedDate;
    const existing = byDate.get(key) ?? { count: 0, frpSum: 0, frpCount: 0 };
    existing.count += 1;

    const frp = parseFinite(p.frp);
    if (frp != null) {
      existing.frpSum += frp;
      existing.frpCount += 1;
    }
    byDate.set(key, existing);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => ({
      date,
      count: entry.count,
      totalFrp: entry.frpCount > 0 ? entry.frpSum : null,
    }));
}

export function getFireBrightness(point: FireAnalyticsPoint): number | null {
  const brightness = parseFinite(point.brightness);
  if (brightness != null) return brightness;
  return parseFinite(point.bright_ti4);
}
