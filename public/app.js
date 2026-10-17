// StayScout frontend.
// 1) /api/place turns "Japan" into a list of cities to pick from
// 2) /api/trip returns a nightly price series for each picked city
// 3) itinerary.js finds the cheapest order + start date (in the browser)
// 4) /api/city returns hotels + areas for a city tab (served from cache)
import { optimise, splitNights } from './itinerary.js';
import { $, $$, addDays, diffDays, esc, fmtDay, fmtDayW, legendHtml, moneyFormatter, scale, tipOn, cssVar } from './util.js';

const MAX_CITIES = 6;
const form = $('#search');
const status = $('#status');

const state = {
  live: false,
  place: null, // { country, cities: [{ name, lat, lng }] }
  selected: new Set(),
  trip: null, // /api/trip response
  alloc: {}, // { cityName: nights }
  result: null, // optimise() output
  optIdx: 0,
  tab: 'trip',
  cityDetail: new Map(), // cityName → /api/city response
  cityStart: null, // clicked start date in city calendar
  maps: {},
};
let money = moneyFormatter('USD');

// ---------- setup ----------
(function init() {
  const today = new Date().toISOString().slice(0, 10);
  form.from.value = addDays(today, 30);
  form.to.value = addDays(today, 75);
  form.from.min = form.to.min = today;
  fetch('/api/info').then((r) => r.json()).then((info) => {
    state.live = info.live;
    const el = $('#mode');
    el.textContent = info.live ? 'Live prices · Google Hotels' : 'Demo mode · fake prices';
    el.classList.toggle('live', info.live);
    updateCost();
    if (info.needsCode && !accessCode) showGate();
    else findCities();
  });
})();

// ---------- API + optional access code ----------
let accessCode = '';
try { accessCode = localStorage.getItem('stayscout-code') || ''; } catch {}

async function api(path) {
  const res = await fetch(path, { headers: accessCode ? { 'x-access-code': accessCode } : {} });
  const data = await res.json();
  if (res.status === 401) {
    showGate();
    throw new Error('Enter the access code to search.');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showGate() {
  $('#gate').hidden = false;
  $('#gateCode').focus();
}
$('#gate').addEventListener('submit', (e) => {
  e.preventDefault();
  accessCode = $('#gateCode').value.trim();
  try { localStorage.setItem('stayscout-code', accessCode); } catch {}
  $('#gate').hidden = true;
  setStatus('');
  findCities();
});

function setStatus(msg, isError = false) {
  status.textContent = msg;
  status.className = 'status' + (isError ? ' error' : '');
}

// ---------- step 1: place → cities ----------
async function findCities() {
  const q = $('#place').value.trim();
  if (!q) return;
  setStatus('Looking up cities…');
  try {
    const data = await api('/api/place?q=' + encodeURIComponent(q));
    state.place = data;
    state.selected = new Set(data.cities.slice(0, data.type === 'city' ? 1 : 4).map((c) => c.name));
    $('#cityHint').textContent = data.type === 'country'
      ? `Popular cities in ${data.country}. Pick up to ${MAX_CITIES}:`
      : 'Searching one city. Add more to compare them or plan a route:';
    renderChips();
    $('#cityPicker').hidden = false;
    setStatus('');
  } catch (err) {
    setStatus(err.message || 'Could not look that up.', true);
  }
}

function renderChips() {
  const full = state.selected.size >= MAX_CITIES;
  $('#chips').innerHTML = state.place.cities
    .map((c) => {
      const on = state.selected.has(c.name);
      return `<button type="button" class="chip" aria-pressed="${on}" data-name="${esc(c.name)}" ${!on && full ? 'disabled' : ''}>${esc(c.name)}</button>`;
    })
    .join('');
  $$('#chips .chip').forEach((b) =>
    b.addEventListener('click', () => {
      const n = b.dataset.name;
      state.selected.has(n) ? state.selected.delete(n) : state.selected.add(n);
      renderChips();
    }));
  updateCost();
}

function addCity() {
  const input = $('#addCity');
  const name = input.value.trim();
  if (!name || !state.place) return;
  if (!state.place.cities.some((c) => c.name.toLowerCase() === name.toLowerCase())) state.place.cities.push({ name });
  if (state.selected.size < MAX_CITIES) state.selected.add(state.place.cities.find((c) => c.name.toLowerCase() === name.toLowerCase()).name);
  input.value = '';
  renderChips();
}

function updateCost() {
  const n = state.selected.size * Number(form.samples.value);
  $('#cost').textContent = !state.selected.size
    ? 'Pick at least one city.'
    : state.live
      ? `Uses up to ${n} of your 250 free monthly searches. Repeat searches are free.`
      : 'Demo mode: no API searches used.';
  $('#go').disabled = !state.selected.size;
}

$('#findCities').addEventListener('click', findCities);
$('#place').addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), findCities()));
$('#addCityBtn').addEventListener('click', addCity);
$('#addCity').addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), addCity()));
form.samples.addEventListener('change', updateCost);

