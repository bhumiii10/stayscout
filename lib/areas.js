// Group hotels into ~1.5 km grid squares and find which squares are cheaper.
// Area names come from OpenStreetMap's free Nominatim reverse geocoder (live mode).
import { cached } from './cache.js';
import { toEnglish } from './translate.js';

const CELL_DEG = 0.014; // ~1.5 km
const MAX_LABELS = 10; // Nominatim's rule: max 1 request/second, so keep this small

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reverseGeocode(lat, lng) {
  const key = `nominatim-en|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  const { value, fromCache } = await cached(key, async () => {
    // accept-language=en → English names instead of the local script (e.g. 浅草 → Asakusa)
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=en&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'StayScout/0.2 (personal trip planner)', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(5000),
    });
    const j = await res.json();
    const a = j.address || {};
    const name = a.neighbourhood || a.quarter || a.suburb || a.city_district || a.town || a.city || null;
    return name && toEnglish(name);
  });
  return { name: value, fromCache };
}

export async function labelAreas(hotels, { live }) {
  const cells = new Map();
  for (const h of hotels) {
    const key = `${Math.floor(h.lat / CELL_DEG)}:${Math.floor(h.lng / CELL_DEG)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(h);
  }

  const areas = [...cells.values()]
    .filter((hs) => hs.length >= 2)
    .map((hs) => {
      const names = hs.map((h) => h.area).filter(Boolean);
      return {
        lat: hs.reduce((a, h) => a + h.lat, 0) / hs.length,
        lng: hs.reduce((a, h) => a + h.lng, 0) / hs.length,
        hotelCount: hs.length,
        hotelIds: hs.map((h) => h.id),
        estNightly: Math.round(median(hs.map((h) => h.estNightly))),
        name: names.length ? names.sort((a, b) => names.filter((n) => n === b).length - names.filter((n) => n === a).length)[0] : null,
        example: hs.sort((a, b) => a.estNightly - b.estNightly)[0].name,
      };
    })
    .sort((a, b) => a.estNightly - b.estNightly);

  if (live) {
    for (const area of areas.slice(0, MAX_LABELS)) {
      try {
        const { name, fromCache } = await reverseGeocode(area.lat, area.lng);
        area.name = name;
        if (!fromCache) await sleep(1100);
      } catch {
        // name stays null; the UI falls back to "near <hotel>"
      }
    }
  }
  // Neighbouring grid squares often get the same name; merge them.
  const merged = [];
  for (const area of areas) {
    const same = area.name && merged.find((m) => m.name === area.name);
    if (same) {
      same.hotelCount += area.hotelCount;
      same.hotelIds.push(...area.hotelIds);
    }
    else merged.push(area);
  }
  return merged;
}
