/** Evenly sample an array for charts (keeps first/last spread). */
export function sampleForChart<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = items.length / max;
  for (let i = 0; i < max; i++) {
    out.push(items[Math.min(Math.floor(i * step), items.length - 1)]);
  }
  return out;
}
