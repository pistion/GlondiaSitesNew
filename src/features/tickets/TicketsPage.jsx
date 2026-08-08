/**
 * SupportPage — the customer's in-app support messaging surface.
 *
 * Left: ticket list (subject, category, priority, status, last message, unread).
 * Right: conversation thread with message bubbles, delivery tags
 * (Sent / Seen / Replied) and a composer. Backed by /api/v1/tickets.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ICN } from '../../icons';
import { Empty, StatusBadge } from '../../components';
import {
  listTickets, createTicket, getTicket, sendTicketMessage, markTicketSeen,
} from '../../api/tickets.js';
import SandboxBanner from '../sandbox/SandboxBanner.jsx';

const CATEGORIES = ['general', 'billing', 'hosting', 'domain', 'vps', 'email', 'account', 'complaint'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const RELATED_TYPES = ['', 'hosting', 'domain', 'vps', 'email', 'builder'];
const EMPTY_TICKET_FORM = { subject: '', category: 'general', priority: 'normal', relatedServiceType: '', body: '' };

// "2 minutes ago", "Yesterday", exact date when older.
export function timeAgo(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min === 1) return '1 minute ago';
  if (min < 60) return `${min} minutes ago`;
  const hrs = Math.floor(min / 60);
  if (hrs === 1) return '1 hour ago';
  if (hrs < 24) return `${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_TAG = { sent: 'Sent', seen: 'Seen', replied: 'Replied' };

function ticketPreviewState(ticket) {
  if (!ticket) return { label: 'No activity', tone: 'muted' };
  if (ticket.unreadForCustomer > 0) return { label: 'Unread reply', tone: 'danger' };
  if (ticket.status === 'pending_admin') return { label: 'Sent to support', tone: 'warn' };
  if (ticket.status === 'pending_customer') return { label: 'Answered', tone: 'success' };
  if (ticket.status === 'resolved') return { label: 'Resolved', tone: 'success' };
  if (ticket.status === 'closed') return { label: 'Closed', tone: 'muted' };
  const last = ticket.lastMessage;
  if (last?.senderRole === 'admin') return { label: last.status === 'seen' ? 'Read' : 'Answered', tone: 'success' };
  if (last?.senderRole === 'customer') return { label: last.status === 'replied' ? 'Answered' : last.status === 'seen' ? 'Seen by support' : 'Sent', tone: last.status === 'sent' ? 'warn' : 'success' };
  return { label: 'Open', tone: 'muted' };
}

function MessageBubble({ msg, mine }) {
  return (
    <div className={`support-message ${mine ? 'support-message--customer' : 'support-message--admin'}`}>
      <div className="support-message-meta">
        <span className="support-message-sender">{mine ? 'You' : 'Glondia Support'}</span>
        <span className="support-message-time">{timeAgo(msg.createdAt)}</span>
      </div>
      <div className="support-message-body">{msg.body}</div>
      {mine && STATUS_TAG[msg.status] && (
        <div className={`support-message-status support-message-status--${msg.status}`}>
          {msg.status === 'replied' ? <ICN.MessageSquare size={10} /> : <ICN.Check size={10} />}
          {STATUS_TAG[msg.status]}
        </div>
      )}
    </div>
  );
}

export default function SupportPage({ initialTicketId = null }) {
  const [tickets, setTickets] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(initialTicketId);
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_TICKET_FORM);
  const scrollRef = useRef(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const loadList = useCallback(async (pickFirst = false) => {
    try {
      const result = await listTickets({ limit: 50 });
      const items = result?.items ?? [];
      setTickets(items);
      if (pickFirst && !selectedRef.current && items.length > 0) setSelectedId(items[0].id);
    } catch (err) {
      setError(err.message || 'Could not load tickets.');
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (ticketId, { quiet = false } = {}) => {
    if (!ticketId) return;
    if (!quiet) setThreadLoading(true);
    try {
      const ticket = await getTicket(ticketId);
      if (selectedRef.current !== ticketId) return; // user moved on
      setThread(ticket);
      // Opening the conversation marks admin messages seen + clears our badge.
      if (ticket.unreadForCustomer > 0 || ticket.messages?.some((m) => m.senderRole === 'admin' && m.status === 'sent')) {
        markTicketSeen(ticketId).catch(() => {});
        setTickets((prev) => prev.map((t) => (t.id === ticketId ? { ...t, unreadForCustomer: 0 } : t)));
      }
    } catch (err) {
      if (!quiet) setError(err.message || 'Could not load the conversation.');
    } finally {
      if (!quiet) setThreadLoading(false);
    }
  }, []);

  useEffect(() => { loadList(true); }, [loadList]);

  // Selected conversation: load + keep fresh while open.
  useEffect(() => {
    if (!selectedId) { setThread(null); return; }
    loadThread(selectedId);
    const t = setInterval(() => loadThread(selectedId, { quiet: true }), 12000);
    return () => clearInterval(t);
  }, [selectedId, loadThread]);

  // Ticket list stays fresh in the background.
  useEffect(() => {
    const t = setInterval(() => loadList(false), 30000);
    return () => clearInterval(t);
  }, [loadList]);

  // Pin the thread to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages?.length, selectedId]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !selectedId || sending) return;
    setSending(true); setError('');
    try {
      await sendTicketMessage(selectedId, body);
      setDraft('');
      await Promise.all([loadThread(selectedId, { quiet: true }), loadList(false)]);
    } catch (err) {
      setError(err.message || 'Message failed to send.');
    } finally {
      setSending(false);
    }
  };

  const create = async () => {
    if (!form.subject.trim() || !form.body.trim() || creating) return;
    setCreating(true); setError('');
    try {
      const ticket = await createTicket({
        subject: form.subject,
        category: form.category,
        priority: form.priority,
        relatedServiceType: form.relatedServiceType || undefined,
        body: form.body,
      });
      setShowNew(false);
      setForm(EMPTY_TICKET_FORM);
      await loadList(false);
      setSelectedId(ticket.id);
    } catch (err) {
      setError(err.message || 'Could not create the ticket.');
    } finally {
      setCreating(false);
    }
  };

  const canReply = thread && thread.status !== 'closed';
  const openNewTicket = () => {
    if (tickets.length === 0) {
      setSelectedId(null);
      setThread(null);
    }
    setForm(EMPTY_TICKET_FORM);
    setShowNew(true);
  };
  const closeNewTicket = () => {
    setShowNew(false);
    setForm(EMPTY_TICKET_FORM);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Support</div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ICN.MessageSquare size={22} /> Contact support
          </h1>
          <p className="sub">Message the Glondia team — replies land right here and in your notifications.</p>
        </div>
        {(listLoading || tickets.length > 0 || showNew) && (
          <div className="actions">
            <button className="btn btn-primary" onClick={openNewTicket}>
              <ICN.Plus size={14} /> {tickets.length === 0 && showNew ? 'Start another ticket' : 'New ticket'}
            </button>
          </div>
        )}
      </div>

      <SandboxBanner service="support" />

      {error && (
        <div className="card" style={{ padding: '10px 16px', color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      {!listLoading && tickets.length === 0 && !showNew ? (
        <Empty
          icon="MessageSquare"
          title="No conversations yet"
          body="Open a ticket and our team will reply here — usually within a few hours."
          action={<button className="btn btn-primary" onClick={openNewTicket}><ICN.Plus size={14} /> Start a new ticket</button>}
        />
      ) : !listLoading && tickets.length === 0 && showNew ? (
        <div className="support-page support-page--new-only">
          <div className="support-ticket-list card support-ticket-list--empty">
            <button className="support-ticket-item active" type="button">
              <div className="support-ticket-top">
                <span className="support-ticket-subject">New ticket draft</span>
              </div>
              <div className="support-ticket-snippet">Complete the form to open your first support conversation.</div>
              <div className="support-ticket-meta">
                <span className="support-ticket-state support-ticket-state--warn">Draft</span>
                <span className="support-ticket-chip">{form.category}</span>
                <span className="support-ticket-chip">{form.priority}</span>
              </div>
            </button>
          </div>
          <div className="support-thread card support-new-inline">
            <div className="card-head">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ICN.MessageSquare size={16} /> New support ticket</h2>
              <button className="btn btn-icon btn-ghost" onClick={closeNewTicket} aria-label="Close"><ICN.X size={16} /></button>
            </div>
            <div className="support-new-body">
              <label className="field">
                <span>Subject</span>
                <input value={form.subject} maxLength={140}
                       onChange={(e) => setForm({ ...form, subject: e.target.value })}
                       placeholder="Short summary of what you need" />
              </label>
              <div className="support-new-row">
                <label className="field">
                  <span>Category</span>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Priority</span>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Related service</span>
                  <select value={form.relatedServiceType} onChange={(e) => setForm({ ...form, relatedServiceType: e.target.value })}>
                    {RELATED_TYPES.map((s) => <option key={s || 'none'} value={s}>{s || 'none'}</option>)}
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Message</span>
                <textarea rows={5} value={form.body}
                          onChange={(e) => setForm({ ...form, body: e.target.value })}
                          placeholder="Describe the issue â€” include links, project names or error messages." />
              </label>
            </div>
            <div className="support-new-foot">
              <button className="btn btn-outline" onClick={closeNewTicket} disabled={creating}>Cancel</button>
              <button className="btn btn-primary" onClick={create} disabled={creating || !form.subject.trim() || !form.body.trim()}>
                {creating ? 'Creatingâ€¦' : <><ICN.Send size={14} /> Create ticket</>}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={`support-page ${selectedId ? 'is-chat-open' : ''}`}>
          {/* Left: ticket list */}
          <div className="support-ticket-list card">
            {listLoading ? (
              <div className="support-list-empty">Loading conversations…</div>
            ) : tickets.map((t) => {
              const preview = ticketPreviewState(t);
              return (
                <button
                  key={t.id}
                  className={`support-ticket-item ${t.id === selectedId ? 'active' : ''}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div className="support-ticket-top">
                    <span className="support-ticket-subject">{t.subject}</span>
                    <span className="support-ticket-time">{timeAgo(t.lastMessageAt || t.createdAt)}</span>
                    {t.unreadForCustomer > 0 && (
                      <span className="support-unread-badge">{t.unreadForCustomer > 9 ? '9+' : t.unreadForCustomer}</span>
                    )}
                  </div>
                  <div className="support-ticket-snippet">
                    {t.lastMessage
                      ? `${t.lastMessage.senderRole === 'customer' ? 'You: ' : 'Support: '}${t.lastMessage.body}`
                      : 'No messages yet'}
                  </div>
                  <div className="support-ticket-meta">
                    <span className={`support-ticket-state support-ticket-state--${preview.tone}`}>{preview.label}</span>
                    <span className="support-ticket-status-text">{String(t.status || 'open').replace(/_/g, ' ')}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: conversation */}
          <div className="support-thread card">
            {!selectedId || (!thread && threadLoading) ? (
              <div className="support-thread-empty">
                <ICN.MessageSquare size={28} />
                <span>{threadLoading ? 'Loading conversation…' : 'Select a conversation'}</span>
              </div>
            ) : thread ? (
              <>
                <div className="support-thread-head">
                  <button className="btn btn-icon btn-ghost support-thread-back" onClick={() => setSelectedId(null)} aria-label="All tickets">
                    <ICN.ArrowLeft size={16} />
                  </button>
                  <div className="support-thread-avatar">
                    <ICN.MessageSquare size={17} />
                  </div>
                  <div>
                    <div className="support-thread-subject">{thread.subject}</div>
                    <div className="support-thread-sub">
                      <span className="support-ticket-chip support-ticket-chip--live">Glondia Support</span>
                      <span className="support-ticket-chip">{thread.category}</span>
                      <span className="support-ticket-chip">{thread.priority}</span>
                      <span className="support-ticket-time">Opened {timeAgo(thread.createdAt)}</span>
                    </div>
                  </div>
                  <StatusBadge value={thread.status} />
                </div>

                <div className="support-thread-scroll" ref={scrollRef}>
                  {(thread.messages ?? []).map((m) => (
                    <MessageBubble key={m.id} msg={m} mine={m.senderRole === 'customer'} />
                  ))}
                  {thread.status === 'closed' && (
                    <div className="support-thread-notice">This ticket is closed. Open a new ticket if you still need help.</div>
                  )}
                </div>

                <div className="support-composer">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={canReply ? 'Write a message… (Enter to send, Shift+Enter for a new line)' : 'This conversation is closed.'}
                    disabled={!canReply || sending}
                    rows={2}
                  />
                  <button className="btn btn-primary" onClick={send} disabled={!canReply || sending || !draft.trim()}>
                    {sending ? 'Sending…' : <><ICN.Send size={14} /> Send</>}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* New ticket drawer/modal */}
      {showNew && tickets.length > 0 && (
        <div className="modal-backdrop" onClick={() => !creating && closeNewTicket()}>
          <div className="modal card support-new-modal" onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ICN.MessageSquare size={16} /> New support ticket</h2>
              <button className="btn btn-icon btn-ghost" onClick={closeNewTicket} aria-label="Close"><ICN.X size={16} /></button>
            </div>
            <div className="support-new-body">
              <label className="field">
                <span>Subject</span>
                <input value={form.subject} maxLength={140}
                       onChange={(e) => setForm({ ...form, subject: e.target.value })}
                       placeholder="Short summary of what you need" />
              </label>
              <div className="support-new-row">
                <label className="field">
                  <span>Category</span>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Priority</span>
                  <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Related service</span>
                  <select value={form.relatedServiceType} onChange={(e) => setForm({ ...form, relatedServiceType: e.target.value })}>
                    {RELATED_TYPES.map((s) => <option key={s || 'none'} value={s}>{s || 'none'}</option>)}
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Message</span>
                <textarea rows={5} value={form.body}
                          onChange={(e) => setForm({ ...form, body: e.target.value })}
                          placeholder="Describe the issue — include links, project names or error messages." />
              </label>
            </div>
            <div className="support-new-foot">
              <button className="btn btn-outline" onClick={closeNewTicket} disabled={creating}>Cancel</button>
              <button className="btn btn-primary" onClick={create} disabled={creating || !form.subject.trim() || !form.body.trim()}>
                {creating ? 'Creating…' : <><ICN.Send size={14} /> Create ticket</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
