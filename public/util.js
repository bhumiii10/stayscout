// Small shared helpers for the frontend.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const DAY = 86400_000;
export const toDate = (s) => new Date(s + 'T00:00:00Z');
export const addDays = (s, n) => new Date(toDate(s).getTime() + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
export const fmtDay = (s, opts = { month: 'short', day: 'numeric' }) => toDate(s).toLocaleDateString('en', { ...opts, timeZone: 'UTC' });
export const fmtDayW = (s) => fmtDay(s, { weekday: 'short', month: 'short', day: 'numeric' });

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const moneyFormatter = (currency) => {
  const f = new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 });
  return (n) => f.format(n);
};

// Sequential colour scale: 7 steps of one hue (--s0 light … --s6 dark).
export const STEPS = 7;
export function scale(values) {
  const min = Math.min(...values), max = Math.max(...values);
  const step = (v) => (max <= min ? 3 : Math.min(STEPS - 1, Math.floor(((v - min) / (max - min)) * STEPS)));
  return { min, max, step, color: (v) => `var(--s${step(v)})`, isDark: (v) => step(v) >= 4 };
}

export function legendHtml(sc, money, label) {
  const bar = Array.from({ length: STEPS }, (_, i) => `<span style="background:var(--s${i})"></span>`).join('');
  return `<span>${money(sc.min)}</span><span class="bar">${bar}</span><span>${money(sc.max)}</span><span class="muted">${label}</span>`;
}

// Tooltip that follows the pointer.
const tip = document.getElementById('tip');
export function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = e.clientY + 14 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 14;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
export const hideTip = () => (tip.hidden = true);
export function tipOn(el, html) {
  el.addEventListener('mousemove', (e) => showTip(e, typeof html === 'function' ? html() : html));
  el.addEventListener('mouseleave', hideTip);
}

// Links to book a hotel: Booking.com (dates + guests prefilled) and Google Hotels
// (where our prices come from; lists every site's offer). Agoda isn't included:
// its links need Agoda's internal hotel IDs.
export function bookLinks(h, cityName, checkin, nights, { adults = 2, currency = 'USD' } = {}) {
  const checkout = addDays(checkin, nights);
  const booking = 'https://www.booking.com/searchresults.html?' + new URLSearchParams({
    ss: `${h.name}, ${cityName}`, checkin, checkout, group_adults: adults, no_rooms: 1, group_children: 0, lang: 'en-us', selected_currency: currency,
  });
  const google = 'https://www.google.com/travel/search?' + new URLSearchParams({ q: `${h.name} ${cityName}`, hl: 'en' });
  const site = h.link ? ` · <a href="${esc(h.link)}" target="_blank" rel="noopener">Hotel site</a>` : '';
  return `<span class="book"><a href="${esc(booking)}" target="_blank" rel="noopener">Booking.com</a> · <a href="${esc(google)}" target="_blank" rel="noopener">Google Hotels</a>${site}</span>`;
}

// Hotels × nights grid: which hotel is cheapest on which night.
// hotels: [{ name, obs: { 'YYYY-MM-DD': price } }]
export function renderNightGrid(gridEl, legendEl, hotels, dates, money, { highlight } = {}) {
  const n = dates.length;
  const rows = hotels
    .map((h) => {
      const prices = dates.map((d) => h.obs?.[d]);
      const seen = prices.filter(Number.isFinite);
      return { h, prices, seen: seen.length, avg: seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length : Infinity };
    })
    .filter((r) => r.seen >= Math.max(1, Math.ceil(n / 2)))
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 12);
  if (!rows.length) {
    gridEl.innerHTML = '<p class="muted small">No nightly prices for these dates.</p>';
    legendEl.innerHTML = '';
    return;
  }
  const sc = scale(rows.flatMap((r) => r.prices.filter(Number.isFinite)));
  legendEl.innerHTML = legendHtml(sc, money, 'per night');
  const cheapest = dates.map((_, i) => Math.min(...rows.map((r) => r.prices[i]).filter(Number.isFinite)));
  const isWe = (d) => [5, 6].includes(toDate(d).getUTCDay());
  let html = `<div class="mx wide hotels" style="grid-template-columns: auto repeat(${n}, 48px)"><div class="lbl"></div>`;
  html += dates.map((d) => `<div class="dn ${isWe(d) ? 'we' : ''}">${fmtDay(d, { weekday: 'short' })}<br>${Number(d.slice(8))}</div>`).join('');
  for (const r of rows) {
    const mark = highlight?.has(r.h.name) ? ' ★' : '';
    html += `<div class="lbl" title="${esc(r.h.name)}">${esc(r.h.name)}${mark}</div>`;
    html += r.prices
      .map((p, i) => Number.isFinite(p)
        ? `<div class="c ${sc.isDark(p) ? 'dark' : ''} ${p === cheapest[i] ? 'in' : ''}" style="background:${sc.color(p)}" title="${esc(r.h.name)}, night of ${fmtDayW(dates[i])}: ${money(p)}">${Math.round(p)}</div>`
        : '<div class="c empty"></div>')
      .join('');
  }
  gridEl.innerHTML = html + '</div>';
}
