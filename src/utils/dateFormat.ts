/**
 * Normalize AERONET date strings (dd:mm:yyyy, yyyy-mm-dd, etc.) to YYYY-MM-DD
 */
export function normalizeAeronetDate(raw: string | undefined): string {
  if (!raw || !raw.trim()) return '—';
  const s = raw.trim();
  // dd:mm:yyyy or dd-mm-yyyy
  const dmy = s.match(/^(\d{1,2})[:\/-](\d{1,2})[:\/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // yyyy-mm-dd
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return s.slice(0, 10);
  return s;
}

/** Display date in readable form (e.g. 1 Jan 2025) */
export function formatDisplayDate(isoDate: string): string {
  if (!isoDate || isoDate === '—') return '—';
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (m >= 1 && m <= 12) return `${d} ${months[m - 1]} ${y}`;
  } catch {
    /* ignore */
  }
  return isoDate;
}

/** Compact date in MM/DD/YYYY format */
export function formatDateMonthDayYear(isoDate: string): string {
  if (!isoDate || isoDate === '—') return '—';
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    if (m >= 1 && m <= 12) return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
  } catch {
    /* ignore */
  }
  return isoDate;
}
