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
