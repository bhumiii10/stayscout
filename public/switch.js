// Hotel switch: the main tool.
// For a fixed stay in one city: is it cheaper to stay at one hotel, or to move once?
// /api/hotelswitch prices every split with real quotes for those exact nights.
import { $, $$, addDays, bookLinks, diffDays, esc, fmtDay, fmtDayW, moneyFormatter, renderNightGrid } from './util.js';
import { api, info } from './api.js';

const form = $('#swForm');
const status = $('#swStatus');
let live = false;
let money = moneyFormatter('USD');
let current = null; // { params, res }
const results = new Map();

// ---------- top-level views (Hotel switch / Trip planner) ----------
function showView(view) {
  $('#switchView').hidden = view !== 'switch';
  $('#plannerView').hidden = view !== 'planner';
  $$('.view-tab').forEach((t) => (t.dataset.view === view ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current')));
  window.scrollTo({ top: 0 });
}
$$('.view-tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

// ---------- form ----------
(function init() {
  const today = new Date().toISOString().slice(0, 10);
  form.checkin.value = addDays(today, 30);
  form.checkout.value = addDays(today, 37);
  form.checkin.min = form.checkout.min = today;
  info.then((i) => {
    live = i.live;
    const pill = $('#mode');
    pill.textContent = live ? 'Live prices · Google Hotels' : 'Demo mode · fake prices';
    pill.classList.toggle('live', live);
    if (!live) {
      const banner = $('#demoBanner');
      banner.innerHTML = i.deployed
        ? '<b>Not connected to live prices.</b> This site has no SerpApi key, so every hotel and price here is made up. To fix: Vercel → your project → Settings → Environment Variables → add <code>SERPAPI_KEY</code> (tick Production) → Deployments → Redeploy.'
        : '<b>Demo mode:</b> no <code>SERPAPI_KEY</code> in your <code>.env</code>, so every hotel and price here is made up.';
      banner.hidden = false;
    }
    updateCost();
  });
})();

const nights = () => diffDays(form.checkin.value, form.checkout.value);
const moveDays = () => Math.max(0, nights() - 2 * Number(form.minNights.value) + 1);

function updateCost() {
  const n = nights();
  if (!(n >= 1)) return ($('#swCost').textContent = 'Check-out must be after check-in.');
  const searches = 1 + 2 * moveDays();
  $('#swCost').textContent =
    (moveDays() === 0 ? `With ${form.minNights.value}+ nights per hotel, ${n} nights is too short to switch, so we'll just find the cheapest single hotel. ` : '') +
    (live ? `Uses ${searches} of your 250 free monthly searches. Repeat searches are free.` : 'Demo mode: fake prices, no searches used.');
}
form.addEventListener('input', updateCost);
form.checkin.addEventListener('change', () => {
  if (form.checkout.value <= form.checkin.value) form.checkout.value = addDays(form.checkin.value, 7);
  updateCost();
});

function setStatus(msg, isError = false) {
  status.textContent = msg;
  status.className = 'status' + (isError ? ' error' : '');
}

function collapse(collapsed) {
  form.hidden = collapsed;
  $('#swHero').hidden = collapsed;
  $('#swHow').hidden = collapsed;
  $('#swSummary').hidden = !collapsed;
}
$('#swEdit').addEventListener('click', () => {
  collapse(false);
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  search(false);
});
$('#swRefresh').addEventListener('click', () => search(true));

const HOUR = 3600_000;
async function search(fresh) {
  if (!(nights() >= 1)) return setStatus('Check-out must be after check-in.', true);
  const fd = new FormData(form);
  const params = Object.fromEntries(['city', 'checkin', 'checkout', 'adults', 'minNights', 'minRating', 'minStars', 'currency'].map((k) => [k, String(fd.get(k)).trim()]));
  const key = new URLSearchParams(params).toString();
  const reuse = !fresh && results.get(key);
  $('#swGo').disabled = $('#swRefresh').disabled = true;
  setStatus(fresh ? 'Getting brand-new prices… this can take 20–40 seconds.' : `Pricing every way to split ${nights()} nights in ${params.city}… this can take 20–40 seconds.`);
  try {
    const res = reuse && Date.now() - reuse.checkedAt < HOUR ? reuse : await api('/api/hotelswitch?' + key + (fresh ? '&fresh=1' : ''));
    results.set(key, res);
    current = { params, res };
    money = moneyFormatter(params.currency);
    setStatus('');
    collapse(true);
    $('#swSummaryText').innerHTML = `<b>${esc(params.city)}</b><span class="muted"> · ${fmtDayW(params.checkin)} → ${fmtDayW(params.checkout)} · ${res.nights} nights · ${params.adults} guests</span>`;
    render();
    $('#swResults').hidden = false;
    $('#swResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    $('#swGo').disabled = $('#swRefresh').disabled = false;
  }
}

// Opened from a city in the Trip planner, with its dates.
window.addEventListener('open-switch', (e) => {
  const d = e.detail;
  form.city.value = d.city;
  form.checkin.value = d.checkin;
  form.checkout.value = d.checkout;
  form.adults.value = d.adults;
  form.currency.value = d.currency;
  form.minStars.value = String(d.minStars || 0);
  showView('switch');
  updateCost();
  form.requestSubmit();
});

// ---------- results ----------
function render() {
  const { params, res } = current;
  const p = { adults: params.adults, currency: params.currency };
  const one = res.oneHotel[0];
  const sw = res.bestSwitch;
  const n = res.nights;
  const save = one && sw ? one.total - sw.total : 0;
  const switchWins = Boolean(sw && (!one || save > 0));

  $('#swWhere').textContent = `${params.city} · ${fmtDayW(res.checkin)} → ${fmtDayW(res.checkout)} · ${n} nights`;
  const mins = Math.round((Date.now() - res.checkedAt) / 60000);
  $('#swFresh').textContent = !res.live
    ? 'Demo data: these hotels and prices are made up.'
    : `Prices checked ${mins < 1 ? 'just now' : mins === 1 ? '1 minute ago' : `${mins} minutes ago`}.`;
  $('#swRefresh').hidden = !res.live;
  $('#swRefresh').textContent = `Refresh prices (${1 + 2 * Math.max(0, n - 2 * res.minNights + 1)} searches)`;
  if (!one && !sw) {
    $('#swVerdict').textContent = 'No hotels had rooms for these nights';
    $('#swVerdictSub').textContent = 'Try a lower guest rating or hotel class under Options.';
    $('#swTimeline').innerHTML = '';
  } else if (switchWins) {
    $('#swVerdict').innerHTML = `Switch once and save <span class="save">${money(save)}</span>`;
    $('#swVerdictSub').textContent = one
      ? `${sw.first.name} for ${sw.moveAfter} nights, then ${sw.second.name} for ${n - sw.moveAfter}: ${money(sw.total)} instead of ${money(one.total)} at the best single hotel.`
      : `No single hotel had rooms for all ${n} nights, but this split works: ${money(sw.total)}.`;
  } else {
    $('#swVerdict').innerHTML = 'Stay put. <span class="save">One hotel</span> is cheapest.';
    $('#swVerdictSub').textContent =
      `${one.name}: ${money(one.total)} for all ${n} nights.` +
      (sw ? ` The best switch would cost ${money(-save)} more.` : ' There was no way to switch for these dates.');
  }

  // Timeline of the winning plan, one column per night
  const dates = Array.from({ length: n }, (_, i) => addDays(res.checkin, i));
  const seg = (h, from, k, cls = '') => `<div class="tl ${cls}" style="grid-column: span ${k}">
      <div class="tl-name">${esc(h.name)}</div>
      <div class="tl-meta">${fmtDay(from)} → ${fmtDay(addDays(from, k))} · ${k} night${k > 1 ? 's' : ''}${h.stars ? ` · ${h.stars}★` : ''}${h.rating ? ` · ${h.rating}/5` : ''}</div>
      <div class="tl-price">${money(h.total)} <span>${money(h.perNight)}/night</span></div>
      ${bookLinks(h, params.city, from, k, p)}
    </div>`;
  if (one || sw) {
    $('#swTimeline').style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
    $('#swTimeline').innerHTML =
      dates.map((d) => `<div class="tl-day ${[5, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()) ? 'we' : ''}">${fmtDay(d, { weekday: 'short' })} ${Number(d.slice(8))}</div>`).join('') +
      (switchWins
        ? seg(sw.first, res.checkin, sw.moveAfter) + seg(sw.second, sw.moveDate, n - sw.moveAfter, 'second')
        : seg(one, res.checkin, n));
  }

  // One hotel vs switch, side by side
  const box = (title, total, body, win) => `<div class="card plan-box ${win ? 'win' : ''}">
      <div class="plan-title">${title}${total ? `<span>${money(total)}</span>` : ''}</div>${body}</div>`;
  const others = res.oneHotel.slice(1).map((h) => `<li>${esc(h.name)} · ${money(h.total)}<br>${bookLinks(h, params.city, res.checkin, n, p)}</li>`).join('');
  $('#swCompare').innerHTML =
    box('One hotel, all nights', one?.total,
      one ? `<div class="small"><b>${esc(one.name)}</b> · ${money(one.perNight)}/night <span class="ok">✓ rooms all nights</span></div>${others ? `<div class="small muted">Next cheapest:</div><ol class="small">${others}</ol>` : ''}` : '<p class="muted small">No single hotel had rooms for every night.</p>',
      !switchWins && one) +
    box('Switch once', sw?.total,
      sw ? `<div class="small"><b>${esc(sw.first.name)}</b> ${fmtDay(res.checkin)} → ${fmtDay(sw.moveDate)} · ${money(sw.first.total)}<br>${bookLinks(sw.first, params.city, res.checkin, sw.moveAfter, p)}</div>
            <div class="move">↓ move ${fmtDayW(sw.moveDate)}</div>
            <div class="small"><b>${esc(sw.second.name)}</b> ${fmtDay(sw.moveDate)} → ${fmtDay(res.checkout)} · ${money(sw.second.total)}<br>${bookLinks(sw.second, params.city, sw.moveDate, n - sw.moveAfter, p)}</div>
            ${switchWins ? '' : `<div class="small muted">${money(-save)} more than one hotel.</div>`}`
         : `<p class="muted small">${moveDays() === 0 ? 'Stay too short to switch with these options.' : 'No split had rooms on both sides.'}</p>`,
      switchWins);

  // Every move day
  $('#swMoves').innerHTML = res.switches.length
    ? `<table class="table"><tr><th>Move</th><th>First hotel</th><th>Then</th><th>Total</th></tr>${res.switches
        .map((s) => {
          const diff = one ? s.total - one.total : 0;
          return `<tr class="${s === sw || (sw && s.moveAfter === sw.moveAfter) ? 'best-row' : ''}">
            <td>After night ${s.moveAfter}<br><span class="muted">${fmtDayW(s.moveDate)}</span></td>
            <td>${esc(s.first.name)}<br><span class="muted">${money(s.first.total)}</span></td>
            <td>${esc(s.second.name)}<br><span class="muted">${money(s.second.total)}</span></td>
            <td><b>${money(s.total)}</b><br><span class="${diff < 0 ? 'ok' : 'muted'}">${diff < 0 ? `save ${money(-diff)}` : diff > 0 ? `+${money(diff)} vs one hotel` : 'same as one hotel'}</span></td></tr>`;
        })
        .join('')}</table>`
    : '<p class="muted small">No move days to compare for this stay.</p>';

  // Night-by-night grid: free in demo, costs one search per night when live
  $('#swGrid').innerHTML = '';
  $('#swGridLegend').innerHTML = '';
  const btn = $('#swGridBtn');
  btn.hidden = false;
  btn.disabled = false;
  btn.textContent = live ? `Show night-by-night prices (uses ${Math.min(n, 20)} searches)` : 'Show night-by-night prices';
  btn.onclick = () => loadGrid(dates);
  if (!live) loadGrid(dates);

  $('#swFoot').textContent =
    `Prices are real quotes from Google Hotels (which includes Booking.com, Agoda, Expedia and hotel sites) for each exact part of the stay, for ${params.adults} guests, before taxes. ` +
    `Only hotels with rooms on every night of each part are used. Moving hotels costs time and maybe a taxi.` +
    (live ? ` This check used ${res.apiCalls.made} new searches.` : '');
}

async function loadGrid(dates) {
  const { params, res } = current;
  const btn = $('#swGridBtn');
  btn.disabled = true;
  btn.textContent = 'Loading night-by-night prices…';
  const q = new URLSearchParams({
    cities: params.city, from: res.checkin, to: res.checkin, nights: res.nights, samples: Math.min(Math.max(res.nights, 2), 20),
    adults: params.adults, currency: params.currency, minStars: params.minStars,
  });
  try {
    const detail = await api('/api/city?' + q);
    if (current?.res !== res) return;
    const plan = new Set([res.oneHotel[0]?.name, res.bestSwitch?.first.name, res.bestSwitch?.second.name].filter(Boolean));
    renderNightGrid($('#swGrid'), $('#swGridLegend'), detail.hotels, dates, money, { highlight: plan });
    btn.hidden = true;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = `Couldn't load (${err.message}). Try again`;
  }
}