// ---------- step 2: plan ----------
function queryString(cities) {
  const fd = new FormData(form);
  const p = new URLSearchParams();
  for (const k of ['from', 'to', 'nights', 'adults', 'currency', 'minStars', 'samples']) p.set(k, fd.get(k));
  p.set('cities', cities.join(','));
  return p.toString();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.selected.size) return;
  const btn = $('#go');
  btn.disabled = true;
  setStatus(`Checking hotel prices in ${state.selected.size} ${state.selected.size === 1 ? 'city' : 'cities'}… the first time can take 20–40 seconds.`);
  try {
    const data = await api('/api/trip?' + queryString([...state.selected]));
    state.trip = data;
    state.cityDetail.clear();
    money = moneyFormatter(data.params.currency);
    const ok = okCities();
    state.alloc = splitNights(data.params.nights, ok.map((c) => c.name));
    state.optIdx = 0;
    const failed = data.cities.filter((c) => c.error);
    setStatus(failed.length ? `Couldn't load: ${failed.map((c) => `${c.name} (${c.error})`).join('; ')}` : '', failed.length > 0);
    $('#results').hidden = false;
    $('#intro').hidden = true;
    collapseSearch(true);
    renderTabs();
    showTab('trip');
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// After a search, fold the form into a one-line summary to keep the page clean.
function collapseSearch(collapsed) {
  form.hidden = collapsed;
  $('#summary').hidden = !collapsed;
  if (collapsed) {
    const p = state.trip.params;
    const where = state.place?.type === 'country' ? `${state.place.country}: ` : '';
    $('#summaryText').innerHTML =
      `<b>${esc(where)}${p.cities.map(esc).join(', ')}</b><span class="muted"> · start between ${fmtDay(p.from)} and ${fmtDay(p.to)} · ${p.nights} nights</span>`;
  }
}
$('#editSearch').addEventListener('click', () => {
  collapseSearch(false);
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

const okCities = () => state.trip.cities.filter((c) => !c.error);
const startCount = () => diffDays(state.trip.params.from, state.trip.params.to) + 1;
const allocTotal = () => Object.values(state.alloc).reduce((a, b) => a + b, 0);
const selectedOption = () => state.result?.options[state.optIdx];
const nightDate = (i) => state.trip.allNights[i];

// ---------- tabs ----------
function renderTabs() {
  const tabs = [['trip', 'Trip plan', '']].concat(okCities().map((c) => [c.name, c.name, money(c.typicalNightly)]));
  $('#tabs').innerHTML = tabs
    .map(([id, label, p]) => `<button type="button" class="tab" role="tab" data-tab="${esc(id)}">${esc(label)}${p ? `<span class="p">${p}</span>` : ''}</button>`)
    .join('');
  $$('#tabs .tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
}

function showTab(id) {
  state.tab = id;
  $$('#tabs .tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.tab === id));
  $('#tripView').hidden = id !== 'trip';
  $('#cityView').hidden = id === 'trip';
  if (id === 'trip') renderTrip();
  else showCity(id);
  renderFoot();
}

// ---------- trip view ----------
function recompute() {
  state.result = optimise(okCities(), state.alloc, startCount());
}

function renderTrip() {
  recompute();
  renderPlan();
  renderAlloc();
  renderAlts();
  renderMatrix();
  renderCountryMap();
}

function renderPlan() {
  const opt = selectedOption();
  if (!opt) {
    $('#planDates').textContent = 'Give at least one city a night';
    $('#planRoute').innerHTML = '';
    $('#planTotal').textContent = '';
    return;
  }
  const nights = opt.legs.reduce((a, l) => a + l.nights, 0);
  const start = nightDate(opt.startIdx);
  $('#planDates').textContent = `${fmtDayW(start)} → ${fmtDayW(addDays(start, nights))}`;
  $('#planRoute').innerHTML = opt.legs
    .map((l) => `<span class="leg"><b>${esc(l.city)}</b> · ${l.nights}n · ${fmtDay(nightDate(l.startIdx))}</span>`)
    .join('<span class="arrow">→</span>');
  const worst = state.result.worstForBest;
  const save = worst && state.optIdx === 0 ? worst.total - opt.total : 0;
  $('#planTotal').textContent =
    `≈ ${money(opt.total)} for hotels, ${nights} nights (typical hotel)` +
    (save > 0 ? ` · ${money(save)} less than the priciest start date for this route` : '');
}

function renderAlloc() {
  const total = state.trip.params.nights;
  const used = allocTotal();
  $('#alloc').innerHTML = okCities()
    .map((c) => {
      const n = state.alloc[c.name] || 0;
      return `<div class="alloc-row" data-name="${esc(c.name)}">
        <span class="name">${esc(c.name)}</span>
        <span class="stepper"><button type="button" data-d="-1" ${n === 0 ? 'disabled' : ''} aria-label="One night fewer in ${esc(c.name)}">−</button><span>${n}</span><button type="button" data-d="1" ${used >= total ? 'disabled' : ''} aria-label="One more night in ${esc(c.name)}">+</button></span>
        <span class="ppn">${money(c.typicalNightly)}/nt</span>
      </div>`;
    })
    .join('');
  $('#allocNote').textContent =
    (used === total ? `All ${total} nights assigned.` : `${used} of ${total} nights assigned.`) +
    ' Hotel prices only, not travel between cities.';
  $$('#alloc .alloc-row').forEach((row) =>
    row.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        const name = row.dataset.name;
        state.alloc[name] = Math.max(0, (state.alloc[name] || 0) + Number(b.dataset.d));
        state.optIdx = 0;
        renderTrip();
      })));
}

function renderAlts() {
  const opts = state.result.options;
  if (opts.length < 2) return ($('#altWrap').innerHTML = '');
  const multi = opts[0].legs.length > 1;
  $('#altWrap').innerHTML = opts
    .map((o, i) => {
      const diff = o.total - opts[0].total;
      return `<button type="button" class="alt" data-i="${i}" aria-pressed="${i === state.optIdx}">
        <div class="eyebrow">${i === 0 ? 'Cheapest' : 'Another week'}</div>
        <div>Start ${fmtDayW(nightDate(o.startIdx))} · <span class="t">${money(o.total)}</span>${diff > 0 ? ` <span class="muted small">(+${money(diff)})</span>` : ''}</div>
        ${multi ? `<div class="small muted">${o.legs.map((l) => esc(l.city)).join(' → ')}</div>` : ''}
      </button>`;
    })
    .join('');
  $$('#altWrap .alt').forEach((b) =>
    b.addEventListener('click', () => {
      state.optIdx = Number(b.dataset.i);
      renderPlan();
      renderAlts();
      renderMatrix();
      renderCountryMap();
    }));
}

function renderMatrix() {
  const { allNights, cities } = state.trip;
  const ok = okCities();
  const sc = scale(ok.flatMap((c) => c.nights.map((n) => n.typical)));
  $('#matrixLegend').innerHTML = legendHtml(sc, money, 'per night');

  // which cells are in the selected plan
  const inPlan = new Set();
  for (const l of selectedOption()?.legs || []) for (let i = 0; i < l.nights; i++) inPlan.add(`${l.city}|${l.startIdx + i}`);

  let html = `<div class="mx" style="grid-template-columns: auto repeat(${allNights.length}, 20px)">`;
  // month labels
  html += '<div class="lbl"></div>';
  allNights.forEach((d, i) => {
    if (i === 0 || d.endsWith('-01')) {
      const span = allNights.slice(i).findIndex((x, j) => j > 0 && x.endsWith('-01'));
      html += `<div class="mo" style="grid-column: span ${span === -1 ? allNights.length - i : span}">${fmtDay(d, { month: 'short', year: 'numeric' })}</div>`;
    }
  });
  // day numbers, weekend nights bold
  html += '<div class="lbl"></div>';
  html += allNights.map((d) => `<div class="dn ${[5, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()) ? 'we' : ''}">${Number(d.slice(8))}</div>`).join('');
  // one row per city
  for (const c of cities) {
    html += `<div class="lbl">${esc(c.name)}</div>`;
    if (c.error) {
      html += allNights.map(() => '<div class="c err"></div>').join('');
      continue;
    }
    html += c.nights
      .map((n, i) => `<div class="c ${inPlan.has(`${c.name}|${i}`) ? 'in' : ''}" data-c="${esc(c.name)}" data-i="${i}" style="background:${sc.color(n.typical)}"></div>`)
      .join('');
  }
  html += '</div>';
  $('#matrix').innerHTML = html;

  const byName = new Map(ok.map((c) => [c.name, c]));
  $$('#matrix .c[data-c]').forEach((el) => {
    const c = byName.get(el.dataset.c);
    const n = c.nights[el.dataset.i];
    tipOn(el, `<b>${esc(c.name)}</b>, night of ${fmtDayW(n.date)}<br>Typical ${money(n.typical)} · budget ${money(n.budget)}<br><span class="muted">${n.sampled ? 'Price checked' : 'Estimated'}</span>`);
  });
}

function leafletReady(id) {
  if (typeof L !== 'undefined') return true;
  $('#' + id).innerHTML = '<p class="muted small" style="padding:16px">The map couldn\'t load (are you offline?).</p>';
  return false;
}

function getMap(id) {
  if (!state.maps[id]) {
    const map = L.map(id, { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    state.maps[id] = { map, layer: L.layerGroup().addTo(map) };
  }
  const m = state.maps[id];
  m.layer.clearLayers();
  setTimeout(() => m.map.invalidateSize(), 0);
  return m;
}

function renderCountryMap() {
  if (!leafletReady('countryMap')) return;
  const ok = okCities().filter((c) => Number.isFinite(c.lat));
  if (!ok.length) return;
  const { map, layer } = getMap('countryMap');
  const sc = scale(ok.map((c) => c.typicalNightly));
  const opt = selectedOption();
  const order = opt ? opt.legs.map((l) => l.city) : [];
  const byName = new Map(ok.map((c) => [c.name, c]));

  if (order.length > 1) {
    L.polyline(order.map((n) => byName.get(n)).filter(Boolean).map((c) => [c.lat, c.lng]), { color: cssVar('--mark'), weight: 2, dashArray: '6 6' }).addTo(layer);
  }
  for (const c of ok) {
    const stop = order.indexOf(c.name);
    L.circleMarker([c.lat, c.lng], { radius: 11, weight: 2, color: cssVar('--surface'), fillOpacity: 1, fillColor: cssVar(`--s${sc.step(c.typicalNightly)}`) })
      .bindTooltip(`${stop >= 0 ? stop + 1 + '. ' : ''}${esc(c.name)} · ${money(c.typicalNightly)}`, { permanent: true, direction: 'right', offset: [10, 0], className: 'city-label' })
      .on('click', () => showTab(c.name))
      .addTo(layer);
  }
  map.fitBounds(L.latLngBounds(ok.map((c) => [c.lat, c.lng])).pad(0.3), { maxZoom: 11 });
}

// ---------- city view ----------
async function showCity(name) {
  const city = okCities().find((c) => c.name === name);
  state.cityStart = null;
  renderCityDates(city);
  renderCalendar(city);
  if (!state.cityDetail.has(name)) {
    $('#areas').innerHTML = '<li class="muted">Loading areas…</li>';
    $('#hotels').innerHTML = '';
    try {
      const data = await api('/api/city?' + queryString([name]));
      state.cityDetail.set(name, data);
    } catch (err) {
      $('#areas').innerHTML = `<li class="muted">${esc(err.message)}</li>`;
      return;
    }
  }
  if (state.tab !== name) return; // user switched tabs while loading
  const detail = state.cityDetail.get(name);
  renderAreas(detail);
  renderHotels(detail, false);
  renderCityMap(detail);
}

const cityNights = (name) => state.alloc[name] || state.trip.params.nights;
const stayCost = (city, startIdx, n) => city.nights.slice(startIdx, startIdx + n).reduce((a, x) => ({ t: a.t + x.typical, b: a.b + x.budget }), { t: 0, b: 0 });

function renderCityDates(city) {
  const n = cityNights(city.name);
  const lastStart = city.nights.length - n;
  let best = 0;
  for (let s = 1; s <= lastStart; s++) if (stayCost(city, s, n).t < stayCost(city, best, n).t) best = s;
  const bc = stayCost(city, best, n);
  $('#cityEyebrow').textContent = `Cheapest ${n} nights in ${city.name}`;
  $('#cityBest').textContent = `${fmtDayW(nightDate(best))} → ${fmtDayW(addDays(nightDate(best), n))}`;
  $('#cityBestSub').textContent = `≈ ${money(bc.t)} typical · ≈ ${money(bc.b)} budget picks`;

  const side = $('#cityInPlan').previousElementSibling;
  if (state.cityStart) {
    const s = diffDays(nightDate(0), state.cityStart);
    const c = stayCost(city, s, n);
    side.textContent = 'Selected dates';
    $('#cityInPlan').textContent = `${fmtDayW(state.cityStart)} → ${fmtDayW(addDays(state.cityStart, n))}`;
    $('#cityInPlanSub').textContent = `≈ ${money(c.t)}` + (c.t > bc.t ? ` · ${money(c.t - bc.t)} more than the cheapest` : ' · the cheapest');
    return;
  }
  const leg = selectedOption()?.legs.find((l) => l.city === city.name);
  side.textContent = 'In your plan';
  if (leg) {
    $('#cityInPlan').textContent = `${fmtDayW(nightDate(leg.startIdx))} → ${fmtDayW(addDays(nightDate(leg.startIdx), leg.nights))}`;
    $('#cityInPlanSub').textContent = `${leg.nights} nights ≈ ${money(leg.cost)}`;
  } else {
    $('#cityInPlan').textContent = 'Not in your plan';
    $('#cityInPlanSub').textContent = 'Give it nights on the Trip plan tab.';
  }
}

function renderCalendar(city) {
  const n = cityNights(city.name);
  const sc = scale(city.nights.map((x) => x.typical));
  $('#calLegend').innerHTML = legendHtml(sc, money, 'per night');
  const byDate = new Map(city.nights.map((x, i) => [x.date, { ...x, i }]));
  const first = new Date(city.nights[0].date + 'T00:00:00Z');
  const last = new Date(city.nights.at(-1).date + 'T00:00:00Z');
  const lastStart = city.nights.length - n;
  const highlight = new Set();
  const start = state.cityStart ?? (() => {
    const leg = selectedOption()?.legs.find((l) => l.city === city.name);
    return leg ? nightDate(leg.startIdx) : null;
  })();
  if (start) for (let i = 0; i < n; i++) highlight.add(addDays(start, i));

  const cal = $('#calendar');
  cal.innerHTML = '';
  for (let m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)); m <= last; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const month = document.createElement('div');
    month.className = 'month';
    let html = `<h3>${m.toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3><div class="days">`;
    html += ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="dow">${d}</div>`).join('');
    html += '<div class="day out"></div>'.repeat(m.getUTCDay());
    const dim = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate();
    for (let d = 1; d <= dim; d++) {
      const date = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), d)).toISOString().slice(0, 10);
      const x = byDate.get(date);
      if (!x) { html += `<button type="button" class="day" disabled>${d}</button>`; continue; }
      const cls = ['day', 'priced', sc.isDark(x.typical) && 'dark', x.sampled && 'sampled', x.i <= lastStart && 'startable', highlight.has(date) && 'in-stay'].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-date="${date}" style="background:${sc.color(x.typical)}">${d}</button>`;
    }
    month.innerHTML = html + '</div>';
    cal.appendChild(month);
  }
  $$('#calendar .day[data-date]').forEach((el) => {
    const x = byDate.get(el.dataset.date);
    const startable = el.classList.contains('startable');
    tipOn(el, `<b>Night of ${fmtDayW(x.date)}</b><br>Typical ${money(x.typical)} · budget ${money(x.budget)}<br><span class="muted">${x.sampled ? 'Price checked' : 'Estimated'}${startable ? ' · click to start here' : ''}</span>`);
    if (startable) el.addEventListener('click', () => {
      state.cityStart = x.date;
      renderCityDates(city);
      renderCalendar(city);
    });
  });
}

function renderAreas(detail) {
  const sc = scale(detail.hotels.map((h) => h.estNightly));
  $('#areas').innerHTML =
    detail.areas
      .map((a, i) => `<li data-i="${i}"><span><span class="sw" style="background:${sc.color(a.estNightly)}"></span>${esc(a.name || 'Near ' + a.example)} <span class="muted small">· ${a.hotelCount} hotels</span></span><b>${money(a.estNightly)}</b></li>`)
      .join('') || '<li class="muted">Not enough hotels to compare areas.</li>';
  $$('#areas li[data-i]').forEach((li) =>
    li.addEventListener('click', () => {
      const a = detail.areas[li.dataset.i];
      state.maps.cityMap?.map.setView([a.lat, a.lng], 15);
      $('#cityMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
}

function renderHotels(detail, showAll) {
  const rows = [...detail.hotels].sort((a, b) => a.estNightly - b.estNightly);
  const shown = showAll ? rows : rows.slice(0, 10);
  $('#hotels').innerHTML =
    '<tr><th>Hotel</th><th>Typical / night</th><th>Seen</th><th>Class</th><th>Rating</th></tr>' +
    shown
      .map((h) => `<tr><td>${h.link ? `<a href="${esc(h.link)}" target="_blank" rel="noopener">${esc(h.name)}</a>` : esc(h.name)}</td><td>${money(h.estNightly)}</td><td>${money(h.priceLow)}–${money(h.priceHigh)}</td><td>${h.stars ? h.stars + '★' : '–'}</td><td>${h.rating ?? '–'}</td></tr>`)
      .join('');
  const btn = $('#moreHotels');
  btn.hidden = rows.length <= 10;
  btn.textContent = showAll ? 'Show fewer' : `Show all ${rows.length} hotels`;
  btn.onclick = () => renderHotels(detail, !showAll);
}

function renderCityMap(detail) {
  if (!leafletReady('cityMap')) return;
  const { map, layer } = getMap('cityMap');
  const sc = scale(detail.hotels.map((h) => h.estNightly));
  [...detail.hotels].sort((a, b) => b.estNightly - a.estNightly).forEach((h) => {
    L.circleMarker([h.lat, h.lng], { radius: 8, weight: 2, color: cssVar('--surface'), fillOpacity: 1, fillColor: cssVar(`--s${sc.step(h.estNightly)}`) })
      .bindPopup(`<b>${esc(h.name)}</b><br>≈ ${money(h.estNightly)} / night${h.stars ? ` · ${h.stars}★` : ''}${h.rating ? ` · ${h.rating}/5` : ''}${h.link ? `<br><a href="${esc(h.link)}" target="_blank" rel="noopener">Hotel website</a>` : ''}`)
      .addTo(layer);
  });
  map.fitBounds(L.latLngBounds(detail.hotels.map((h) => [h.lat, h.lng])).pad(0.1));
}

function renderFoot() {
  const t = state.trip;
  const ok = okCities();
  const checked = ok.reduce((a, c) => a + c.sampledNights, 0);
  $('#foot').textContent =
    `${t.provider}. Checked ${checked} city-nights out of ${ok.length * t.allNights.length}; the rest are estimated from weekday/weekend patterns. ` +
    `This search used ${t.apiCalls.made} new API searches (${t.apiCalls.fromCache} from cache). ` +
    `"Typical" = median hotel price that night; "budget" = cheapest quarter. Per room, before taxes.`;
}

// Re-colour maps if the OS theme flips.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.trip && showTab(state.tab));
