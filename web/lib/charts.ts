// Shared helpers for the SVG chart series.
export function padSeries(
  points: { day: string; value: number }[],
  days = 14,
): { day: string; value: number }[] {
  const byDay = new Map(points.map((p) => [p.day, p.value]));
  const out: { day: string; value: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, value: byDay.get(key) ?? 0 });
  }
  return out;
}
