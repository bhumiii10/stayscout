// Disk cache so the same (city, date) lookup never burns a second API call.
// Free SerpApi = 250 searches/month, so this matters.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// On Vercel only /tmp is writable (and it's wiped now and then), so the cache is best-effort there.
const DIR = process.env.VERCEL ? join(tmpdir(), 'stayscout-cache') : join(process.cwd(), '.cache');
const TTL_MS = (Number(process.env.CACHE_HOURS) || 24) * 3600_000;

const fileFor = (key) => join(DIR, createHash('sha1').update(key).digest('hex') + '.json');

export async function cached(key, fn) {
  const file = fileFor(key);
  try {
    const { savedAt, value } = JSON.parse(await readFile(file, 'utf8'));
    if (Date.now() - savedAt < TTL_MS) return { value, fromCache: true };
  } catch {
    // miss
  }
  const value = await fn();
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(file, JSON.stringify({ key, savedAt: Date.now(), value }));
  } catch (err) {
    console.warn('cache write failed:', err.message); // not fatal
  }
  return { value, fromCache: false };
}
