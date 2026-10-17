// Country → popular cities.
// A curated list covers common trips (with rough hotel price levels, used by demo mode).
// Any other country falls back to Wikidata (free, no key): its largest cities.
import { cached } from './cache.js';

// [name, lat, lng, typical USD/night for demo]
const COUNTRIES = {
  Japan: {
    peaks: [['12-28', '01-03', 1.5], ['03-25', '04-08', 1.6], ['04-29', '05-05', 1.7], ['08-11', '08-16', 1.4], ['11-15', '11-30', 1.25]],
    cities: [
      ['Tokyo', 35.6812, 139.7671, 140], ['Kyoto', 35.0116, 135.7681, 130], ['Osaka', 34.6937, 135.5023, 105],
      ['Hiroshima', 34.3853, 132.4553, 90], ['Nara', 34.6851, 135.8048, 95], ['Hakone', 35.2324, 139.1069, 180],
      ['Kanazawa', 36.5613, 136.6562, 110], ['Fukuoka', 33.5904, 130.4017, 95], ['Sapporo', 43.0618, 141.3545, 100],
      ['Nagoya', 35.1815, 136.9066, 95],
    ],
  },
  'South Korea': {
    peaks: [['07-20', '08-20', 1.35], ['09-28', '10-05', 1.3]],
    cities: [['Seoul', 37.5665, 126.978, 110], ['Busan', 35.1796, 129.0756, 90], ['Jeju', 33.4996, 126.5312, 100], ['Gyeongju', 35.8562, 129.2247, 80], ['Incheon', 37.4563, 126.7052, 85]],
  },
  Thailand: {
    peaks: [['12-15', '02-28', 1.4], ['04-12', '04-16', 1.3]],
    cities: [['Bangkok', 13.7563, 100.5018, 70], ['Chiang Mai', 18.7883, 98.9853, 45], ['Phuket', 7.8804, 98.3923, 85], ['Krabi', 8.0863, 98.9063, 65], ['Koh Samui', 9.512, 100.0136, 95], ['Pattaya', 12.9236, 100.8825, 55]],
  },
  Vietnam: {
    peaks: [['01-20', '02-15', 1.4], ['06-15', '08-15', 1.2]],
    cities: [['Hanoi', 21.0278, 105.8342, 45], ['Ho Chi Minh City', 10.8231, 106.6297, 50], ['Da Nang', 16.0544, 108.2022, 45], ['Hoi An', 15.8801, 108.338, 45], ['Ha Long', 20.9101, 107.1839, 55], ['Nha Trang', 12.2388, 109.1967, 45]],
  },
  Indonesia: {
    peaks: [['07-01', '08-31', 1.35], ['12-20', '01-05', 1.4]],
    cities: [['Ubud', -8.5069, 115.2625, 60], ['Seminyak', -8.6913, 115.1682, 85], ['Jakarta', -6.2088, 106.8456, 55], ['Yogyakarta', -7.7956, 110.3695, 35], ['Lombok', -8.65, 116.32, 50]],
  },
  India: {
    peaks: [['10-15', '03-15', 1.3], ['12-20', '01-02', 1.5]],
    cities: [
      ['Delhi', 28.6139, 77.209, 60], ['Mumbai', 19.076, 72.8777, 80], ['Jaipur', 26.9124, 75.7873, 50],
      ['Agra', 27.1767, 78.0081, 45], ['Goa', 15.4909, 73.8278, 60], ['Udaipur', 24.5854, 73.7125, 60],
      ['Varanasi', 25.3176, 82.9739, 40], ['Kochi', 9.9312, 76.2673, 45], ['Rishikesh', 30.0869, 78.2676, 35], ['Bengaluru', 12.9716, 77.5946, 60],
    ],
  },
  'United Arab Emirates': {
    peaks: [['11-15', '03-31', 1.35], ['12-20', '01-02', 1.6]],
    cities: [['Dubai', 25.2048, 55.2708, 140], ['Abu Dhabi', 24.4539, 54.3773, 120]],
  },
  Turkey: {
    peaks: [['06-15', '09-10', 1.35]],
    cities: [['Istanbul', 41.0082, 28.9784, 90], ['Cappadocia', 38.6431, 34.8289, 110], ['Antalya', 36.8969, 30.7133, 80], ['Izmir', 38.4237, 27.1428, 70], ['Bodrum', 37.0344, 27.4305, 110]],
  },
  Greece: {
    peaks: [['06-10', '09-15', 1.5]],
    cities: [['Athens', 37.9838, 23.7275, 110], ['Santorini', 36.3932, 25.4615, 220], ['Mykonos', 37.4467, 25.3289, 230], ['Heraklion', 35.3387, 25.1442, 90], ['Thessaloniki', 40.6401, 22.9444, 80]],
  },
  Italy: {
    peaks: [['05-15', '09-15', 1.35], ['12-22', '01-02', 1.3]],
    cities: [['Rome', 41.9028, 12.4964, 160], ['Florence', 43.7696, 11.2558, 160], ['Venice', 45.4408, 12.3155, 190], ['Milan', 45.4642, 9.19, 150], ['Naples', 40.8518, 14.2681, 110], ['Amalfi', 40.634, 14.6027, 230], ['La Spezia', 44.1025, 9.824, 140]],
  },
  Spain: {
    peaks: [['06-15', '09-10', 1.35], ['04-10', '04-20', 1.3]],
    cities: [['Madrid', 40.4168, -3.7038, 130], ['Barcelona', 41.3874, 2.1686, 160], ['Seville', 37.3891, -5.9845, 120], ['Granada', 37.1773, -3.5986, 100], ['Valencia', 39.4699, -0.3763, 110], ['Malaga', 36.7213, -4.4214, 115], ['Palma', 39.5696, 2.6502, 150]],
  },
  Portugal: {
    peaks: [['06-15', '09-15', 1.35]],
    cities: [['Lisbon', 38.7223, -9.1393, 130], ['Porto', 41.1579, -8.6291, 110], ['Lagos', 37.1028, -8.6728, 120], ['Sintra', 38.8029, -9.3817, 120], ['Funchal', 32.6669, -16.9241, 100]],
  },
  France: {
    peaks: [['06-15', '08-31', 1.3], ['12-20', '01-02', 1.35]],
    cities: [['Paris', 48.8566, 2.3522, 190], ['Nice', 43.7102, 7.262, 150], ['Lyon', 45.764, 4.8357, 110], ['Marseille', 43.2965, 5.3698, 110], ['Bordeaux', 44.8378, -0.5792, 110], ['Strasbourg', 48.5734, 7.7521, 100]],
  },
  Germany: {
    peaks: [['06-15', '08-31', 1.2], ['09-20', '10-05', 1.6], ['11-25', '12-23', 1.25]],
    cities: [['Berlin', 52.52, 13.405, 110], ['Munich', 48.1351, 11.582, 140], ['Hamburg', 53.5511, 9.9937, 120], ['Frankfurt', 50.1109, 8.6821, 120], ['Cologne', 50.9375, 6.9603, 110]],
  },
  'United Kingdom': {
    peaks: [['06-15', '08-31', 1.3], ['12-20', '01-02', 1.25]],
    cities: [['London', 51.5074, -0.1278, 180], ['Edinburgh', 55.9533, -3.1883, 150], ['Manchester', 53.4808, -2.2426, 110], ['Bath', 51.3811, -2.359, 150], ['Liverpool', 53.4084, -2.9916, 100]],
  },
  Netherlands: {
    peaks: [['04-01', '05-10', 1.35], ['06-15', '08-31', 1.25]],
    cities: [['Amsterdam', 52.3676, 4.9041, 190], ['Rotterdam', 51.9244, 4.4777, 120], ['Utrecht', 52.0907, 5.1214, 120], ['The Hague', 52.0705, 4.3007, 120]],
  },
  Switzerland: {
    peaks: [['06-15', '09-10', 1.3], ['12-20', '03-15', 1.35]],
    cities: [['Zurich', 47.3769, 8.5417, 200], ['Geneva', 46.2044, 6.1432, 200], ['Lucerne', 47.0502, 8.3093, 190], ['Interlaken', 46.6863, 7.8632, 200], ['Zermatt', 46.0207, 7.7491, 260]],
  },
  'United States': {
    peaks: [['06-15', '08-31', 1.25], ['12-20', '01-02', 1.3]],
    cities: [['New York', 40.7128, -74.006, 230], ['Los Angeles', 34.0522, -118.2437, 180], ['San Francisco', 37.7749, -122.4194, 200], ['Las Vegas', 36.1699, -115.1398, 120], ['Miami', 25.7617, -80.1918, 190], ['Chicago', 41.8781, -87.6298, 170], ['Washington DC', 38.9072, -77.0369, 190], ['New Orleans', 29.9511, -90.0715, 150]],
  },
  Mexico: {
    peaks: [['12-15', '04-15', 1.35]],
    cities: [['Mexico City', 19.4326, -99.1332, 90], ['Cancun', 21.1619, -86.8515, 150], ['Tulum', 20.2114, -87.4654, 160], ['Oaxaca', 17.0732, -96.7266, 70], ['Guadalajara', 20.6597, -103.3496, 70]],
  },
  Australia: {
    peaks: [['12-15', '01-31', 1.4]],
    cities: [['Sydney', -33.8688, 151.2093, 170], ['Melbourne', -37.8136, 144.9631, 150], ['Brisbane', -27.4698, 153.0251, 140], ['Cairns', -16.9186, 145.7781, 130], ['Gold Coast', -28.0167, 153.4, 140], ['Perth', -31.9505, 115.8605, 140]],
  },
  Singapore: { peaks: [['12-15', '01-02', 1.3]], cities: [['Singapore', 1.3521, 103.8198, 180]] },
};

