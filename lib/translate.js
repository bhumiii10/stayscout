// Make sure names show in English.
// Most names already come back in English (we ask Google/OSM for English), but some
// hotels only have a local-script name (e.g. ホテル京阪). Those go through MyMemory's
// free translation API (no key; ~5,000 words/day), and every result is cached.
import { cached } from './cache.js';

const SCRIPTS = [
  [/[぀-ヿ]/, 'ja'], // hiragana / katakana
  [/[가-힯]/, 'ko'], // hangul
  [/[฀-๿]/, 'th'],
  [/[一-鿿]/, 'zh'], // plain CJK ideographs (Japanese kanji is caught by country hint below)
  [/[Ѐ-ӿ]/, 'ru'],
  [/[Ͱ-Ͽ]/, 'el'],
  [/[؀-ۿ]/, 'ar'],
  [/[ऀ-ॿ]/, 'hi'],
  [/[֐-׿]/, 'he'],
];

export const needsTranslation = (s) => typeof s === 'string' && SCRIPTS.some(([re]) => re.test(s));

function sourceLang(text, hint) {
  const found = SCRIPTS.find(([re]) => re.test(text))?.[1];
  if (found === 'zh' && hint === 'ja') return 'ja';
  return found || hint || 'auto';
}

export async function toEnglish(text, hint) {
  if (!needsTranslation(text)) return text;
  const lang = sourceLang(text, hint);
  try {
    const { value } = await cached(`tr|${lang}|${text}`, async () => {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${lang}|en`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const j = await res.json();
      const out = j?.responseData?.translatedText;
      if (!out || /MYMEMORY WARNING|INVALID/i.test(out)) throw new Error('translation failed');
      return out;
    });
    return value;
  } catch {
    return text; // keep the original rather than failing the search
  }
}

// Translate a list of hotels' names (and areas) in place, a few at a time.
export async function translateHotels(hotels, hint) {
  const todo = hotels.filter((h) => needsTranslation(h.name));
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(todo.slice(i, i + 4).map(async (h) => (h.name = await toEnglish(h.name, hint))));
  }
  return hotels;
}
