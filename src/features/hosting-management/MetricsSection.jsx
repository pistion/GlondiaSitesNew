import React, { useEffect, useMemo, useState } from 'react';
import { getHostingMetrics, listHostingEvents } from '../../api';
import { ICN } from '../../icons';

const AXIS_STEPS = [1, 0.75, 0.5, 0.25, 0];

export default function MetricsSection({ deploymentId }) {
  const [raw, setRaw] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [err, setErr] = useState('');
  const [range, setRange] = useState('12h');
  const [eventFilters, setEventFilters] = useState([]);
  const [openMenu, setOpenMenu] = useState('');
  const [usageOpen, setUsageOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    getHostingMetrics(deploymentId, 'bandwidth', { range })
      .then((data) => { if (!cancelled) setRaw(data); })
      .catch((error) => { if (!cancelled) setErr(error.message || 'Could not load network metrics.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [deploymentId, range]);

  useEffect(() => {
    let cancelled = false;
    setEventsLoading(true);
    listHostingEvents(deploymentId)
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data?.events)
              ? data.events
              : [];
        setEvents(rows);
      })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setEventsLoading(false); });
    return () => { cancelled = true; };
  }, [deploymentId]);

  const points = useMemo(() => normalizeBandwidthPoints(raw), [raw]);
  const hasRealSamples = points.length > 0;
  const chartPoints = hasRealSamples ? points : makeZeroActivityPoints(range);
  const usageMb = raw?.usageThisMonthMb != null
    ? Number(raw.usageThisMonthMb)
    : Math.round(chartPoints.reduce((sum, point) => sum + Number(point.value || 0), 0));
  const eventTypes = useMemo(() => summarizeEventTypes(events), [events]);
  const activeEvents = useMemo(() => {
    if (!eventFilters.length) return events;
    return events.filter((event) => eventFilters.includes(eventType(event)));
  }, [events, eventFilters]);
  const eventCount = eventsLoading ? '...' : activeEvents.length;
  const toggleEventFilter = (type) => {
    setEventFilters((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  };
  return (
    <div className="hosting-network-metrics">
      <div className="hosting-metrics-toolbar">
        <div className="hosting-metrics-dropdown">
          <button className="hosting-metrics-control" type="button" onClick={() => setOpenMenu((menu) => menu === 'events' ? '' : 'events')} aria-expanded={openMenu === 'events'}>
            <ICN.Filter size={15} />
            <span>Filter events</span>
            <strong>{eventCount}</strong>
            <ICN.ChevronDown size={14} />
          </button>
          {openMenu === 'events' && (
            <div className="hosting-metrics-menu">
              <div className="hosting-metrics-menu-head">
                <span>Event types</span>
                <button type="button" onClick={() => setEventFilters([])}>Clear</button>
              </div>
              {eventTypes.length === 0 ? (
                <div className="hosting-metrics-menu-empty">No events recorded yet.</div>
              ) : eventTypes.map((item) => (
                <button className="hosting-metrics-check-row" type="button" key={item.type} onClick={() => toggleEventFilter(item.type)}>
                  <span className={`hosting-metrics-check${eventFilters.includes(item.type) ? ' active' : ''}`}>{eventFilters.includes(item.type) && <ICN.Check size={11} stroke={3} />}</span>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hosting-metrics-dropdown">
          <button className="hosting-metrics-control hosting-metrics-range-button" type="button" onClick={() => setOpenMenu((menu) => menu === 'range' ? '' : 'range')} aria-expanded={openMenu === 'range'}>
            <ICN.Clock size={15} />
            <span>{rangeLabel(range)}</span>
            <ICN.ChevronDown size={14} />
          </button>
          {openMenu === 'range' && (
            <div className="hosting-metrics-menu hosting-metrics-menu--narrow">
              {[
                ['12h', 'Last 12 hours'],
                ['24h', 'Last 24 hours'],
                ['7d', 'Last 7 days'],
              ].map(([value, label]) => (
                <button className={`hosting-metrics-option${range === value ? ' active' : ''}`} type="button" key={value} onClick={() => { setRange(value); setOpenMenu(''); }}>
                  <span>{label}</span>
                  {range === value && <ICN.Check size={13} stroke={3} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="hosting-network-panel">
        <div className="hosting-network-title">
          <div>
            <div className="page-eyebrow" style={{ marginBottom: 6 }}>Traffic</div>
            <h2>Network Metrics</h2>
          </div>
          {loading && <span>Loading...</span>}
          {!loading && err && <span className="danger">{err}</span>}
        </div>

        <div className="hosting-network-chart-section">
          <h3>Outbound Bandwidth</h3>
          <NetworkChart points={chartPoints} loading={loading} hasRealSamples={hasRealSamples} />
        </div>

        {raw?.source === 'sandbox' && (
          <div className="hosting-network-sandbox-note">
            Sandbox mode is active. Metrics are generated by the sandbox service so you can test the UI without calling the live provider.
          </div>
        )}

        <div className="hosting-network-note">
          <ICN.Info size={17} />
          <span>{hasRealSamples ? 'This graph uses stored provider samples.' : 'No stored provider activity yet, so the graph is accurately showing zero activity.'} Showing {eventCount} matching events.</span>
        </div>

        <button className={`hosting-network-usage-row${usageOpen ? ' active' : ''}`} type="button" onClick={() => setUsageOpen((open) => !open)} aria-expanded={usageOpen}>
          <div>
            <ICN.Chevron size={17} className="hosting-network-usage-chevron" />
            <strong>Usage this month</strong>
          </div>
          <span>{formatMb(Math.max(usageMb, 0))} <small>MB</small></span>
        </button>
        {usageOpen && (
          <div className="hosting-network-usage-detail">
            <div>
              <span>Bandwidth used</span>
              <strong>{formatMb(Math.max(usageMb, 0))} MB</strong>
            </div>
            <div>
              <span>Visible range</span>
              <strong>{rangeLabel(range)}</strong>
            </div>
            <div>
              <span>Data source</span>
              <strong>{raw?.source || 'provider'}</strong>
            </div>
            <div>
              <span>Resolution</span>
              <strong>{raw?.resolution || 'hour'}ly</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NetworkChart({ points, loading, hasRealSamples }) {
  const maxValue = Math.max(1, ...points.map((point) => Number(point.value || 0)));
  const width = 940;
  const height = 244;
  const top = 24;
  const bottom = 44;
  const left = 26;
  const right = 74;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const path = points.map((point, index) => {
    const x = left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * innerWidth);
    const y = top + innerHeight - (Number(point.value || 0) / maxValue) * innerHeight;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="hosting-network-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Outbound bandwidth line chart">
        {AXIS_STEPS.map((ratio) => {
          const value = maxValue * ratio;
          const y = top + (1 - ratio) * innerHeight;
          return (
            <g key={ratio}>
              <line x1={left} x2={width - right} y1={y} y2={y} className="hosting-network-gridline" />
              <text x={width - right + 8} y={y + 4} className="hosting-network-axis-text">{formatMb(value)} MB</text>
            </g>
          );
        })}
        {points.length > 0 && <polyline points={path} className={`hosting-network-line${hasRealSamples ? '' : ' zero'}`} />}
        {points.map((point, index) => {
          const x = left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * innerWidth);
          const maxLabels = 6;
          const step = Math.max(1, Math.ceil(points.length / maxLabels));
          const show = index === 0 || index === points.length - 1 || index % step === 0;
          if (!show) return null;
          return <text key={`${point.label}:${index}`} x={x} y={height - 10} textAnchor="middle" className="hosting-network-axis-text hosting-network-x-label">{point.label}</text>;
        })}
      </svg>
      {!loading && !hasRealSamples && <div className="hosting-network-chart-empty">Zero recorded bandwidth activity for this range.</div>}
    </div>
  );
}

function summarizeEventTypes(events = []) {
  const counts = new Map();
  events.forEach((event) => {
    const type = eventType(event);
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count, label: eventLabel(type) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function eventType(event = {}) {
  return String(event.type || event.eventType || event.name || 'activity').trim() || 'activity';
}

function eventLabel(type = '') {
  return String(type)
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function rangeLabel(value) {
  if (value === '24h') return 'Last 24 hours';
  if (value === '7d') return 'Last 7 days';
  return 'Last 12 hours';
}

function makeZeroActivityPoints(range = '12h') {
  const now = new Date();
  if (range === '7d') {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now.getTime() - (6 - index) * 24 * 60 * 60 * 1000);
      return { label: date.toLocaleDateString([], { month: 'short', day: 'numeric' }), value: 0, timestamp: date.toISOString() };
    });
  }
  const hours = range === '24h' ? 24 : 12;
  const pointCount = range === '24h' ? 12 : 12;
  const stepHours = hours / Math.max(1, pointCount - 1);
  return Array.from({ length: pointCount }, (_, index) => {
    const date = new Date(now.getTime() - (hours - stepHours * index) * 60 * 60 * 1000);
    return { label: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase(), value: 0, timestamp: date.toISOString() };
  });
}

function normalizeBandwidthPoints(data) {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.values)
        ? data.values
        : Array.isArray(data?.points)
          ? data.points
          : [];

  return rows
    .map((item, index) => {
      const value = Number(item.value ?? item.bandwidth ?? item.outboundBandwidth ?? item.bytes ?? 0);
      return {
        label: formatMetricTime(item.timestamp || item.time || item.date, index),
        value: item.bytes != null ? bytesToMb(value) : value,
      };
    })
    .filter((point) => Number.isFinite(point.value))
    .slice(-12);
}

function formatMb(value) {
  const rounded = Number(value || 0);
  if (rounded >= 10) return String(Math.round(rounded));
  if (rounded >= 1) return rounded.toFixed(1).replace(/\.0$/, '');
  return rounded.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
}

function bytesToMb(value) {
  return value / (1024 * 1024);
}

function formatMetricTime(value, index) {
  const date = value ? new Date(value) : new Date(Date.now() - (11 - index) * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) return String(index + 1);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}
