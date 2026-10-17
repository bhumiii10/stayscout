// A "provider" answers one question: what hotels + prices exist in <city>
// for a 1-night stay starting <date>? Everything else is built on top of that.
//
// Shape returned by fetchNight():
//   { hotels: [{ id, name, lat, lng, price, stars, rating, link }] }
import { serpapiProvider } from './serpapi.js';
import { demoProvider } from './demo.js';

export function getProvider() {
  if (process.env.SERPAPI_KEY) return serpapiProvider(process.env.SERPAPI_KEY);
  console.warn('No SERPAPI_KEY set — using DEMO data (fake prices). See README.');
  return demoProvider();
}
