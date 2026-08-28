import dayjs from 'dayjs';

/**
 * Conservative ceiling when `/api/merra2/latest-date` has not loaded yet
 * (e.g. system clock is 2026 but parquet ends in 2025).
 */
export const MERRA2_ARCHIVE_FALLBACK_MAX = '2025-12-31';

/** Clamp an ISO date (YYYY-MM-DD) to the MERRA2 station parquet archive. */
export function clampIsoDateToMerra2Archive(
  dateStr: string,
  latestDate?: string | null
): string {
  const parsed = dayjs(dateStr.slice(0, 10), 'YYYY-MM-DD', true);
  const max = dayjs((latestDate ?? MERRA2_ARCHIVE_FALLBACK_MAX).slice(0, 10), 'YYYY-MM-DD');
  if (!parsed.isValid()) return max.format('YYYY-MM-DD');
  if (parsed.isAfter(max, 'day')) return max.format('YYYY-MM-DD');
  return parsed.format('YYYY-MM-DD');
}

export function clampIsoDateRangeToMerra2Archive(
  start: string,
  end: string,
  latestDate?: string | null
): { start: string; end: string } {
  const maxDate = clampIsoDateToMerra2Archive(end, latestDate);
  let startDate = clampIsoDateToMerra2Archive(start, latestDate);
  let endDate = maxDate;
  if (startDate > endDate) startDate = endDate;
  return { start: startDate, end: endDate };
}
