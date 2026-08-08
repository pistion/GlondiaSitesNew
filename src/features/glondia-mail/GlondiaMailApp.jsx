/**
 * Mailboxes — separate full-page webmail on the same site.
 * Routes: /mailboxes, /mail, /glondiamail
 *
 * - Login looks like the Glondia dashboard auth screen
 * - Inside: classic mail layout (folders + list + reading pane)
 * - No fake real messages. Passwords never stored in localStorage.
 */
import React from 'react';
import DOMPurify from 'dompurify';
import { ICN } from '../../icons';
import { isFeatureEnabled } from '../../app/features.js';
import './GlondiaMailApp.css';
import './ComposeEditor.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import '@fontsource/lora/400.css';
import '@fontsource/roboto/400.css';
import '@fontsource/source-serif-4/400.css';
import {
  getMailSession,
  loginMail,
  logoutMail,
  listMailFolders,
  listMailMessages,
  getMailMessage,
  getMailAttachmentUrl,
  moveMailMessage,
  updateMailMessage,
} from '../../api/glondiaMail.js';

const { useState, useEffect, useCallback, useMemo, useRef } = React;

const PREVIEW_KEY = 'glondia.mailboxes.preview';

const FOLDERS = [
  { id: 'inbox', name: 'Inbox', icon: 'Inbox' },
  { id: 'starred', name: 'Starred', icon: 'Star' },
  { id: 'sent', name: 'Sent', icon: 'Send' },
  { id: 'drafts', name: 'Drafts', icon: 'File' },
  { id: 'spam', name: 'Spam', icon: 'AlertCircle' },
  { id: 'trash', name: 'Trash', icon: 'Trash' },
  { id: 'archive', name: 'Archive', icon: 'Archive' },
];

const EMAIL_DOCUMENT_STYLE = `<style>
html{color-scheme:light;background:#fff;overflow-y:hidden}body{margin:0;padding:20px;color:#28323d;background:#fff;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;overflow-x:auto;overflow-y:hidden;overflow-wrap:break-word;word-break:normal}
img{max-width:100%!important;height:auto!important}table{max-width:100%!important}td,th{overflow-wrap:break-word}pre{max-width:100%;overflow:auto;white-space:pre-wrap}blockquote{margin-left:0;padding-left:16px;border-left:3px solid #dfe7e2;color:#667085}a{color:#087b42}form,script,style+script{display:none!important}
</style>`;

function addressText(items = []) {
  return items.map((item) => item?.name ? `${item.name} <${item.address}>` : item?.address).filter(Boolean).join(', ');
}

function buildEmailHtml(message) {
  let html = String(message?.htmlBody || '');
  for (const attachment of message?.attachments || []) {
    if (!attachment.contentId) continue;
    const cid = String(attachment.contentId).replace(/[<>]/g, '');
    html = html.replaceAll(`cid:${cid}`, getMailAttachmentUrl(message.id, attachment.id));
  }
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'form', 'input', 'button', 'textarea', 'select', 'object', 'embed', 'video', 'audio', 'iframe', 'meta', 'base'],
    FORBID_ATTR: ['srcset'],
    ADD_ATTR: ['target', 'rel'],
  });
  const linked = clean.replace(/<a\b/gi, '<a target="_blank" rel="noopener noreferrer"');
  return { srcDoc: `<!doctype html><html><head>${EMAIL_DOCUMENT_STYLE}</head><body>${linked}</body></html>` };
}

function PlainTextMessage({ text }) {
  const parts = String(text || '').split(/(https?:\/\/[^\s<]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g);
  return <div className="glondia-mail__plain-text">{parts.map((part, index) => {
    if (/^https?:\/\//i.test(part)) return <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a>;
    if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(part)) return <a key={index} href={`mailto:${part}`}>{part}</a>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  })}</div>;
}

function EmailHtmlFrame({ srcDoc }) {
  const frameRef = useRef(null);
  const observerRef = useRef(null);
  const [height, setHeight] = useState(200);

  const measure = useCallback(() => {
    const document = frameRef.current?.contentDocument;
    if (!document) return;
    const nextHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      200,
    );
    setHeight(nextHeight + 2);
  }, []);

  const onLoad = () => {
    observerRef.current?.disconnect();
    const document = frameRef.current?.contentDocument;
    document?.documentElement?.style.setProperty('overflow-y', 'hidden', 'important');
    document?.body?.style.setProperty('overflow-y', 'hidden', 'important');
    measure();
    const body = document?.body;
    if (body && typeof ResizeObserver !== 'undefined') {
      observerRef.current = new ResizeObserver(measure);
      observerRef.current.observe(body);
    }
    body?.querySelectorAll('img').forEach((image) => image.addEventListener('load', measure, { once: true }));
  };

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return <iframe
    ref={frameRef}
    className="glondia-mail__html-frame"
    title="Email content"
    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    srcDoc={srcDoc}
    scrolling="no"
    onLoad={onLoad}
    style={{ height }}
  />;
}

function MessageContent({ message }) {
  const rendered = useMemo(() => buildEmailHtml(message), [message]);
  return <div className="glondia-mail__content-wrap">
    {message?.htmlBody
      ? <EmailHtmlFrame srcDoc={rendered.srcDoc}/>
      : <PlainTextMessage text={message?.textBody || 'Message body is empty.'}/>}
  </div>;
}

function readPreview() {
  try {
    const raw = sessionStorage.getItem(PREVIEW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.mailbox) return parsed;
  } catch { /* ignore */ }
  return null;
}

function writePreview(mailbox) {
  try {
    sessionStorage.setItem(PREVIEW_KEY, JSON.stringify({ mailbox, at: Date.now() }));
  } catch { /* ignore */ }
}

function clearPreview() {
  try { sessionStorage.removeItem(PREVIEW_KEY); } catch { /* ignore */ }
}

export default function GlondiaMailApp() {
  if (!isFeatureEnabled('glondiaMail')) {
    return (
      <div style={S.page}>
        <div style={S.box}>
          <div style={S.head}>
            <div style={S.headBrand}><ICN.Mail size={16} /></div>
            <div style={S.titleBar}>Mailboxes — offline</div>
          </div>
          <div style={S.body}>
            <div style={S.eyebrow}><span style={S.pulse} /> Feature off</div>
            <h1 style={S.h1}>Mailboxes unavailable</h1>
            <p style={S.sub}>Enable VITE_FEATURE_GLONDIA_MAIL to use business mailboxes.</p>
            <a href="/" style={S.linkBack}>← Back to Glondia</a>
          </div>
        </div>
      </div>
    );
  }

  return <MailboxesApp />;
}

