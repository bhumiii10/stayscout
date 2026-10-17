// DEMO provider: fake but realistic-shaped prices, so the app works with no API key.
// Works for every city in lib/countries.js. Prices react to weekends and each
// country's peak seasons, so the calendar has something real-looking to show.
import { isWeekendNight } from './dates.js';
import { curatedCity } from './countries.js';

// Hand-made neighbourhoods for a few cities; others get generic ones.
const HOODS = {
  Tokyo: [['Shinjuku', 35.6938, 139.7034, 1.15], ['Shibuya', 35.658, 139.7016, 1.25], ['Ginza', 35.6717, 139.765, 1.45], ['Asakusa', 35.7148, 139.7967, 0.8], ['Ueno', 35.7138, 139.7773, 0.75], ['Ikebukuro', 35.7295, 139.7109, 0.85], ['Shinagawa', 35.6285, 139.7387, 1.0], ['Kinshicho', 35.6967, 139.8146, 0.7]],
  Kyoto: [['Gion', 35.0037, 135.7788, 1.4], ['Kyoto Station', 34.9858, 135.7588, 0.95], ['Kawaramachi', 35.0039, 135.7693, 1.15], ['Arashiyama', 35.0094, 135.6668, 1.2], ['Fushimi', 34.9363, 135.7618, 0.7], ['Nijo', 35.0142, 135.7481, 0.85]],
  Osaka: [['Namba', 34.6659, 135.5013, 1.1], ['Umeda', 34.7025, 135.4959, 1.25], ['Shinsekai', 34.6525, 135.5063, 0.7], ['Shin-Osaka', 34.7334, 135.5001, 0.9], ['Tennoji', 34.6466, 135.5133, 0.8], ['Bay Area', 34.6547, 135.4289, 1.05]],
  Paris: [['Le Marais', 48.859, 2.3622, 1.35], ['Saint-Germain', 48.8541, 2.3337, 1.5], ['Montmartre', 48.8867, 2.3431, 0.95], ['Bastille', 48.8532, 2.3692, 1.0], ['La Défense', 48.892, 2.236, 0.8], ['Gare du Nord', 48.8809, 2.3553, 0.75]],
};
const GENERIC = [['Old Town', 0, 0, 1.3], ['City Centre', 0.012, 0.01, 1.2], ['Station Area', -0.01, 0.015, 0.9], ['Riverside', 0.015, -0.014, 1.05], ['University District', -0.02, -0.012, 0.8], ['Outskirts', 0.03, 0.03, 0.68]];

// Small deterministic RNG so the same inputs always give the same "prices".
function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) (h = Math.imul(h ^ str.charCodeAt(i), 3432918353)), (h = (h << 13) | (h >>> 19));
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

// Districts behave differently: business areas empty out at weekends, tourist areas fill up.
// That's what makes splitting a stay across districts worth it.
const BUSINESS = ['Shinagawa', 'Shinjuku', 'Umeda', 'Shin-Osaka', 'Kyoto Station', 'Station Area', 'City Centre', 'La Défense', 'Gare du Nord', 'Ikebukuro'];
const LEISURE = ['Asakusa', 'Gion', 'Arashiyama', 'Old Town', 'Namba', 'Montmartre', 'Le Marais', 'Riverside', 'Shibuya', 'Kawaramachi'];
function weekendFactor(area) {
  if (BUSINESS.includes(area)) return 0.9;
  if (LEISURE.includes(area)) return 1.4;
  return 1.2;
}
// Each district also has its own busy/quiet spells (events, conferences) in ~3-day blocks.
function districtSpell(city, area, date) {
  const block = Math.floor(Number(date.slice(8)) / 3);
  return 0.86 + seeded(`${city}|${area}|${date.slice(0, 7)}|${block}`)() * 0.28;
}

function seasonFactor(peaks, date) {
  const md = date.slice(5);
  let f = 1;
  for (const [start, end, factor] of peaks) {
    const inside = start <= end ? md >= start && md <= end : md >= start || md <= end;
    if (inside) f = Math.max(f, factor);
  }
  return f;
}

function hotelsFor(city) {
  const rand = seeded(city.name);
  const hoods = HOODS[city.name] || GENERIC.map(([n, dlat, dlng, f]) => [n, city.lat + dlat, city.lng + dlng, f]);
  const hotels = [];
  for (const [hood, lat, lng, factor] of hoods) {
    for (let i = 0; i < 4; i++) {
      const stars = 2 + Math.floor(rand() * 4);
      hotels.push({
        id: `${city.name}-${hood}-${i}`,
        name: `${['Hotel', 'Inn', 'Stay', 'Residence'][i]} ${hood} ${['Central', 'Garden', 'Plaza', 'Annex'][Math.floor(rand() * 4)]}`,
        lat: lat + (rand() - 0.5) * 0.012,
        lng: lng + (rand() - 0.5) * 0.012,
        stars,
        rating: Math.round((3.5 + rand() * 1.4) * 10) / 10,
        basePrice: city.base * factor * (0.55 + stars * 0.17) * (0.85 + rand() * 0.3),
        area: hood,
        link: null,
      });
    }
  }
  return hotels;
}

export function demoProvider() {
  return {
    name: 'Demo data (fake prices)',
    live: false,

    async fetchNight({ city: cityName, date, minStars, currency }) {
      const city = curatedCity(cityName);
      if (!city) {
        const err = new Error(`Demo mode doesn't know "${cityName}". Add a SERPAPI_KEY for real prices anywhere.`);
        err.status = 400;
        throw err;
      }
      const fx = { USD: 1, EUR: 0.92, GBP: 0.79, INR: 84, JPY: 150, AUD: 1.52 }[currency] || 1;
      const season = seasonFactor(city.peaks, date);
      const weekend = isWeekendNight(date);
      const hotels = hotelsFor(city)
        .filter((h) => h.stars >= minStars)
        .map(({ basePrice, ...h }) => {
          const noise = 0.94 + seeded(h.id + date)() * 0.12;
          const local = (weekend ? weekendFactor(h.area) : 1) * districtSpell(city.name, h.area, date);
          return { ...h, price: Math.round(basePrice * season * local * noise * fx) };
        });
      return { hotels };
    },
  };
}
