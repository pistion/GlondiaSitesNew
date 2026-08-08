import { createAnalyticsEvents } from '../repositories/analytics.repository.js';

const ALLOWED_EVENTS = new Set([
  'ux.page_view', 'ux.click', 'ux.search', 'ux.service_used', 'ux.pointer_summary',
  'ux.scroll_depth', 'ux.rage_click', 'ux.ui_error', 'ux.session_summary',
]);
const SAFE_KEY = /^(label|service|targetType|targetId|query|resultCount|resultTypes|zoneCounts|sampleCount|maxScrollPercent|viewportWidth|viewportHeight|durationMs|clickCount|pageViewCount|errorCode|fromPath|toPath)$/;

function cleanText(value, max = 200) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function cleanMetadata(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input && typeof input === 'object' ? input : {})) {
    if (!SAFE_KEY.test(key)) continue;
    if (Array.isArray(value)) output[key] = value.slice(0, 20).map((item) => cleanText(item, 80));
    else if (value && typeof value === 'object') {
      output[key] = Object.fromEntries(Object.entries(value).slice(0, 25).map(([k, v]) => [cleanText(k, 40), Number(v) || 0]));
    } else if (typeof value === 'number' || typeof value === 'boolean') output[key] = value;
    else output[key] = cleanText(value);
  }
  return output;
}

function normalize(event, userId, organizationId) {
  const eventType = cleanText(event?.event || event?.eventType, 80);
  if (!ALLOWED_EVENTS.has(eventType)) return null;
  const path = cleanText(event?.path, 500);
  if (!path.startsWith('/')) return null;
  return {
    userId,
    organizationId: organizationId || null,
    sessionId: cleanText(event.sessionId, 100) || null,
    eventType,
    entityType: cleanText(event.entityType, 80) || null,
    entityId: cleanText(event.entityId, 200) || null,
    path,
    metadata: JSON.stringify(cleanMetadata(event.metadata)),
  };
}

export async function captureUxEvents({ userId, organizationId = null, events }) {
  const input = Array.isArray(events) ? events.slice(0, 50) : [];
  const normalized = input.map((event) => normalize(event, userId, organizationId)).filter(Boolean);
  if (!normalized.length) return { accepted: 0 };
  await createAnalyticsEvents(normalized);
  return { accepted: normalized.length };
}