function MailboxesApp() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [folder, setFolder] = useState('inbox');
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [readerStatus, setReaderStatus] = useState('idle');
  const [readerError, setReaderError] = useState('');
  const [messageBusy, setMessageBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [composeSeed, setComposeSeed] = useState(null);
  const [undoMove, setUndoMove] = useState(null);
  const openRequestRef = useRef(0);
  const [listMsg, setListMsg] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [messageFilter, setMessageFilter] = useState('all');
  const [previewMode, setPreviewMode] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState(null);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getMailSession();
      if (s?.authenticated && s?.mailbox) {
        setSession(s);
        setPreviewMode(false);
        clearPreview();
      } else {
        const prev = readPreview();
        if (prev?.mailbox) {
          setSession({
            authenticated: true,
            configured: s?.configured === true,
            enabled: false,
            message: s?.message || 'Mail connection is being prepared. You can explore the Mailboxes interface.',
            mailbox: prev.mailbox,
            preview: true,
          });
          setPreviewMode(true);
        } else {
          setSession(s || { authenticated: false, configured: false });
          setPreviewMode(false);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshSession(); }, [refreshSession]);

  useEffect(() => {
    if (!session?.authenticated) return;
    let cancelled = false;
    setSelectedId(null);
    setSelected(null);
    (async () => {
      try {
        const data = await listMailMessages(folder);
        if (cancelled) return;
        setMessages(Array.isArray(data?.messages) ? data.messages : []);
        setListMsg(data?.message || (previewMode
          ? 'No messages yet. Your mailbox will sync when mail hosting is connected.'
          : ''));
      } catch {
        if (!cancelled) {
          setMessages([]);
          setListMsg('Could not load messages.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [session?.authenticated, folder, previewMode]);

  const openMessage = async (id) => {
    const requestId = ++openRequestRef.current;
    setSelectedId(id);
    setSelected(null);
    setReaderStatus('loading');
    setReaderError('');
    setDetailsOpen(false);
    setMoreOpen(false);
    try {
      const msg = await getMailMessage(id);
      if (requestId !== openRequestRef.current) return;
      setSelected(msg);
      setReaderStatus('ready');
      if (msg.unread) {
        setMessages((current) => current.map((item) => item.id === id ? { ...item, unread: false } : item));
        updateMailMessage(id, { seen: true }).catch(() => setMessages((current) => current.map((item) => item.id === id ? { ...item, unread: true } : item)));
      }
    } catch (error) {
      if (requestId !== openRequestRef.current) return;
      setReaderStatus('error');
      setReaderError(error?.message || 'Could not load this message.');
    }
  };

  const closeReader = () => {
    openRequestRef.current += 1;
    setSelectedId(null); setSelected(null); setReaderStatus('idle'); setReaderError(''); setMoreOpen(false);
  };

  const mutateMessage = async (changes) => {
    if (!selected?.id || messageBusy) return;
    const previous = selected;
    const optimistic = { ...selected, ...(typeof changes.flagged === 'boolean' ? { flagged: changes.flagged } : {}), ...(typeof changes.seen === 'boolean' ? { unread: !changes.seen } : {}) };
    setSelected(optimistic); setMessageBusy(true);
    setMessages((current) => current.map((item) => item.id === selected.id ? { ...item, ...optimistic } : item));
    try { setSelected(await updateMailMessage(selected.id, changes)); }
    catch (error) { setSelected(previous); setReaderError(error?.message || 'Could not update this message.'); }
    finally { setMessageBusy(false); }
  };

  const moveSelected = async (folderRole) => {
    if (!selected?.id || messageBusy) return;
    const originalFolderRole = selected.folderRole || folder;
    const moved = selected;
    setMessageBusy(true);
    try {
      await moveMailMessage(selected.id, folderRole);
      setMessages((current) => current.filter((item) => item.id !== selected.id));
      closeReader();
      if (folderRole === 'trash') setUndoMove({ message: moved, folderRole: originalFolderRole });
    } catch (error) { setReaderError(error?.message || `Could not move this message to ${folderRole}.`); }
    finally { setMessageBusy(false); }
  };

  const startCompose = (kind) => {
    if (!selected) return;
    const addresses = selected.addresses || {};
    const mailbox = String(session.mailbox || '').toLowerCase();
    const sender = addresses.replyTo?.length ? addresses.replyTo : addresses.from || [];
    const replyAll = [...sender, ...(addresses.to || []), ...(addresses.cc || [])].filter((item, index, all) => item.address && item.address.toLowerCase() !== mailbox && all.findIndex((candidate) => candidate.address?.toLowerCase() === item.address.toLowerCase()) === index);
    const quote = `\n\n--- Original message ---\nFrom: ${addressText(addresses.from)}\nDate: ${formatDate(selected.receivedAt || selected.date, true)}\nSubject: ${selected.subject}\n\n${selected.textBody || '[Formatted message]'}`;
    setComposeSeed({
      kind,
      to: kind === 'forward' ? '' : addressText(kind === 'reply-all' ? replyAll : sender),
      cc: kind === 'reply-all' ? addressText(addresses.cc || []) : '',
      subject: `${kind === 'forward' ? 'Fwd' : 'Re'}: ${String(selected.subject || '').replace(/^(Re|Fwd):\s*/i, '')}`,
      body: quote,
    });
    setComposeOpen(true);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return messages.filter((m) => {
      if (messageFilter === 'read' && m.unread) return false;
      if (messageFilter === 'unread' && !m.unread) return false;
      if (!q) return true;
      return [m.subject, m.fromName, m.from, m.preview, m.to]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(q));
    });
  }, [messages, search, messageFilter]);

  useEffect(() => {
    if (!selectedId || composeOpen) return undefined;
    const onKeyDown = (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || event.target?.isContentEditable) return;
      if (event.key === 'Escape') { if (attachmentPreview) setAttachmentPreview(null); else closeReader(); return; }
      if (!selected || readerStatus !== 'ready') return;
      if (event.key.toLowerCase() === 'r') startCompose('reply');
      else if (event.key.toLowerCase() === 'f') startCompose('forward');
      else if (event.key.toLowerCase() === 'a') moveSelected('archive');
      else if (event.key === 'Delete') moveSelected('trash');
      else if (['j', 'k'].includes(event.key.toLowerCase())) {
        const index = filtered.findIndex((item) => item.id === selectedId);
        const next = event.key.toLowerCase() === 'j' ? index + 1 : index - 1;
        if (filtered[next]) openMessage(filtered[next].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, selected, readerStatus, composeOpen, attachmentPreview, filtered]);

  const signOut = async () => {
    clearPreview();
    await logoutMail();
    setSession({ authenticated: false, configured: session?.configured });
    setPreviewMode(false);
    setMessages([]);
    setSelected(null);
  };

  if (loading && !session) {
    return (
      <div style={S.page}>
        <div style={{ color: '#9a9f98', fontFamily: sans, fontSize: 14 }}>Loading mailboxes…</div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return (
      <MailboxLogin
        session={session}
        onSuccess={async (mailbox, meta = {}) => {
          if (meta.preview) {
            writePreview(mailbox);
            setPreviewMode(true);
            setSession({
              authenticated: true,
              configured: false,
              enabled: false,
              preview: true,
              mailbox,
              message: 'Mail connection is being prepared. Interface is ready; messages will appear when hosting is live.',
            });
          } else {
            clearPreview();
            setPreviewMode(false);
            await refreshSession();
          }
        }}
      />
    );
  }

  const folderMeta = FOLDERS.find((f) => f.id === folder) || FOLDERS[0];

  return (
    <div style={M.shell} className="glondia-mail" data-theme="light">
      {/* Top bar */}
      <header style={M.topbar} className="glondia-mail__topbar">
        <div style={M.brand}>
          <div style={M.brandMark}><ICN.Mail size={18} /></div>
          <div>
            <div style={M.brandTitle}>Mailboxes</div>
            <div style={M.brandSub}>Glondia business mail</div>
          </div>
        </div>

        <div style={M.searchWrap}>
          <ICN.Search size={14} style={{ color: '#6c757d' }} />
          <input
            style={M.search}
            placeholder={`Search ${folderMeta.name.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={M.topActions} className="glondia-mail__top-actions">
          <button type="button" style={M.btnGhost} onClick={signOut}>Sign out</button>
        </div>
      </header>

      {(previewMode || session.configured === false) && (
        <div style={M.banner}>
          <ICN.Info size={14} />
          <span>
            {session.message || 'Mail connection is being prepared. Folders are ready; live sync starts when IMAP/SMTP is configured on the server.'}
          </span>
        </div>
      )}

      <div style={M.body} className={`glondia-mail__body${selectedId ? ' has-message' : ''}`}>
        {/* Folder rail */}
        <aside style={M.sidebar} className="glondia-mail__sidebar" aria-label="Mailbox folders">
          <div style={M.sidebarTitle}>Email</div>
          <button type="button" style={M.composeSide} onClick={() => setComposeOpen(true)}>
            <ICN.Mail size={15} /> New message
          </button>
          <nav className="glondia-mail__folders">
            {FOLDERS.map((f) => {
              const Icon = ICN[f.icon] || ICN.Mail;
              const active = folder === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  style={{ ...M.folderBtn, ...(active ? M.folderBtnActive : {}) }}
                  onClick={() => setFolder(f.id)}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={15} />
                  <span>{f.name}</span>
                  {f.id === 'inbox' && messages.length > 0 && <span style={M.folderCount}>{messages.length}</span>}
                </button>
              );
            })}
          </nav>
          <div style={M.folderSectionHead} className="glondia-mail__folder-tools"><span>Folders</span><ICN.Settings size={14}/></div>
          <button type="button" style={M.folderBtn} className="glondia-mail__add-folder"><ICN.Plus size={15}/><span>Add folder</span></button>
          <div style={M.sideFoot} className="glondia-mail__sidebar-foot">
            <a href="/#email" style={M.sideLink} onClick={(e) => {
              // Prefer dashboard email setup when using client router entry
              e.preventDefault();
              window.location.href = '/';
            }}>
              Business Email setup →
            </a>
            <div style={M.userChip} className="glondia-mail__sidebar-user" title={session.mailbox}>
              <div style={M.avatar}>{(session.mailbox || '?')[0].toUpperCase()}</div>
              <span style={M.userEmail}>{session.mailbox}</span>
            </div>
          </div>
        </aside>

        {/* Message list */}
        <section style={M.listPane} className="glondia-mail__list" aria-label={`${folderMeta.name} messages`}>
          <div style={M.listHead}>
            <div><h2 style={M.listTitle}>{folderMeta.name}</h2><span style={M.listCount}>{filtered.length} message{filtered.length === 1 ? '' : 's'}</span></div>
          </div>
          <div style={M.listTools} className="glondia-mail__list-tools">
            <div style={M.filterTabs}>{['all','read','unread'].map((value)=><button key={value} type="button" style={{...M.filterBtn,...(messageFilter===value?M.filterBtnActive:{})}} onClick={()=>setMessageFilter(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>
          </div>

          {filtered.length === 0 ? (
            <div style={M.emptyList}>
              <div style={M.emptyIcon}><ICN.Mail size={22} /></div>
              <div style={{ fontWeight: 600, color: '#111827', marginBottom: 6 }}>No messages</div>
              <div style={{ color: '#6c757d', fontSize: 13.5, maxWidth: 280, lineHeight: 1.5, textAlign: 'center' }}>
                {listMsg || `${folderMeta.name} is empty. Messages will appear here when your mailbox is connected.`}
              </div>
            </div>
          ) : (
            <div style={M.listScroll}>
              {filtered.map((m) => {
                const active = selectedId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`glondia-mail__message-row ${m.unread ? 'is-unread' : 'is-read'}`}
                    style={{ ...M.msgRow, ...(active ? M.msgRowActive : {}) }}
                    onClick={() => openMessage(m.id)}
                  >
                    <div style={M.msgTop}><span style={{...M.unreadDot,opacity:m.unread?1:0}}/><div style={M.msgFrom}>{m.fromName || m.from || m.to || 'Unknown'}</div><div style={M.msgDate}>{formatDate(m.date || m.createdAt)}</div></div>
                    <div style={M.msgSubject}>{m.subject || '(no subject)'} {m.hasAttachments&&<ICN.Paperclip size={12}/>}</div>
                    <div style={M.msgPreview}>{m.preview || m.snippet || ''}</div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Reading pane */}
        <section style={M.readPane} className="glondia-mail__reader-pane" aria-label="Message reader">
          {!selectedId ? (
            <div style={M.emptyList}>
              <div style={M.emptyIcon}><ICN.Layers size={22} /></div>
              <div style={{ fontWeight: 600, color: '#111827', marginBottom: 6 }}>Select a message</div>
              <div style={{ color: '#6c757d', fontSize: 13.5 }}>
                Choose a message from the list to read it here.
              </div>
            </div>
          ) : readerStatus === 'loading' ? (
            <div className="glondia-mail__reader-state" aria-live="polite"><div className="glondia-mail__reader-skeleton"/><div className="glondia-mail__reader-skeleton short"/><div className="glondia-mail__reader-skeleton body"/><span>Loading message…</span></div>
          ) : readerStatus === 'error' ? (
            <div className="glondia-mail__reader-state"><ICN.AlertCircle size={28}/><strong>Couldn’t load this message</strong><span>{readerError}</span><div><button type="button" style={M.btnPrimary} onClick={() => openMessage(selectedId)}>Retry</button><button type="button" style={M.btnGhost} onClick={closeReader}>Back to messages</button></div></div>
          ) : selected ? (
            <article style={M.reader} className="glondia-mail__reader">
              <div style={M.readToolbar} className="glondia-mail__reader-toolbar">
                <button type="button" className="glondia-mail__mobile-back" style={M.actionBtn} onClick={closeReader} aria-label="Back to message list"><ICN.ArrowLeft size={16}/><span>Back</span></button>
                <button type="button" style={M.actionBtn} onClick={() => startCompose('reply')} title="Reply"><ICN.ArrowLeft size={14}/> Reply</button>
                <button type="button" style={M.actionBtn} onClick={() => startCompose('reply-all')} title="Reply all"><ICN.Refresh size={14}/> Reply all</button>
                <button type="button" style={M.actionBtn} onClick={() => startCompose('forward')} title="Forward"><ICN.ArrowRight size={14}/> Forward</button>
                <span className="glondia-mail__toolbar-separator" />
                <div className="glondia-mail__desktop-actions">
                  <button type="button" style={M.actionBtn} disabled={messageBusy} onClick={() => mutateMessage({ flagged: !selected.flagged })} title={selected.flagged ? 'Remove star' : 'Star message'}><ICN.Star size={14}/>{selected.flagged ? 'Starred' : 'Star'}</button>
                  <button type="button" style={M.actionBtn} disabled={messageBusy} onClick={() => mutateMessage({ seen: false }).then?.(closeReader)} title="Mark unread"><ICN.Mail size={14}/> Unread</button>
                  <button type="button" style={M.actionBtn} disabled={messageBusy} onClick={() => moveSelected('archive')} title="Archive"><ICN.Archive size={14}/> Archive</button>
                  <button type="button" style={M.actionBtn} disabled={messageBusy} onClick={() => moveSelected('trash')} className="glondia-mail__danger-action" title="Move to Trash"><ICN.Trash size={14}/> Delete</button>
                </div>
                <div className="glondia-mail__more"><button type="button" style={M.actionBtn} onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} aria-label="More message actions"><ICN.Settings size={17}/> More</button>{moreOpen && <div className="glondia-mail__more-menu"><button type="button" onClick={() => mutateMessage({ flagged: !selected.flagged })}>Star</button><button type="button" onClick={() => { mutateMessage({ seen: false }); closeReader(); }}>Mark unread</button><button type="button" onClick={() => moveSelected('archive')}>Archive</button><button type="button" onClick={() => moveSelected('trash')}>Move to Trash</button></div>}</div>
              </div>
              <div className="glondia-mail__message">
                <header className="glondia-mail__message-head">
                  <h1 style={M.readSubject}>{selected?.subject || '(no subject)'}</h1>
                  <div style={M.readMeta} className="glondia-mail__sender">
                    <div style={M.avatarLg}>{(selected?.fromName || selected?.from || session.mailbox || '?')[0].toUpperCase()}</div>
                    <div className="glondia-mail__sender-copy">
                      <div className="glondia-mail__sender-line">
                        <strong>{selected?.addresses?.from?.[0]?.name || selected?.fromName || selected?.from || 'Unknown sender'}</strong>
                        {(selected?.addresses?.from?.[0]?.address || selected?.from) && <span>&lt;{selected?.addresses?.from?.[0]?.address || selected.from}&gt;</span>}
                      </div>
                      <div className="glondia-mail__recipient-line">
                        <button type="button" className="glondia-mail__details-toggle" onClick={() => setDetailsOpen((value) => !value)}>To: {addressText(selected?.addresses?.to) || selected?.to || session.mailbox} <ICN.ChevronDown size={12}/></button>
                      </div>
                    </div>
                    <time className="glondia-mail__message-date" dateTime={selected?.date || selected?.createdAt || undefined}>
                      {formatDate(selected?.date || selected?.createdAt, true)}
                    </time>
                  </div>
                  {detailsOpen && <div className="glondia-mail__message-details">
                    <span>From</span><strong>{addressText(selected.addresses?.from) || selected.from}</strong>
                    <span>Reply to</span><strong>{addressText(selected.addresses?.replyTo) || 'Same as sender'}</strong>
                    <span>To</span><strong>{addressText(selected.addresses?.to) || session.mailbox}</strong>
                    {selected.addresses?.cc?.length > 0 && <><span>Cc</span><strong>{addressText(selected.addresses.cc)}</strong></>}
                    <span>Date</span><strong>{formatDate(selected.receivedAt || selected.date, true)}</strong>
                    <span>Size</span><strong>{formatFileSize(selected.sizeBytes)}</strong>
                  </div>}
                </header>
                {readerError && <div className="glondia-mail__inline-error">{readerError}</div>}
                <div style={M.readBody} className="glondia-mail__message-body"><MessageContent message={selected}/></div>
                {selected?.attachments?.length > 0 && (
                  <section className="glondia-mail__received-attachments" aria-label="Message attachments">
                    <div className="glondia-mail__attachment-heading">
                      <strong>Attachments</strong>
                      <span>{selected.attachments.length} file{selected.attachments.length === 1 ? '' : 's'}</span>
                      {selected.attachments.length > 1 && <button type="button" onClick={() => selected.attachments.forEach((attachment, index) => window.setTimeout(() => { const link = document.createElement('a'); link.href = getMailAttachmentUrl(selected.id, attachment.id, true); link.download = attachment.filename || 'attachment'; link.click(); }, index * 180))}>Download all</button>}
                    </div>
                    <div className="glondia-mail__attachment-grid">
                      {selected.attachments.map((attachment) => (
                        <div className="glondia-mail__received-attachment" key={attachment.id}>
                          {attachment.contentType?.startsWith('image/') ? (
                            <button type="button" className="glondia-mail__attachment-thumb" onClick={() => setAttachmentPreview(attachment)} aria-label={`Preview ${attachment.filename}`}>
                              <img src={getMailAttachmentUrl(selected.id, attachment.id)} alt="" />
                            </button>
                          ) : (
                            <div className="glondia-mail__attachment-type"><ICN.File size={20}/></div>
                          )}
                          <div className="glondia-mail__attachment-copy">
                            <strong title={attachment.filename}>{attachment.filename || 'Attachment'}</strong>
                            <span>{attachment.contentType || 'File'} · {formatFileSize(attachment.sizeBytes)}</span>
                          </div>
                          <div className="glondia-mail__attachment-actions">
                            {(attachment.contentType?.startsWith('image/') || attachment.contentType === 'application/pdf' || attachment.contentType?.startsWith('text/')) && (
                              <button type="button" onClick={() => setAttachmentPreview(attachment)}>Preview</button>
                            )}
                            <a href={getMailAttachmentUrl(selected.id, attachment.id, true)}>Download</a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                <footer className="glondia-mail__message-footer">
                  <button type="button" style={M.btnGhost} onClick={() => startCompose('reply')}><ICN.ArrowLeft size={14}/> Reply</button>
                  <button type="button" style={M.btnGhost} onClick={() => startCompose('forward')}><ICN.ArrowRight size={14}/> Forward</button>
                </footer>
              </div>
            </article>
          ) : null}
        </section>
      </div>

      {undoMove && <div className="glondia-mail__undo-toast" role="status"><span>Message moved to Trash.</span><button type="button" onClick={async () => { try { await moveMailMessage(undoMove.message.id, undoMove.folderRole); setMessages((current) => [undoMove.message, ...current]); setUndoMove(null); } catch (error) { setReaderError(error?.message || 'Could not restore message.'); } }}>Undo</button><button type="button" aria-label="Dismiss" onClick={() => setUndoMove(null)}><ICN.X size={14}/></button></div>}

      {composeOpen && (
        <ComposeEditor
          from={session.mailbox}
          initial={composeSeed}
          onClose={() => { setComposeOpen(false); setComposeSeed(null); }}
          previewMode={previewMode || session.configured === false}
        />
      )}

      {attachmentPreview && selected?.id && (
        <div className="mail-attachment-preview" role="dialog" aria-modal="true" aria-label={`Preview ${attachmentPreview.filename}`} onClick={() => setAttachmentPreview(null)}>
          <div className="mail-attachment-preview__card" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong>{attachmentPreview.filename}</strong>
                <span>{attachmentPreview.contentType} · {formatFileSize(attachmentPreview.sizeBytes)}</span>
              </div>
              <div>
                <a href={getMailAttachmentUrl(selected.id, attachmentPreview.id, true)}>Download</a>
                {selected.attachments?.length > 1 && <>
                  <button type="button" onClick={() => { const index = selected.attachments.findIndex((item) => item.id === attachmentPreview.id); setAttachmentPreview(selected.attachments[(index - 1 + selected.attachments.length) % selected.attachments.length]); }} aria-label="Previous attachment"><ICN.ArrowLeft size={16}/></button>
                  <button type="button" onClick={() => { const index = selected.attachments.findIndex((item) => item.id === attachmentPreview.id); setAttachmentPreview(selected.attachments[(index + 1) % selected.attachments.length]); }} aria-label="Next attachment"><ICN.ArrowRight size={16}/></button>
                </>}
                <button type="button" autoFocus onClick={() => setAttachmentPreview(null)} aria-label="Close attachment preview"><ICN.X size={18}/></button>
              </div>
            </header>
            <div className="mail-attachment-preview__body">
              {attachmentPreview.contentType?.startsWith('image/') ? (
                <img src={getMailAttachmentUrl(selected.id, attachmentPreview.id)} alt={attachmentPreview.filename} />
              ) : (
                <iframe src={getMailAttachmentUrl(selected.id, attachmentPreview.id)} title={attachmentPreview.filename} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MailboxLogin({ session, onSuccess }) {
  const [email, setEmail] = useState(() => {
    const mailbox = new URLSearchParams(window.location.search).get('mailbox');
    return String(mailbox || '').trim().toLowerCase();
  });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [focus, setFocus] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    const mailbox = email.trim().toLowerCase();
    try {
      await loginMail({ email: mailbox, password });
      setPassword('');
      await onSuccess(mailbox, { preview: false });
    } catch (error) {
      setPassword('');
      const code = error?.code || error?.body?.error?.code || '';
      const msg = error?.message || '';
      // Allow clean UI entry when IMAP is not live yet — never keep the password.
      if (
        code === 'GLONDIA_MAIL_NOT_CONFIGURED'
        || code === 'GLONDIA_MAIL_LOGIN_PENDING'
        || /being prepared|not configured|not enabled|IMAP/i.test(msg)
        || error?.status === 503
      ) {
        if (!mailbox.includes('@')) {
          setErr('Enter a valid mailbox address (you@yourdomain.com).');
        } else {
          await onSuccess(mailbox, { preview: true });
        }
      } else {
        setErr(msg || 'Could not sign in to this mailbox.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mailbox-signin">
      <section className="mailbox-signin__visual">
        <div className="mailbox-signin__shade" />
        <button type="button" className="mailbox-signin__back" onClick={() => { window.location.href = '/'; }}>
          <ICN.ArrowLeft size={16} /> Glondia
        </button>
        <div className="mailbox-signin__brand"><span><ICN.Mail size={23} /></span>GLONDIA MAIL</div>
        <div className="mailbox-signin__message">
          <span className="mailbox-signin__kicker">Business email, beautifully simple</span>
          <h2>Stay connected.<br />Keep work moving.</h2>
          <p>A focused, private mailbox for the conversations that move your business forward.</p>
          <div className="mailbox-signin__proof">
            <span><ICN.ShieldCheck size={15} /> Secure mailbox access</span>
            <span><ICN.Mail size={15} /> Your domain, your identity</span>
          </div>
        </div>
      </section>

      <section className="mailbox-signin__panel">
        <form onSubmit={onSubmit}>
          <div className="mailbox-signin__heading">
            <img src="/glondia-logo.png" alt="Glondia" />
            <div><span className="mailbox-signin__eyebrow">Business mailbox</span><h1>Welcome back</h1><p>Sign in to continue to your Glondia mailbox.</p></div>
          </div>

          {session?.configured === false && (
            <div className="mailbox-signin__notice">
              Mail hosting is still being prepared. You can sign in to open the interface; live send/receive starts when the server connection is ready.
            </div>
          )}

          <div className="mailbox-signin__fields">
            <label htmlFor="mbx-email"><span>Email address</span>
              <input
                id="mbx-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setFocus('email')}
                onBlur={() => setFocus('')}
                placeholder="you@yourdomain.com"
                data-focused={focus === 'email'}
              />
            </label>
            <label htmlFor="mbx-pass"><span>Mailbox password</span>
              <input
                id="mbx-pass"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocus('pass')}
                onBlur={() => setFocus('')}
                placeholder="••••••••"
                data-focused={focus === 'pass'}
              />
            </label>
          </div>

          {err && <div className="mailbox-signin__error">{err}</div>}

          <button type="submit" disabled={busy} className="mailbox-signin__submit">
            {busy ? 'Signing in…' : 'Open mailbox'}{!busy && <ICN.ArrowRight size={16} />}
          </button>
          <div className="mailbox-signin__security"><ICN.ShieldCheck size={17} /><p><strong>Protected access</strong><span>Your password is used only to securely connect you to GlondiaMail.</span></p></div>

          <div className="mailbox-signin__footer">
            Need a mailbox?{' '}
            <a href="/">Set up Business Email in Glondia</a>
          </div>
        </form>
      </section>
    </div>
  );
}

function ComposeModal({ from, onClose, previewMode }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');

  return (
    <div style={M.modalBackdrop} onClick={onClose}>
      <div style={M.modal} onClick={(e) => e.stopPropagation()}>
        <div style={M.modalHead}>
          <strong style={{ color: '#111827' }}>New message</strong>
          <button type="button" style={M.btnGhost} onClick={onClose}>Close</button>
        </div>
        <div style={{ padding: 18, display: 'grid', gap: 12 }}>
          <div>
            <div style={M.label}>From</div>
            <div style={{ ...M.input, color: '#6c757d', background: '#f8faf9' }}>{from}</div>
          </div>
          <div>
            <label style={M.label} htmlFor="c-to">To</label>
            <input id="c-to" style={M.input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" />
          </div>
          <div>
            <label style={M.label} htmlFor="c-sub">Subject</label>
            <input id="c-sub" style={M.input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          </div>
          <div>
            <label style={M.label} htmlFor="c-body">Message</label>
            <textarea
              id="c-body"
              rows={8}
              style={{ ...M.input, resize: 'vertical', minHeight: 140 }}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message…"
            />
          </div>
          {msg && <div style={{ color: '#146c43', fontSize: 13 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={M.btnGhost} onClick={onClose}>Discard</button>
            <button
              type="button"
              style={M.btnPrimary}
              onClick={() => {
                if (previewMode) {
                  setMsg('Sending will be available when mail hosting is connected. Nothing was sent.');
                  return;
                }
                setMsg('SMTP send is not enabled yet. Nothing was sent.');
              }}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposeEditor({ from, onClose, previewMode, initial = null }) {
  const [to, setTo] = useState(initial?.to || '');
  const [cc, setCc] = useState(initial?.cc || '');
  const [ccOpen, setCcOpen] = useState(Boolean(initial?.cc));
  const [bccOpen, setBccOpen] = useState(false);
  const [subject, setSubject] = useState(initial?.subject || '');
  const [body, setBody] = useState(initial?.body || '');
  const [msg, setMsg] = useState('');
  const [fontFamily, setFontFamily] = useState('Inter');
  const [fontSize, setFontSize] = useState('15');
  const [attachments, setAttachments] = useState([]);
  const attachmentInput = useRef(null);

  const attemptSend = () => {
    setMsg(previewMode
      ? 'Sending will be available when mail hosting is connected. Nothing was sent.'
      : 'SMTP send is not enabled yet. Nothing was sent.');
  };

  return (
    <div style={M.modalBackdrop} className="mail-compose-backdrop" onClick={onClose}>
      <div style={M.modal} className="mail-compose" role="dialog" aria-modal="true" aria-labelledby="compose-title" onClick={(event) => event.stopPropagation()}>
        <div style={M.modalHead} className="mail-compose__head">
          <div className="mail-compose__draft">
            <span className="mail-compose__draft-icon"><ICN.File size={17}/></span>
            <strong id="compose-title">{initial?.kind === 'forward' ? 'Forward message' : initial?.kind ? 'Reply' : 'Personal draft'}</strong>
            <span>Only visible to you</span>
          </div>
          <div className="mail-compose__head-actions">
            <button type="button" className="mail-compose__share">Share draft</button>
            <button type="button" className="mail-compose__icon-btn" aria-label="Open composer in a new window"><ICN.ExternalLink size={18}/></button>
            <button type="button" className="mail-compose__icon-btn" aria-label="Close composer" onClick={onClose}><ICN.X size={20}/></button>
          </div>
        </div>

        <div className="mail-compose__fields">
          <div className="mail-compose__row">
            <span>From:</span>
            <strong>{from}</strong>
          </div>
          <div className="mail-compose__row mail-compose__recipient">
            <label htmlFor="c-to">To:</label>
            <input id="c-to" value={to} onChange={(event) => setTo(event.target.value)} autoFocus />
            <div className="mail-compose__recipient-actions">
              <button type="button" onClick={() => setCcOpen((value) => !value)}>Cc</button>
              <button type="button" onClick={() => setBccOpen((value) => !value)}>Bcc</button>
            </div>
          </div>
          {ccOpen && <div className="mail-compose__row mail-compose__recipient"><label htmlFor="c-cc">Cc:</label><input id="c-cc" value={cc} onChange={(event) => setCc(event.target.value)} /></div>}
          {bccOpen && <div className="mail-compose__row mail-compose__recipient"><label htmlFor="c-bcc">Bcc:</label><input id="c-bcc" /></div>}
          <div className="mail-compose__subject">
            <label htmlFor="c-sub">Subject:</label>
            <input id="c-sub" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
        </div>

        <div className="mail-compose__editor">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Type / to insert a message template"
            aria-label="Message"
            style={{ fontFamily: `"${fontFamily}", sans-serif`, fontSize: `${fontSize}px` }}
          />
          <div className="mail-compose__signature">
            <span>—</span>
            <strong>{String(from || '').split('@')[0] || 'Glondia Mail'}</strong>
            <small>Sent from <b>Glondia Mail</b></small>
          </div>
        </div>

        {attachments.length > 0 && (
          <div className="mail-compose__attachments" aria-label="Attachments">
            {attachments.map((file, index) => (
              <div className="mail-compose__attachment" key={`${file.name}-${file.lastModified}-${index}`}>
                <ICN.Paperclip size={14}/>
                <span title={file.name}>{file.name}</span>
                <small>{formatFileSize(file.size)}</small>
                <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <ICN.X size={13}/>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mail-compose__formatbar" aria-label="Message formatting">
          <label className="mail-compose__select">
            <span className="sr-only">Font family</span>
            <select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}>
              <option value="Inter">Inter</option>
              <option value="Roboto">Roboto</option>
              <option value="Lora">Lora</option>
              <option value="Source Serif 4">Source Serif</option>
            </select>
          </label>
          <label className="mail-compose__select mail-compose__select--size">
            <span className="sr-only">Font size</span>
            <select value={fontSize} onChange={(event) => setFontSize(event.target.value)}>
              <option value="13">13</option>
              <option value="14">14</option>
              <option value="15">15</option>
              <option value="16">16</option>
              <option value="18">18</option>
              <option value="20">20</option>
            </select>
          </label>
          <button type="button" aria-label="Text color"><u>A</u></button>
          <button type="button" aria-label="Bold"><b>B</b></button>
          <button type="button" aria-label="Italic"><i>I</i></button>
          <button type="button" aria-label="Underline"><u>U</u></button>
          <button type="button" aria-label="Strikethrough"><s>S</s></button>
          <button type="button" aria-label="Bulleted list">☷</button>
          <button type="button" aria-label="Insert link">⌁</button>
          <button type="button" aria-label="Insert image"><ICN.Image size={19}/></button>
          <button type="button" aria-label="Clear formatting">Tₓ</button>
        </div>

        <div className="mail-compose__footer">
          <div className="mail-compose__tools">
            <button type="button" aria-label="Formatting options">Aa</button>
            <button type="button" aria-label="Insert emoji">☺</button>
            <input
              ref={attachmentInput}
              className="mail-compose__file-input"
              type="file"
              multiple
              onChange={(event) => {
                const selectedFiles = Array.from(event.target.files || []);
                setAttachments((current) => [...current, ...selectedFiles]);
                event.target.value = '';
              }}
            />
            <button type="button" aria-label="Attach file" onClick={() => attachmentInput.current?.click()}><ICN.Paperclip size={19}/></button>
            <button type="button" aria-label="Discard draft" onClick={onClose}><ICN.Trash size={19}/></button>
          </div>
          <div className="mail-compose__send-wrap">
            {msg && <span className="mail-compose__message">{msg}</span>}
            <button type="button" className="mail-compose__send" onClick={attemptSend} aria-disabled="true" title="SMTP transport is not enabled">Send unavailable <span>⌄</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value, long = false) {
  if (!value) return '';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    if (long) return d.toLocaleString();
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

const sans = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif";

// ── Login styles (match dashboard auth pages) ────────────────────────────────
const S = {
  page: {
    minHeight: '100vh',
    background: '#050706',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: sans,
    backgroundImage: 'radial-gradient(ellipse 70% 45% at 50% -5%, rgba(62,207,142,0.09), transparent 55%)',
    padding: 24,
    position: 'relative',
  },
  back: {
    position: 'absolute',
    top: 24,
    left: 28,
    fontFamily: sans,
    fontSize: 13.5,
    fontWeight: 500,
    color: '#9a9f98',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  box: {
    width: '100%',
    maxWidth: 440,
    border: '1px solid #1a221c',
    borderRadius: 16,
    overflow: 'hidden',
    background: '#0b0f0c',
    boxShadow: '0 28px 80px rgba(0,0,0,0.55)',
  },
  head: {
    borderBottom: '1px solid #1a221c',
    background: '#0e1310',
    padding: '14px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  headBrand: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: 'rgba(62,207,142,0.14)',
    color: '#3ecf8e',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBar: { fontSize: 13, fontWeight: 600, color: '#f2f0e8' },
  body: { padding: '32px 28px 28px' },
  eyebrow: {
    fontSize: 11,
    fontWeight: 600,
    color: '#3ecf8e',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    marginBottom: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  pulse: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#3ecf8e',
    boxShadow: '0 0 8px #3ecf8e',
  },
  h1: {
    fontSize: 24,
    fontWeight: 700,
    color: '#f2f0e8',
    letterSpacing: '-0.02em',
    margin: '0 0 6px',
  },
  sub: {
    fontSize: 14,
    color: '#9a9f98',
    marginBottom: 22,
    lineHeight: 1.55,
  },
  notice: {
    fontSize: 12.5,
    color: '#9a9f98',
    border: '1px solid #1a221c',
    borderRadius: 10,
    background: '#0e1310',
    padding: '10px 12px',
    marginBottom: 18,
    lineHeight: 1.5,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: '#9a9f98',
    marginBottom: 6,
  },
  input: (focused) => ({
    width: '100%',
    background: '#050706',
    border: `1px solid ${focused ? '#3ecf8e' : '#2a362e'}`,
    borderRadius: 10,
    color: '#f2f0e8',
    fontFamily: sans,
    fontSize: 14,
    padding: '11px 14px',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
    boxShadow: focused ? '0 0 0 3px rgba(62,207,142,0.14)' : 'none',
  }),
  fieldWrap: { marginBottom: 16 },
  btn: (disabled) => ({
    width: '100%',
    background: 'linear-gradient(180deg, #6ee7b0, #3ecf8e)',
    color: '#04140c',
    border: 'none',
    borderRadius: 10,
    fontFamily: sans,
    fontSize: 14.5,
    fontWeight: 700,
    padding: '13px 20px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    marginTop: 8,
    opacity: disabled ? 0.55 : 1,
    boxShadow: '0 6px 20px rgba(62,207,142,0.25)',
  }),
  error: { color: '#ff8a8a', fontSize: 13, marginBottom: 8 },
  footer: { marginTop: 20, fontSize: 13, color: '#9a9f98', textAlign: 'center' },
  footerLink: { color: '#3ecf8e', textDecoration: 'none', fontWeight: 600 },
  linkBack: { color: '#3ecf8e', fontSize: 13.5, textDecoration: 'none', fontWeight: 600 },
};

// ── Mail shell styles (match client dashboard theme) ─────────────────────────
const M = {
  shell: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: '#f8faf9',
    color: '#111827',
    fontFamily: sans,
  },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '10px 16px',
    borderBottom: '1px solid #dfe7e2',
    background: '#ffffff',
    flexWrap: 'wrap',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 160 },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: '#d8f3dc',
    color: '#198754',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: { fontWeight: 700, fontSize: 15, color: '#111827' },
  brandSub: { fontSize: 11, color: '#6c757d' },
  searchWrap: {
    flex: 1,
    minWidth: 180,
    maxWidth: 420,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: '#f8faf9',
    border: '1px solid #dfe7e2',
    borderRadius: 10,
    padding: '8px 12px',
  },
  search: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#111827',
    fontFamily: sans,
    fontSize: 14,
  },
  topActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#198754',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    fontFamily: sans,
    fontSize: 13.5,
    fontWeight: 600,
    padding: '8px 14px',
    cursor: 'pointer',
  },
  btnGhost: {
    background: '#ffffff',
    border: '1px solid #dfe7e2',
    borderRadius: 8,
    color: '#374151',
    fontFamily: sans,
    fontSize: 13.5,
    fontWeight: 500,
    padding: '7px 12px',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  userChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid #dfe7e2',
    borderRadius: 999,
    padding: '4px 12px 4px 4px',
    background: '#ffffff',
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: '#d8f3dc',
    color: '#146c43',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
  },
  avatarLg: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: '#d8f3dc',
    color: '#146c43',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    fontWeight: 700,
    flexShrink: 0,
  },
  userEmail: { fontSize: 12.5, color: '#374151', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    background: '#eef8f1',
    borderBottom: '1px solid #dfe7e2',
    color: '#146c43',
    fontSize: 13,
  },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  sidebar: {
    width: 224,
    borderRight: '1px solid #dfe7e2',
    background: '#ffffff',
    padding: '22px 14px 14px',
    display: 'flex',
    flexDirection: 'column',
  },
  sidebarTitle: { fontSize: 23, fontWeight: 750, color: '#111827', letterSpacing: '-.03em', padding: '0 8px 18px' },
  composeSide: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: '#198754',
    color: '#ffffff',
    border: 'none',
    borderRadius: 12,
    fontFamily: sans,
    fontWeight: 600,
    fontSize: 13.5,
    padding: '11px 12px',
    cursor: 'pointer',
  },
  folderBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'transparent',
    border: 'none',
    color: '#4b5563',
    fontFamily: sans,
    fontSize: 14,
    fontWeight: 500,
    padding: '10px 11px',
    cursor: 'pointer',
    textAlign: 'left',
    borderRadius: 8,
  },
  folderBtnActive: {
    background: '#e4f5e9',
    color: '#146c43',
    fontWeight: 600,
  },
  folderCount: { marginLeft: 'auto', minWidth: 22, height: 22, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#198754', color: '#fff', fontSize: 11, fontWeight: 700 },
  folderSectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '30px 10px 8px', color: '#111827', fontSize: 13, fontWeight: 700 },
  sideFoot: { marginTop: 'auto', paddingTop: 16 },
  sideLink: { color: '#6c757d', fontSize: 12.5, textDecoration: 'none' },
  listPane: {
    width: 390,
    maxWidth: '40vw',
    borderRight: '1px solid #dfe7e2',
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
    minWidth: 310,
  },
  listHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    padding: '22px 18px 12px',
    borderBottom: 'none',
  },
  listTitle: { margin: 0, fontSize: 24, fontWeight: 750, color: '#111827', letterSpacing: '-.03em' },
  listCount: { fontSize: 12, color: '#6c757d' },
  roundCompose: { width: 38, height: 38, borderRadius: '50%', border: 'none', background: '#198754', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 7px 18px rgba(25,135,84,.2)' },
  listTools: { padding: '0 16px 14px', borderBottom: '1px solid #e6ece8', display: 'grid', gap: 10 },
  filterTabs: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: 4, borderRadius: 12, background: '#f3f6f4' },
  filterBtn: { border: 0, borderRadius: 9, padding: '8px 10px', background: 'transparent', color: '#6b7280', fontFamily: sans, fontSize: 12.5, fontWeight: 650, cursor: 'pointer' },
  filterBtnActive: { background: '#111827', color: '#fff', boxShadow: '0 4px 12px rgba(17,24,39,.12)' },
  listScroll: { overflow: 'auto', flex: 1 },
  msgRow: {
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #eef2ef',
    padding: '15px 17px',
    cursor: 'pointer',
    fontFamily: sans,
    display: 'grid',
    gap: 5,
  },
  msgRowActive: {
    background: '#edf8f1',
    boxShadow: 'inset 3px 0 0 #198754',
  },
  msgTop: { display: 'grid', gridTemplateColumns: '8px minmax(0,1fr) auto', alignItems: 'center', gap: 8 },
  unreadDot: { width: 7, height: 7, borderRadius: '50%', background: '#20c777' },
  msgFrom: { fontSize: 13.5, color: '#111827', fontWeight: 600 },
  msgSubject: { fontSize: 13, color: '#252b36', fontWeight: 600, paddingLeft: 16, display: 'flex', alignItems: 'center', gap: 5 },
  msgPreview: { fontSize: 12.5, color: '#7a818c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 16 },
  msgDate: { fontSize: 11.5, color: '#9ca3af', marginTop: 2 },
  readPane: { flex: 1, minWidth: 0, background: '#ffffff', overflow: 'auto' },
  emptyList: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 4,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: '#d8f3dc',
    color: '#198754',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  reader: { padding: '0 34px 40px', maxWidth: 900 },
  readToolbar: { minHeight: 64, margin: '0 -34px 26px', padding: '0 28px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid #e6ece8', background: '#fbfcfb' },
  actionBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, background: 'transparent', color: '#374151', fontFamily: sans, fontSize: 12.5, fontWeight: 600, padding: '8px 9px', borderRadius: 8, cursor: 'pointer' },
  readSubject: {
    margin: '0 0 18px',
    fontSize: 22,
    fontWeight: 700,
    color: '#111827',
    letterSpacing: '-0.02em',
    lineHeight: 1.3,
  },
  readMeta: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 },
  readBody: {
    color: '#374151',
    fontSize: 14.5,
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
    borderTop: '1px solid #dfe7e2',
    paddingTop: 20,
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 500,
    background: 'rgba(5,8,7,.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    width: 'min(560px, 100%)',
    background: '#ffffff',
    border: '1px solid #dfe7e2',
    borderRadius: 14,
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(5,8,7,.25)',
  },
  modalHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #dfe7e2',
    background: '#f8faf9',
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    background: '#ffffff',
    border: '1px solid #dfe7e2',
    borderRadius: 8,
    color: '#111827',
    fontFamily: sans,
    fontSize: 14,
    padding: '10px 12px',
    outline: 'none',
    boxSizing: 'border-box',
  },
};
