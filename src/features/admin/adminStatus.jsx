// adminStatus.js — shared formatting utilities for admin console
import React from 'react';

export function money(cents = 0, currency = 'PGK') {
  return `${currency} ${((cents || 0) / 100).toFixed(2)}`;
}

export function when(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function whenDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return '—';
  }
}

const STATUS_TONES = {
  success: ['paid', 'approved', 'live', 'active', 'verified'],
  warn: ['pending', 'payment_uploaded', 'building', 'trialing', 'eligible'],
  danger: [
    'expired', 'rejected', 'payment_expired', 'deleted', 'overdue_suspended',
    'suspended', 'disabled', 'failed', 'overdue',
  ],
  info: ['free', 'promo', 'starter', 'standard', 'admin'],
};

function toneFor(value) {
  const v = String(value || '').toLowerCase();
  for (const [tone, vals] of Object.entries(STATUS_TONES)) {
    if (vals.includes(v)) return tone;
  }
  return 'info';
}

const TONE_COLORS = {
  success: { fg: 'var(--accent)' },
  warn:    { fg: '#9a6200' },
  danger:  { fg: '#c0392b' },
  info:    { fg: 'var(--text-muted)' },
};

export function StatusPill({ value }) {
  if (!value) return <span className="muted">—</span>;
  const tone = toneFor(value);
  const { fg } = TONE_COLORS[tone];
  return (
    <span
      style={{
        background: 'transparent',
        color: fg,
        padding: 0,
        borderRadius: 0,
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {value}
    </span>
  );
}

/** Truncate a value to `width` chars for table cells. */
export function col(val, width = 14) {
  const s = String(val || '');
  return s.length > width ? s.slice(0, width) + '…' : s;
}
