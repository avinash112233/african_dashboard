// Normalize AERONET date strings (dd:mm:yyyy, yyyy-mm-dd, etc.) to YYYY-MM-DD.
export function normalizeAeronetDate(raw: string | undefined): string {
  if (!raw || !raw.trim()) return '—';
  const s = raw.trim();
  const dmy = s.match(/^(\d{1,2})[:\/-](\d{1,2})[:\/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export function formatDisplayDate(isoDate: string): string {
  if (!isoDate || isoDate === '—') return '—';
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (m >= 1 && m <= 12) return `${d} ${months[m - 1]} ${y}`;
  } catch { /* ignore */ }
  return isoDate;
}

export function formatDateMonthDayYear(isoDate: string): string {
  if (!isoDate || isoDate === '—') return '—';
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    if (m >= 1 && m <= 12) return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`;
  } catch { /* ignore */ }
  return isoDate;
}
