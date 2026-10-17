// The core logic: turn a few sampled nights per city into a full nightly price
// series for every city in the trip, plus per-city hotel and area detail.
//
// Why sample? Checking every night of a 6-week window in 5 cities = 250+ API calls.
// The free tier is 250/month. So we check a handful of nights per city (mixing
// weekdays and weekends) and estimate the rest. Semi-accurate on purpose.
//
// The itinerary optimiser runs in the browser (public/itinerary.js) so changing
// nights-per-city is instant and costs no API calls.
import { cached } from './cache.js';
import { addDays, diffDays, fmt, isWeekendNight, range } from './dates.js';
import { labelAreas } from './areas.js';

const MAX_WINDOW_DAYS = 120;
const MAX_CITIES = 6;

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export function validate(p) {
  const today = fmt(new Date());
  p.cities = [...new Set((p.cities || []).map((c) => c.trim()).filter(Boolean))];
  if (!p.cities.length) throw badRequest('Pick at least one city.');
  if (p.cities.length > MAX_CITIES) throw badRequest(`Pick at most ${MAX_CITIES} cities.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(p.to || '')) throw badRequest('Dates must be YYYY-MM-DD.');
  if (p.from < today) throw badRequest('The earliest start date is in the past.');
  if (p.to < p.from) throw badRequest('"Latest start" must be on or after "earliest start".');
  if (diffDays(p.from, p.to) > MAX_WINDOW_DAYS) throw badRequest(`Keep the window under ${MAX_WINDOW_DAYS} days.`);
  if (p.nights < 1 || p.nights > 30) throw badRequest('Trip length must be 1–30 nights.');
  p.samples = Math.max(2, Math.min(20, Math.round(p.samples)));
}

// Spread samples evenly across the nights, ~1 in 3 on a Fri/Sat night,
// so we learn both the seasonal trend and the weekend premium.
export function pickSampleNights(nights, k) {
  if (nights.length <= k) return [...nights];
  const picked = new Set();
  for (let i = 0; i < k; i++) {
    const target = Math.round((i * (nights.length - 1)) / (k - 1));
    const wantWeekend = i % 3 === 1;
    let choice = nights[target];
    for (let off = 0; off <= 3; off++) {
      const cand = [nights[target + off], nights[target - off]].find((d) => d && isWeekendNight(d) === wantWeekend && !picked.has(d));
      if (cand) { choice = cand; break; }
    }
    picked.add(choice);
  }
  return [...picked].sort();
}

// Run async jobs with limited concurrency (be polite to the API).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// Estimate a value for every night from a few samples:
//   1. measure the weekend premium (Fri/Sat vs other nights)
//   2. remove it, linearly interpolate the trend between samples
//   3. put the premium back on weekend nights
function estimateSeries(allNights, samples, key) {
  const wk = samples.filter((s) => s.weekend).map((s) => s[key]);
  const wd = samples.filter((s) => !s.weekend).map((s) => s[key]);
  const premium = wk.length && wd.length ? median(wk) / median(wd) : 1.15;
  const norm = samples.map((s) => ({ t: diffDays(allNights[0], s.date), v: s[key] / (s.weekend ? premium : 1) }));

  return allNights.map((date) => {
    const t = diffDays(allNights[0], date);
    let v;
    if (t <= norm[0].t) v = norm[0].v;
    else if (t >= norm.at(-1).t) v = norm.at(-1).v;
    else {
      const j = norm.findIndex((n) => n.t >= t);
      const a = norm[j - 1], b = norm[j];
      v = a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
    return v * (isWeekendNight(date) ? premium : 1);
  });
}

// Sample one city and build its nightly series + hotel list.
async function sampleCity(provider, city, allNights, p, calls) {
  const dates = pickSampleNights(allNights, p.samples);
  const fetched = await mapLimit(dates, 3, async (date) => {
    const key = ['v2', provider.name, city.toLowerCase(), date, p.adults, p.currency, p.minStars].join('|');
    const { value, fromCache } = await cached(key, () =>
      provider.fetchNight({ city, date, adults: p.adults, currency: p.currency, minStars: p.minStars }),
    );
    fromCache ? calls.fromCache++ : calls.made++;
    return { date, hotels: value.hotels };
  });

  const samples = fetched
    .filter((f) => f.hotels.length >= 3)
    .map((f) => {
      const prices = f.hotels.map((h) => h.price);
      return { date: f.date, weekend: isWeekendNight(f.date), typical: median(prices), budget: quantile(prices, 0.25), hotels: f.hotels };
    });
  if (samples.length < 2) throw badRequest(`Not enough hotel prices came back for ${city}.`);

  const typical = estimateSeries(allNights, samples, 'typical');
  const budget = estimateSeries(allNights, samples, 'budget');
  const byDate = new Map(samples.map((s) => [s.date, s]));
  const nights = allNights.map((date, i) => {
    const s = byDate.get(date);
    return { date, weekend: isWeekendNight(date), sampled: Boolean(s), typical: Math.round(s ? s.typical : typical[i]), budget: Math.round(s ? s.budget : budget[i]) };
  });

  // Compare each hotel to the typical price on the nights it was seen, so a hotel
  // only spotted on a pricey Saturday isn't unfairly penalised.
  const typicalNightly = median(nights.map((n) => n.typical));
  const byId = new Map();
  for (const s of samples) {
    for (const h of s.hotels) {
      const e = byId.get(h.id) || { ...h, prices: [], ratios: [], obs: {} };
      e.prices.push(h.price);
      e.ratios.push(h.price / s.typical);
      e.obs[s.date] = h.price; // price on each night it was seen (for district splits)
      byId.set(h.id, e);
    }
  }
  const hotels = [...byId.values()].map(({ prices, ratios, price, ...h }) => ({
    ...h,
    priceLow: Math.min(...prices),
    priceHigh: Math.max(...prices),
    estNightly: Math.round(median(ratios) * typicalNightly),
  }));

  return {
    name: city,
    lat: median(hotels.map((h) => h.lat)),
    lng: median(hotels.map((h) => h.lng)),
    typicalNightly: Math.round(typicalNightly),
    sampledNights: samples.length,
    sampleTypical: Object.fromEntries(samples.map((s) => [s.date, s.typical])),
    nights,
    hotels,
  };
}

const tripNights = (p) => range(p.from, addDays(p.to, p.nights - 1));

// Overview for every chosen city: nightly price series (no hotel lists, to keep it light).
export async function planTrip(provider, params) {
  validate(params);
  const allNights = tripNights(params);
  const calls = { made: 0, fromCache: 0 };
  const cities = await mapLimit(params.cities, 2, async (name) => {
    try {
      const { hotels, sampleTypical, ...city } = await sampleCity(provider, name, allNights, params, calls);
      return { ...city, hotelCount: hotels.length };
    } catch (err) {
      return { name, error: err.message };
    }
  });
  if (cities.every((c) => c.error)) throw badRequest(cities[0].error);

  return {
    provider: provider.name,
    live: provider.live,
    params: { ...params },
    allNights,
    cities,
    apiCalls: calls,
  };
}

// Detail for one city: hotels and named areas. Uses the same sample nights as
// planTrip, so it's served from the cache (free).
export async function planCity(provider, params) {
  validate(params);
  const calls = { made: 0, fromCache: 0 };
  const city = await sampleCity(provider, params.cities[0], tripNights(params), params, calls);
  const areas = await labelAreas(city.hotels, { live: provider.live });
  return { name: city.name, hotels: city.hotels, areas, districts: districtNights(city, areas), apiCalls: calls };
}

// Price per night for each district, so the browser can find the cheapest
// combination of districts (e.g. 3 nights in Ueno, then 4 in Asakusa).
// A night uses real prices of the district's hotels when we checked that night;
// otherwise it's estimated from how the district usually compares to the city.
function districtNights(city, areas) {
  const byId = new Map(city.hotels.map((h) => [h.id, h]));
  return areas.map((a) => {
    const hs = a.hotelIds.map((id) => byId.get(id)).filter(Boolean);
    const ratios = hs.flatMap((h) => Object.entries(h.obs).map(([d, p]) => p / city.sampleTypical[d]));
    const ratio = median(ratios) ?? 1;
    return {
      name: a.name || `Near ${a.example}`,
      lat: a.lat,
      lng: a.lng,
      hotelIds: a.hotelIds,
      nights: city.nights.map((n) => {
        const seen = hs.map((h) => h.obs[n.date]).filter(Number.isFinite);
        return seen.length ? { price: Math.round(median(seen)), seen: true } : { price: Math.round(ratio * n.typical), seen: false };
      }),
    };
  });
}
