// API route handlers, shared by the local server (dev-server.js) and Vercel (api/*.js).
// Each takes (req, res) using only plain Node APIs, so it runs the same in both.
import { checkStay, findSwitch, planCity, planTrip } from './plan.js';
import { getProvider } from './providers.js';
import { resolvePlace } from './countries.js';

let provider; // created on first use (so env vars are loaded first)
const getP = () => (provider ??= getProvider());

// Optional: set ACCESS_CODE so strangers who find your URL can't burn your API quota.
const ACCESS_CODE = process.env.ACCESS_CODE || '';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function tripParams(q) {
  return {
    cities: (q.get('cities') || '').split(','),
    from: q.get('from'),
    to: q.get('to'),
    nights: Number(q.get('nights')) || 7,
    adults: Number(q.get('adults')) || 2,
    currency: (q.get('currency') || 'USD').toUpperCase(),
    samples: Number(q.get('samples')) || 5,
    minStars: Number(q.get('minStars')) || 0,
    noHostels: q.get('noHostels') === '1',
  };
}

// Wraps a handler: parses the query, checks the access code, turns errors into JSON.
function route(fn, { open = false } = {}) {
  return async (req, res) => {
    const q = new URL(req.url, 'http://localhost').searchParams;
    if (!open && ACCESS_CODE && req.headers['x-access-code'] !== ACCESS_CODE) {
      return sendJson(res, 401, { error: 'Access code required.' });
    }
    try {
      sendJson(res, 200, await fn(q));
    } catch (err) {
      if (!err.status) console.error(err);
      sendJson(res, err.status || 500, { error: err.message });
    }
  };
}

export const info = route(
  async () => ({
    provider: getP().name,
    live: getP().live,
    needsCode: Boolean(ACCESS_CODE),
    deployed: Boolean(process.env.VERCEL), // a deployed site without a key is a setup mistake, not a choice
  }),
  { open: true },
);
export const place = route(async (q) => resolvePlace(q.get('q') || ''));
export const trip = route(async (q) => planTrip(getP(), tripParams(q)));
export const city = route(async (q) => planCity(getP(), tripParams(q)));
export const stay = route(async (q) =>
  checkStay(getP(), {
    city: (q.get('city') || '').trim(),
    area: (q.get('area') || '').trim() || undefined,
    checkin: q.get('checkin'),
    checkout: q.get('checkout'),
    adults: Number(q.get('adults')) || 2,
    currency: (q.get('currency') || 'USD').toUpperCase(),
    minStars: Number(q.get('minStars')) || 0,
    noHostels: q.get('noHostels') === '1',
  }),
);
export const hotelswitch = route(async (q) =>
  findSwitch(getP(), {
    city: (q.get('city') || '').trim(),
    checkin: q.get('checkin'),
    checkout: q.get('checkout'),
    minNights: Number(q.get('minNights')) || 2,
    minRating: Number(q.get('minRating')) || 0,
    adults: Number(q.get('adults')) || 2,
    currency: (q.get('currency') || 'USD').toUpperCase(),
    minStars: Number(q.get('minStars')) || 0,
    noHostels: q.get('noHostels') === '1',
    fresh: q.get('fresh') === '1',
  }),
);
