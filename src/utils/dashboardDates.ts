import dayjs, { type Dayjs } from 'dayjs';

/** Last date with MERRA2 CNN station/grid data in this deployment. */
export const MERRA2_DEFAULT_DATE = '2023-12-31';

/**
 * Latest OpenAQ archive/historic daily date.
 * Prefer the server archive cutoff (~today − 3 days); fall back to yesterday.
 */
export function openAqHistoricalDefaultDate(archiveCutoffDate?: string | null): Dayjs {
  if (archiveCutoffDate && /^\d{4}-\d{2}-\d{2}$/.test(archiveCutoffDate)) {
    return dayjs(archiveCutoffDate, 'YYYY-MM-DD');
  }
  return dayjs().subtract(1, 'day');
}

/** @deprecated Prefer openAqHistoricalDefaultDate(archiveCutoff) for OpenAQ. */
export function historicalDefaultDate(): Dayjs {
  return openAqHistoricalDefaultDate();
}

/** Today — default map date for AERONET AOD (latest available readings). */
export function todayDefaultDate(): Dayjs {
  return dayjs();
}

export function merra2DefaultDate(latestDate?: string | null): Dayjs {
  return latestDate
    ? dayjs(latestDate, 'YYYY-MM-DD')
    : dayjs(MERRA2_DEFAULT_DATE, 'YYYY-MM-DD');
}
