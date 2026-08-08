import React, { useEffect, useRef, useState } from 'react';
import { Badge } from '../../components';
import { ICN } from '../../icons';
import { getDeploymentLogStreamUrl } from '../../api';

function formatLogStamp(value) {
  try {
    const date = value ? new Date(value) : new Date();
    if (!Number.isFinite(date.getTime())) return '—';
    const month = date.toLocaleString([], { month: 'short' });
    const day = String(date.getDate()).padStart(2, '0');
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `${month} ${day} ${time}`;
  } catch {
    return '—';
  }
}

function normalizeLevel(log) {
  const level = String(log?.level || log?.type || '').toLowerCase();
  const message = String(log?.message || log?.msg || '').toLowerCase();
  if (level.includes('error') || message.includes('failed') || message.includes('error')) return 'error';
  if (level.includes('warn') || message.includes('warning')) return 'warn';
  if (message.includes('done') || message.includes('success') || message.includes('live')) return 'success';
  return 'info';
}

function rowPrefix(log) {
  const source = String(log?.source || '').toLowerCase();
  if (source === 'render' || source === 'provider') return '==>';
  if (source === 'system' || source === 'sys') return '•';
  return '›';
}

export default function BuildLogsSection({ deploymentId, compact = false }) {
  const [lines, setLines] = useState([]);
  const [streamStatus, setStreamStatus] = useState(null);
  const [connState, setConnState] = useState('connecting');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [liveTail, setLiveTail] = useState(true);
  const bottomRef = useRef(null);
  const seenIds = useRef(new Set());

  useEffect(() => {
    setLines([]);
    seenIds.current = new Set();
    setConnState('connecting');
    const es = new EventSource(getDeploymentLogStreamUrl(deploymentId));
    es.addEventListener('open', () => setConnState('live'));
    es.addEventListener('log', (event) => {
      try {
        const log = JSON.parse(event.data);
        const key = log.id || `${log.source}:${log.timestamp}:${log.message}`;
        if (seenIds.current.has(key)) return;
        seenIds.current.add(key);
        setLines((prev) => [...prev, log]);
      } catch {}
    });
    es.addEventListener('status', (event) => {
      try { setStreamStatus(JSON.parse(event.data)); } catch {}
    });
    es.addEventListener('done', () => { setConnState('ended'); es.close(); });
    es.addEventListener('error', () => { setConnState('error'); es.close(); });
    return () => es.close();
  }, [deploymentId]);

  useEffect(() => {
    if (liveTail && !compact) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length, compact, liveTail]);

  const displayLines = lines;
  const filteredLines = displayLines.filter((log) => {
    const level = normalizeLevel(log);
    if (filter !== 'all' && level !== filter) return false;
    if (!query.trim()) return true;
    return String(log.message || log.msg || '').toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <div className={`hosting-log-console${compact ? ' is-compact' : ''}`}>
      <div className="hosting-log-toolbar">
        <label className="hosting-log-select">
          <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter logs">
            <option value="all">All logs</option>
            <option value="info">Info</option>
            <option value="success">Success</option>
            <option value="warn">Warnings</option>
            <option value="error">Errors</option>
          </select>
          <ICN.ChevronDown size={16} />
        </label>

        <label className="hosting-log-search">
          <ICN.Search size={18} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search logs"
          />
        </label>

        <button
          type="button"
          className={`hosting-log-live${liveTail ? ' is-on' : ''}`}
          onClick={() => setLiveTail((value) => !value)}
        >
          <ICN.Zap size={17} />
          <span>{liveTail ? 'Live tail' : 'Paused'}</span>
          <ICN.ChevronDown size={15} />
        </button>

        <span className="hosting-log-tz">PST</span>

        <button type="button" className="hosting-log-icon-btn" onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })} title="Jump to latest">
          <ICN.ArrowRight size={18} style={{ transform: 'rotate(90deg)' }} />
        </button>
        <button type="button" className="hosting-log-icon-btn" title="Open full logs">
          <ICN.ExternalLink size={17} />
        </button>
      </div>

      {streamStatus && (
        <div className="hosting-log-status">
          <Badge tone={streamStatus.status === 'live' ? 'success' : streamStatus.status === 'failed' ? 'danger' : 'muted'} dot={false}>
            {streamStatus.currentStep || streamStatus.status || 'Preparing'}
          </Badge>
          <span>{filteredLines.length} of {displayLines.length} events</span>
          <span>Connection: {connState}</span>
        </div>
      )}

      <div className="hosting-log-panel" style={{ maxHeight: compact ? 220 : 560 }}>
        {filteredLines.length === 0 && (
          <div className="hosting-log-empty">
            <span>No log lines yet.</span>
            <small>{connState === 'live' ? 'Waiting for provider events…' : `Stream is ${connState}.`}</small>
          </div>
        )}
        {filteredLines.map((log, index) => {
          const level = normalizeLevel(log);
          return (
            <div key={log.id || index} className={`hosting-log-line level-${level}`}>
              <span className="hosting-log-time">{formatLogStamp(log.timestamp || log.createdAt)}</span>
              <span className="hosting-log-level" title={level}>i</span>
              <span className="hosting-log-prefix">{rowPrefix(log)}</span>
              <span className="hosting-log-message">
                {log.stage && <span className="hosting-log-stage">[{String(log.stage).replaceAll('_', ' ')}] </span>}
                {log.message || log.msg}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
