import dayjs from 'dayjs';

export const WASHU_ARCHIVE_MIN = '1998-01';
export const WASHU_ARCHIVE_MAX = '2023-12';

export const WASHU_DEFAULT_MONTH_SPAN = 6;

export type WashuMonthPresetId = '1M' | '3M' | '6M';

export const WASHU_MONTH_PRESETS: { id: WashuMonthPresetId; label: string; months: number }[] = [
  { id: '1M', label: '1 mo', months: 1 },
  { id: '3M', label: '3 mo', months: 3 },
  { id: '6M', label: '6 mo', months: 6 },
];

export interface WashuMonthRange {
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
}

export function getWashuAnchorMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function getWashuRelativeMonthRange(anchorMonth: string, monthSpan: number): WashuMonthRange {
  const archiveMin = dayjs(`${WASHU_ARCHIVE_MIN}-01`);
  const archiveMax = dayjs(`${WASHU_ARCHIVE_MAX}-01`);
  const normalizedAnchor = anchorMonth.length === 7 ? `${anchorMonth}-01` : anchorMonth;

  let end = dayjs(normalizedAnchor).startOf('month');
  if (end.isAfter(archiveMax, 'month')) end = archiveMax;
  if (end.isBefore(archiveMin, 'month')) end = archiveMin;

  const span = Math.max(1, monthSpan);
  let start = end.subtract(span - 1, 'month');
  if (start.isBefore(archiveMin, 'month')) start = archiveMin;

  return {
    startYear: start.year(),
    startMonth: start.month() + 1,
    endYear: end.year(),
    endMonth: end.month() + 1,
  };
}

export function getDefaultWashuSeriesRange(anchorMonth: string): WashuMonthRange {
  return getWashuRelativeMonthRange(anchorMonth, WASHU_DEFAULT_MONTH_SPAN);
}

export function washuMonthRangesEqual(a: WashuMonthRange, b: WashuMonthRange): boolean {
  return (
    a.startYear === b.startYear &&
    a.startMonth === b.startMonth &&
    a.endYear === b.endYear &&
    a.endMonth === b.endMonth
  );
}

export function toWashuMonthInputValue(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseWashuMonthInputValue(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export function formatWashuMonthRange({
  startYear,
  startMonth,
  endYear,
  endMonth,
}: WashuMonthRange): string {
  const start = dayjs(`${startYear}-${String(startMonth).padStart(2, '0')}-01`);
  const end = dayjs(`${endYear}-${String(endMonth).padStart(2, '0')}-01`);
  return `${start.format('MMM YYYY')} – ${end.format('MMM YYYY')}`;
}

export function isWashuSeriesRangePending(draft: WashuMonthRange, applied: WashuMonthRange): boolean {
  return !washuMonthRangesEqual(draft, applied);
}

export function normalizeWashuMonthRange(range: WashuMonthRange): WashuMonthRange {
  const start = dayjs(`${range.startYear}-${String(range.startMonth).padStart(2, '0')}-01`);
  let end = dayjs(`${range.endYear}-${String(range.endMonth).padStart(2, '0')}-01`);
  if (end.isBefore(start, 'month')) {
    end = start;
  }
  return {
    startYear: start.year(),
    startMonth: start.month() + 1,
    endYear: end.year(),
    endMonth: end.month() + 1,
  };
}

export function matchWashuMonthPreset(
  applied: WashuMonthRange,
  anchorMonth: string
): WashuMonthPresetId | null {
  for (const preset of WASHU_MONTH_PRESETS) {
    const range = getWashuRelativeMonthRange(anchorMonth, preset.months);
    if (washuMonthRangesEqual(applied, range)) return preset.id;
  }
  return null;
}
