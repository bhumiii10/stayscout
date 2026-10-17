// Date helpers. All dates are 'YYYY-MM-DD' strings handled in UTC so
// there are no timezone off-by-one surprises.
const DAY = 86400_000;

export const toDate = (s) => new Date(s + 'T00:00:00Z');
export const fmt = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => fmt(new Date(toDate(s).getTime() + n * DAY));
export const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
export const dayOfWeek = (s) => toDate(s).getUTCDay(); // 0 = Sun
// Friday and Saturday nights are the "weekend" nights hotels charge more for.
export const isWeekendNight = (s) => [5, 6].includes(dayOfWeek(s));

export function range(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
