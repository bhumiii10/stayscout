// Talking to our API, plus the optional access code (set ACCESS_CODE on the server).
import { $ } from './util.js';

let accessCode = '';
try { accessCode = localStorage.getItem('stayscout-code') || ''; } catch {}
const unlockHandlers = [];

export const info = fetch('/api/info').then((r) => r.json());
export const hasCode = () => Boolean(accessCode);
export const onUnlock = (fn) => unlockHandlers.push(fn);

export async function api(path) {
  const res = await fetch(path, { headers: accessCode ? { 'x-access-code': accessCode } : {} });
  const data = await res.json();
  if (res.status === 401) {
    showGate();
    throw new Error('Enter the access code first.');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function showGate() {
  $('#gate').hidden = false;
  $('#gateCode').focus();
}

$('#gate').addEventListener('submit', (e) => {
  e.preventDefault();
  accessCode = $('#gateCode').value.trim();
  try { localStorage.setItem('stayscout-code', accessCode); } catch {}
  $('#gate').hidden = true;
  unlockHandlers.forEach((fn) => fn());
});
