// Itinerary optimiser (runs in the browser, so tweaking nights is instant and free).
// Given each city's nightly price series and how many nights to spend in each,
// try every visiting order × every start date and keep the cheapest.
//
// Hotel cost is what we optimise, but zig-zag routes are penalised a little
// (≈ 0.1% of a night's price per km), so near-ties go to the route that makes
// geographic sense. We don't know real train/flight prices.

const KM_PENALTY = 0.001; // × typical nightly price, per km travelled

function* permutations(items) {
  if (items.length <= 1) return yield items;
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) yield [items[i], ...p];
  }
}

function km(a, b) {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return 0;
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// cities: [{ name, lat, lng, typicalNightly, nights: [{ date, typical }] }] aligned to the same dates
// alloc:  { cityName: nights } (0 = skip)
// startCount: how many possible start dates (index 0 = earliest start)
// Returns { options: [best, then cheapest plans in other weeks], worstForBest }
export function optimise(cities, alloc, startCount) {
  const used = cities.filter((c) => (alloc[c.name] || 0) > 0);
  if (!used.length) return { options: [], worstForBest: null };

  // prefix sums → cost of any run of nights in O(1)
  const prefix = new Map(
    used.map((c) => {
      const p = [0];
      c.nights.forEach((n, i) => (p[i + 1] = p[i] + n.typical));
      return [c.name, p];
    }),
  );
  const cost = (name, from, n) => prefix.get(name)[from + n] - prefix.get(name)[from];
  const avgNightly = used.reduce((a, c) => a + c.typicalNightly, 0) / used.length;

  const orders = [...permutations(used)].map((order) => {
    const dist = order.slice(1).reduce((a, c, i) => a + km(order[i], c), 0);
    return { order, dist, penalty: dist * KM_PENALTY * avgNightly };
  });

  const evaluate = ({ order, dist, penalty }, s) => {
    let t = s, total = 0;
    const legs = order.map((c) => {
      const n = alloc[c.name];
      const leg = { city: c.name, nights: n, startIdx: t, cost: cost(c.name, t, n) };
      t += n;
      total += leg.cost;
      return leg;
    });
    return { startIdx: s, legs, total, km: Math.round(dist), score: total + penalty };
  };

  // Best route for each start date
  const byStart = [];
  for (let s = 0; s < startCount; s++) {
    let best = null;
    for (const o of orders) {
      const r = evaluate(o, s);
      if (!best || r.score < best.score) best = r;
    }
    byStart.push(best);
  }
  const ranked = [...byStart].sort((a, b) => a.score - b.score);

  // Alternatives: the next-cheapest plans starting ≥ 5 days away from ones already picked,
  // so each option is a genuinely different week.
  const options = [];
  for (const r of ranked) {
    if (options.every((o) => Math.abs(o.startIdx - r.startIdx) >= 5)) options.push(r);
    if (options.length === 3) break;
  }

  // Same route as the best option, on its most expensive start date
  const bestOrder = orders.find((o) => o.order.map((c) => c.name).join() === options[0].legs.map((l) => l.city).join());
  let worstForBest = null;
  for (let s = 0; s < startCount; s++) {
    const r = evaluate(bestOrder, s);
    if (!worstForBest || r.total > worstForBest.total) worstForBest = r;
  }
  return { options, worstForBest };
}

// Split a trip evenly: 8 nights over 3 cities → 3, 3, 2
export function splitNights(total, names) {
  const base = Math.floor(total / names.length);
  let extra = total - base * names.length;
  return Object.fromEntries(names.map((n) => [n, base + (extra-- > 0 ? 1 : 0)]));
}

// Split one city stay across districts, e.g. 3 nights in Ueno then 4 in Asakusa.
// districts: [{ name, nights: [{ price }] }] aligned to the trip's nights
// startIdx/n: which nights of the trip this city stay covers
// Returns the best plan for 0, 1, … maxMoves hotel changes (each stay ≥ minLen nights).
// Dynamic programming: best[s][i][d] = cheapest way to cover the first i nights
// with s stays, the last one in district d.
export function splitStay(districts, startIdx, n, { maxMoves = 2, minLen = 2 } = {}) {
  const D = districts.length;
  if (!D || n < 1) return [];
  const prefix = districts.map((d) => {
    const p = [0];
    for (let i = 0; i < n; i++) p.push(p[i] + d.nights[startIdx + i].price);
    return p;
  });
  const cost = (d, a, b) => prefix[d][b] - prefix[d][a];

  const best = [null, Array.from({ length: n + 1 }, (_, i) => Array.from({ length: D }, (_, d) => (i >= Math.min(minLen, n) ? { c: cost(d, 0, i), prev: null } : null)))];
  const results = [];
  for (let s = 1; s <= maxMoves + 1; s++) {
    if (s > 1) {
      best[s] = Array.from({ length: n + 1 }, () => Array(D).fill(null));
      for (let i = s * minLen; i <= n; i++) {
        for (let d = 0; d < D; d++) {
          for (let j = (s - 1) * minLen; j <= i - minLen; j++) {
            for (let pd = 0; pd < D; pd++) {
              const prev = best[s - 1][j][pd];
              if (pd === d || !prev) continue;
              const c = prev.c + cost(d, j, i);
              if (!best[s][i][d] || c < best[s][i][d].c) best[s][i][d] = { c, prev: [j, pd] };
            }
          }
        }
      }
    }
    // pick the cheapest ending district and walk back through the stays
    let end = -1;
    best[s][n].forEach((cell, d) => cell && (end < 0 || cell.c < best[s][n][end].c) && (end = d));
    if (end < 0) break; // not enough nights for this many stays
    const stays = [];
    let i = n, d = end, k = s;
    while (k >= 1) {
      const cell = best[k][i][d];
      const j = cell.prev ? cell.prev[0] : 0;
      stays.unshift({ district: districts[d].name, d, from: startIdx + j, nights: i - j, cost: cost(d, j, i) });
      if (!cell.prev) break;
      [i, d] = [j, cell.prev[1]];
      k--;
    }
    results.push({ moves: s - 1, total: best[s][n][end].c, stays });
  }
  return results;
}