const ALIASES = {
  uk: 'United Kingdom', england: 'United Kingdom', 'great britain': 'United Kingdom', britain: 'United Kingdom',
  usa: 'United States', us: 'United States', america: 'United States', 'united states of america': 'United States',
  korea: 'South Korea', uae: 'United Arab Emirates', holland: 'Netherlands', 'türkiye': 'Turkey', turkiye: 'Turkey',
};

const norm = (s) => s.trim().toLowerCase();

function findCurated(query) {
  const q = norm(query);
  const name = ALIASES[q] || Object.keys(COUNTRIES).find((c) => norm(c) === q);
  return name ? { name, ...COUNTRIES[name] } : null;
}

const toCity = ([name, lat, lng, base]) => ({ name, lat, lng, base });

// Used by demo mode: look up a city in the curated list (any country).
export function curatedCity(cityName) {
  const q = norm(cityName.split(',')[0]);
  for (const [country, data] of Object.entries(COUNTRIES)) {
    const c = data.cities.find((c) => norm(c[0]) === q);
    if (c) return { ...toCity(c), country, peaks: data.peaks };
  }
  return null;
}

async function wikidataCities(query) {
  const label = query.trim().replace(/["\\]/g, '');
  const sparql = `
    SELECT ?cityLabel ?pop ?coord WHERE {
      ?country wdt:P31 wd:Q6256; rdfs:label ?cl. FILTER(LCASE(STR(?cl)) = "${label.toLowerCase()}" && LANG(?cl) = "en")
      ?city wdt:P17 ?country; wdt:P31 wd:Q515; wdt:P1082 ?pop; wdt:P625 ?coord.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } ORDER BY DESC(?pop) LIMIT 12`;
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql);
  const { value } = await cached(`wikidata|${label.toLowerCase()}`, async () => {
    const res = await fetch(url, { headers: { 'User-Agent': 'StayScout/0.2 (personal trip planner)' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('Wikidata lookup failed');
    const rows = (await res.json()).results.bindings;
    const seen = new Set();
    return rows
      .map((r) => {
        const [lng, lat] = r.coord.value.replace(/Point\(|\)/g, '').split(' ').map(Number);
        return { name: r.cityLabel.value, lat, lng };
      })
      .filter((c) => !seen.has(c.name) && seen.add(c.name))
      .slice(0, 10);
  });
  return value;
}

// Resolve what the user typed: a country (→ its cities) or a single city.
export async function resolvePlace(query) {
  const curated = findCurated(query);
  if (curated) return { type: 'country', country: curated.name, cities: curated.cities.map(toCity) };
  const known = curatedCity(query);
  if (known) return { type: 'city', country: known.country, cities: [known] };
  try {
    const cities = await wikidataCities(query);
    if (cities.length) return { type: 'country', country: query.trim(), cities };
  } catch {
    // offline or Wikidata down: treat it as a city
  }
  return { type: 'city', country: null, cities: [{ name: query.trim() }] };
}
