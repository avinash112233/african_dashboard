/** Initials for team avatar badges (e.g. "Pawan Gupta, Ph.D." → "PG"). */
export function getTeamInitials(name: string): string {
  const parts = name
    .replace(/,?\s*Ph\.?D\.?/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
