// Disk cache so the same (city, date) lookup never burns a second API call.
// Free SerpApi = 250 searches/month, so this matters.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// On Vercel only /tmp is writable (and it's wiped now and then), so the cache is best-effort there.
const DIR = process.env.VERCEL ? join(tmpdir(), 'stayscout-cache') : join(process.cwd(), '.cache');
// Prices go stale fast (1 hour by default); static things like city lists keep a week.
export const PRICE_TTL = (Number(process.env.PRICE_CACHE_MINUTES) || 60) * 60_000;
const DEFAULT_TTL = 7 * 24 * 3600_000;

const fileFor = (key) => join(DIR, createHash('sha1').update(key).digest('hex') + '.json');

// fresh: skip the cache and fetch again. Returns savedAt so the UI can say how old a price is.
export async function cached(key, fn, { ttl = DEFAULT_TTL, fresh = false } = {}) {
  const file = fileFor(key);
  if (!fresh) {
    try {
      const { savedAt, value } = JSON.parse(await readFile(file, 'utf8'));
      if (Date.now() - savedAt < ttl) return { value, fromCache: true, savedAt };
    } catch {
      // miss
    }
  }
  const value = await fn();
  const savedAt = Date.now();
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(file, JSON.stringify({ key, savedAt, value }));
  } catch (err) {
    console.warn('cache write failed:', err.message); // not fatal
  }
  return { value, fromCache: false, savedAt };
}
