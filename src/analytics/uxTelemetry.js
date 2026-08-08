import { authFetch } from '../api/auth.js';

const FLUSH_MS = 15000;
const MAX_QUEUE = 40;
const POINTER_SAMPLE_MS = 250;
const SERVICE_NAMES = new Set(['Hosting', 'VPS Services', 'Buy a domain', 'My domains', 'Email', 'Site builder', 'Billing', 'Contact support', 'Analytics', 'Activity']);

function sessionId() {
  const key = 'glondia.uxSessionId';
  try {
    let value = sessionStorage.getItem(key);
    if (!value) { value = crypto.randomUUID(); sessionStorage.setItem(key, value); }
    return value;
  } catch { return null; }
}

function safeLabel(element) {
  if (!element || element.closest('input,textarea,[contenteditable="true"]')) return '';
  return String(element.getAttribute?.('aria-label') || element.getAttribute?.('title') || element.textContent || '')
    .replace(/\s+/g, ' ').trim().slice(0, 120);
}

function zoneFor(x, y) {
  const col = Math.min(2, Math.floor((x / Math.max(innerWidth, 1)) * 3));
  const row = Math.min(2, Math.floor((y / Math.max(innerHeight, 1)) * 3));
  return ['top', 'middle', 'bottom'][row] + '-' + ['left', 'center', 'right'][col];
}

export function startUxTelemetry() {
  if (typeof window === 'undefined' || window.__glondiaUxTelemetry) return () => {};
  window.__glondiaUxTelemetry = true;
  const sid = sessionId();
  let queue = [];
  let pointerAt = 0;
  let pointerSamples = 0;
  let zoneCounts = {};
  let maxScrollPercent = 0;
  let clickCount = 0;
  let pageViewCount = 0;
  let lastClicks = [];
  const startedAt = Date.now();

  const record = (event, metadata = {}, extra = {}) => {
    queue.push({ event, path: location.pathname, sessionId: sid, metadata, ...extra });
    if (queue.length >= MAX_QUEUE) flush();
  };
  const flush = () => {
    if (!queue.length) return;
    const events = queue.splice(0, MAX_QUEUE);
    authFetch('/api/v1/events/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }), keepalive: true }).catch(() => { /* analytics never blocks UI */ });
  };
  const pageView = () => { pageViewCount += 1; record('ux.page_view', { viewportWidth: innerWidth, viewportHeight: innerHeight }); };
  const onClick = (event) => {
    const target = event.target?.closest?.('button,a,[role="button"],[role="tab"],[data-analytics-label]');
    if (!target) return;
    const label = safeLabel(target);
    const targetType = String(target.tagName || target.getAttribute?.('role') || 'control').toLowerCase();
    clickCount += 1;
    record('ux.click', { label, targetType }, { entityType: targetType });
    if (SERVICE_NAMES.has(label)) record('ux.service_used', { service: label }, { entityType: 'service', entityId: label.toLowerCase().replace(/\s+/g, '-') });
    const now = Date.now();
    lastClicks = lastClicks.filter((item) => now - item.at < 1500);
    lastClicks.push({ at: now, label });
    if (lastClicks.filter((item) => item.label === label).length >= 3) { record('ux.rage_click', { label, clickCount: lastClicks.length }); lastClicks = []; }
  };
  const onPointer = (event) => {
    const now = Date.now(); if (now - pointerAt < POINTER_SAMPLE_MS) return; pointerAt = now;
    const zone = zoneFor(event.clientX, event.clientY); zoneCounts[zone] = (zoneCounts[zone] || 0) + 1; pointerSamples += 1;
  };
  const onScroll = () => {
    const available = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
    maxScrollPercent = Math.max(maxScrollPercent, Math.min(100, Math.round((scrollY / available) * 100)));
  };
  const onSearch = (event) => record('ux.search', event.detail || {}, { entityType: 'dashboard_search' });
  const onNavigation = (event) => { pageViewCount += 1; record('ux.page_view', event.detail || {}); };
  const onError = (event) => record('ux.ui_error', { errorCode: String(event.error?.name || 'window_error').slice(0, 80) });
  const interval = setInterval(() => {
    if (pointerSamples) { record('ux.pointer_summary', { zoneCounts, sampleCount: pointerSamples, viewportWidth: innerWidth, viewportHeight: innerHeight }); zoneCounts = {}; pointerSamples = 0; }
    record('ux.scroll_depth', { maxScrollPercent }); flush();
  }, FLUSH_MS);
  addEventListener('click', onClick, true); addEventListener('pointermove', onPointer, { passive: true }); addEventListener('scroll', onScroll, { passive: true });
  addEventListener('popstate', pageView); addEventListener('glondia:ux-navigation', onNavigation); addEventListener('glondia:ux-search', onSearch); addEventListener('error', onError); pageView();
  const onPageHide = () => { record('ux.session_summary', { durationMs: Date.now() - startedAt, clickCount, pageViewCount, maxScrollPercent }); flush(); };
  addEventListener('pagehide', onPageHide);
  return () => { clearInterval(interval); removeEventListener('click', onClick, true); removeEventListener('pointermove', onPointer); removeEventListener('scroll', onScroll); removeEventListener('popstate', pageView); removeEventListener('glondia:ux-navigation', onNavigation); removeEventListener('glondia:ux-search', onSearch); removeEventListener('error', onError); removeEventListener('pagehide', onPageHide); window.__glondiaUxTelemetry = false; };
}
