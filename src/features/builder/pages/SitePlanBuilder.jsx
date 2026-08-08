// SitePlanBuilder.jsx — Hybrid Site Plan Builder
// Ported from sitemap/wireframe builder source files into React.
import React, { useState, useCallback, useRef, useEffect } from 'react';
import './SitePlanBuilder.css';
import {
  createSiteFromTailoredTemplate,
  createTemplateSitePlan,
  updateTemplateSitePlanPart,
  approveTemplateSitePlan,
  handoffTemplateSitePlan,
  aiSuggestSitemapForPlan,
  aiAutofillOptionalBrief,
  aiSuggestSectionsForPage,
  aiSuggestWireframe,
  getTemplateHostingTemplate,
} from '../../../api/template-ai.js';

// ─── isAiDisabledError ───────────────────────────────────────────────────────
// Detects when the server has AI_BUILDER disabled (feature flag gate)
function isAiDisabledError(e) {
  const msg = String(e?.message || e?.code || '').toUpperCase();
  return msg.includes('FEATURE_COMING_SOON') || msg.includes('AI_BUILDER') || e?.status === 403;
}

// ─── uid ────────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

// ─── suggestSitemapFromBrief ─────────────────────────────────────────────────
function suggestSitemapFromBrief(brief) {
  const industry = (brief.industry || '').toLowerCase();
  let pages;

  if (industry.includes('restaurant') || industry.includes('café') || industry.includes('cafe') || industry.includes('hospitality')) {
    pages = [
      { name: 'Home', path: '/', sections: [{ title: 'Hero', type: 'hero', description: 'Welcome banner with photo and booking CTA.' }, { title: 'Menu Highlights', type: 'services', description: 'Popular dishes and specials.' }, { title: 'Book a Table', type: 'cta', description: 'Reservation call-to-action.' }] },
      { name: 'Menu', path: '/menu', sections: [{ title: 'Full Menu', type: 'services', description: 'Complete food and drinks menu.' }] },
      { name: 'Gallery', path: '/gallery', sections: [{ title: 'Photo Gallery', type: 'gallery', description: 'Photos of the venue and food.' }] },
      { name: 'Contact', path: '/contact', sections: [{ title: 'Contact & Booking', type: 'form', description: 'Reservation form and contact details.' }] },
    ];
  } else if (industry.includes('construction') || industry.includes('builder') || industry.includes('trade')) {
    pages = [
      { name: 'Home', path: '/', sections: [{ title: 'Hero', type: 'hero', description: 'Bold headline, services summary, CTA.' }, { title: 'Services', type: 'services', description: 'Main trade services offered.' }, { title: 'Why Us', type: 'about', description: 'Experience, licenses, and results.' }] },
      { name: 'Services', path: '/services', sections: [{ title: 'Service Details', type: 'services', description: 'Detailed list of services.' }, { title: 'Process', type: 'process', description: 'How the job gets done step by step.' }] },
      { name: 'Projects', path: '/projects', sections: [{ title: 'Past Projects', type: 'gallery', description: 'Photos and descriptions of completed work.' }] },
      { name: 'Contact', path: '/contact', sections: [{ title: 'Quote Request', type: 'form', description: 'Get a free quote form.' }, { title: 'Contact Details', type: 'details', description: 'Phone, email, area served.' }] },
    ];
  } else if (industry.includes('consult') || industry.includes('professional') || industry.includes('law') || industry.includes('account')) {
    pages = [
      { name: 'Home', path: '/', sections: [{ title: 'Hero', type: 'hero', description: 'Credibility-first headline and CTA.' }, { title: 'Services', type: 'services', description: 'Core consulting services.' }, { title: 'Why Work With Us', type: 'about', description: 'Credentials, experience, outcomes.' }] },
      { name: 'Services', path: '/services', sections: [{ title: 'Service Packages', type: 'services', description: 'Detailed service offerings.' }, { title: 'Process', type: 'process', description: 'How we work with clients.' }] },
      { name: 'About', path: '/about', sections: [{ title: 'Our Team', type: 'about', description: 'Team bios and credentials.' }] },
      { name: 'Contact', path: '/contact', sections: [{ title: 'Get In Touch', type: 'form', description: 'Contact and enquiry form.' }, { title: 'Office Details', type: 'details', description: 'Address, phone, email.' }] },
    ];
  } else {
    pages = [
      { name: 'Home', path: '/', sections: [{ title: 'Hero', type: 'hero', description: 'Main headline, value statement, CTA.' }, { title: 'Services', type: 'services', description: 'Overview of main services or products.' }, { title: 'Why Choose Us', type: 'about', description: 'Trust points and key benefits.' }, { title: 'Call To Action', type: 'cta', description: 'Encourage visitors to get in touch.' }] },
      { name: 'Services', path: '/services', sections: [{ title: 'Service List', type: 'services', description: 'Detailed service cards.' }, { title: 'Process', type: 'process', description: 'Step-by-step how you work.' }] },
      { name: 'About', path: '/about', sections: [{ title: 'Our Story', type: 'about', description: 'Background, mission, and team.' }] },
      { name: 'Contact', path: '/contact', sections: [{ title: 'Contact Form', type: 'form', description: 'Name, email, phone, message.' }, { title: 'Business Details', type: 'details', description: 'Address, email, opening hours.' }] },
    ];
  }

  return pages.map(p => ({ ...p, id: uid(), sections: p.sections.map(s => ({ ...s, id: uid() })) }));
}

// ─── Style presets ───────────────────────────────────────────────────────────
const STYLE_PRESETS = [
  { id: 'clean', label: 'Clean Pro', colors: { background: '#ffffff', surface: '#f8fafc', text: '#0f172a', muted: '#64748b', accent: '#198754', line: '#e2e8f0' }, headingFont: 'Hanken Grotesk', bodyFont: 'Hanken Grotesk', radius: 12, space: 1 },
  { id: 'swiss', label: 'Swiss Mono', colors: { background: '#fafafa', surface: '#f0f0f0', text: '#111111', muted: '#666666', accent: '#1a1a1a', line: '#e0e0e0' }, headingFont: 'Space Grotesk', bodyFont: 'Space Grotesk', radius: 0, space: 1.2 },
  { id: 'editorial', label: 'Editorial', colors: { background: '#fffdf7', surface: '#fdf8ed', text: '#1a1209', muted: '#8a7a5a', accent: '#c0392b', line: '#e8dfc8' }, headingFont: 'DM Serif Display', bodyFont: 'Lora', radius: 4, space: 1.1 },
  { id: 'dark', label: 'Premium Dark', colors: { background: '#0d0d0d', surface: '#1a1a1a', text: '#f0f0f0', muted: '#888888', accent: '#7c6af7', line: '#2a2a2a' }, headingFont: 'Sora', bodyFont: 'Hanken Grotesk', radius: 16, space: 1 },
  { id: 'warm', label: 'Warm Local', colors: { background: '#fef9f3', surface: '#fdf0e0', text: '#2d1a0e', muted: '#9a7a5e', accent: '#c96a1a', line: '#ead4b4' }, headingFont: 'DM Serif Display', bodyFont: 'Hanken Grotesk', radius: 8, space: 1 },
  { id: 'mint', label: 'Tech Mint', colors: { background: '#f0faf5', surface: '#e0f5ea', text: '#0a2018', muted: '#5a8a70', accent: '#0ea85a', line: '#b4e4cc' }, headingFont: 'Space Grotesk', bodyFont: 'Hanken Grotesk', radius: 20, space: 1 },
];

const FONT_OPTIONS = ['Hanken Grotesk', 'Sora', 'Space Grotesk', 'DM Serif Display', 'Lora'];

const SECTION_TYPES = ['hero', 'services', 'about', 'cta', 'gallery', 'form', 'details', 'process', 'faq', 'pricing', 'team', 'features'];

const TABS = [
  { key: 'brief', label: 'Client Brief', num: 1 },
  { key: 'sitemap', label: 'Sitemap', num: 2 },
  { key: 'wireframe', label: 'Wireframe', num: 3 },
  { key: 'style', label: 'Style', num: 4 },
  { key: 'review', label: 'Review', num: 5 },
];

// ─── Wireframe section renderer ───────────────────────────────────────────────
function getSectionType(type = '') {
  const t = String(type || '').toLowerCase();
  if (t === 'hero') return 'hero';
  if (['services', 'features', 'cards', 'pricing', 'team'].includes(t)) return 'cards';
  if (t === 'gallery') return 'gallery';
  if (['form', 'contact', 'enquiry', 'enquir'].some(k => t.includes(k))) return 'form';
  if (t === 'faq') return 'faq';
  if (t === 'cta') return 'cta';
  return 'split';
}

// ─── Wireframe building blocks ────────────────────────────────────────────────
const WF_TYPE_COLORS = {
  hero: '#3b82f6', services: '#10b981', features: '#10b981', cards: '#10b981',
  pricing: '#8b5cf6', team: '#8b5cf6', gallery: '#a855f7', form: '#f59e0b',
  contact: '#f59e0b', faq: '#06b6d4', cta: '#f43f5e', about: '#64748b',
  process: '#64748b', details: '#64748b', default: '#94a3b8',
};
function wfColor(type) { return WF_TYPE_COLORS[type?.toLowerCase()] || WF_TYPE_COLORS.default; }

function WfImg({ label = 'Image / Media', className = '', style = {} }) {
  return (
    <div className={`spb-wfb-img ${className}`} style={style}>
      <svg viewBox="0 0 4 3" preserveAspectRatio="none" aria-hidden="true" className="spb-wfb-img-x">
        <line x1="0" y1="0" x2="4" y2="3" stroke="#b0bec5" strokeWidth="0.12"/>
        <line x1="4" y1="0" x2="0" y2="3" stroke="#b0bec5" strokeWidth="0.12"/>
      </svg>
      <span className="spb-wfb-img-label">{label}</span>
    </div>
  );
}

function WfH1({ children }) { return <div className="spb-wfb-h1">{children}</div>; }
function WfH2({ children }) { return <div className="spb-wfb-h2">{children}</div>; }
function WfH3({ children }) { return <div className="spb-wfb-h3">{children}</div>; }
function WfP({ children = 'Supporting body copy — brief description of value proposition and what visitors need to know.' }) {
  return <p className="spb-wfb-p">{children}</p>;
}
function WfBtn({ label = 'Button', outline = false }) {
  return <div className={`spb-wfb-btn${outline ? ' spb-wfb-btn--outline' : ''}`}>{label}</div>;
}
function WfInputField({ label }) {
  return (
    <div className="spb-wfb-field">
      <div className="spb-wfb-field-label">{label}</div>
      <div className="spb-wfb-field-input" />
    </div>
  );
}
function WfTextareaField({ label = 'Message' }) {
  return (
    <div className="spb-wfb-field">
      <div className="spb-wfb-field-label">{label}</div>
      <div className="spb-wfb-field-textarea" />
    </div>
  );
}

// ─── Section layout components ────────────────────────────────────────────────
function WfLayoutHero() {
  return (
    <div className="spb-wfl-hero">
      <div className="spb-wfl-hero-text">
        <WfH1>H1 — Main Headline Goes Here</WfH1>
        <WfH2>H2 — Supporting subheadline</WfH2>
        <WfP />
        <div className="spb-wfl-btns">
          <WfBtn label="Primary CTA" />
          <WfBtn label="Learn More" outline />
        </div>
      </div>
      <WfImg className="spb-wfl-hero-img" label="Hero Image / Banner" />
    </div>
  );
}

function WfLayoutCards() {
  return (
    <>
      <div className="spb-wfl-intro">
        <WfH2>Section Heading</WfH2>
        <WfP>Brief section description — context for what visitors will see in this section.</WfP>
      </div>
      <div className="spb-wfl-cards">
        {['Item One', 'Item Two', 'Item Three'].map((label, i) => (
          <div key={i} className="spb-wfl-card">
            <div className="spb-wfl-card-icon">[ Icon ]</div>
            <WfH3>{label}</WfH3>
            <WfP>Short description for this card item or service offering.</WfP>
          </div>
        ))}
      </div>
    </>
  );
}

function WfLayoutGallery() {
  return (
    <div className="spb-wfl-gallery">
      {[0,1,2,3,4,5].map(i => <WfImg key={i} className="spb-wfl-gallery-cell" label="Photo" />)}
    </div>
  );
}

function WfLayoutForm() {
  return (
    <div className="spb-wfl-form">
      <div className="spb-wfl-form-2col">
        <WfInputField label="Full Name" />
        <WfInputField label="Email Address" />
      </div>
      <WfInputField label="Phone Number" />
      <WfInputField label="Subject" />
      <WfTextareaField label="Message" />
      <WfBtn label="Send Message" />
    </div>
  );
}

function WfLayoutFaq() {
  const items = [
    'What services do you offer?',
    'How do I get started with your team?',
    'What are the pricing options?',
    'How long does the process take?',
  ];
  return (
    <div className="spb-wfl-faq">
      {items.map((q, i) => (
        <div key={i} className="spb-wfl-faq-row">
          <span className="spb-wfl-faq-q">{q}</span>
          <span className="spb-wfl-faq-icon">›</span>
        </div>
      ))}
    </div>
  );
}

function WfLayoutCta() {
  return (
    <div className="spb-wfl-cta">
      <WfH2>Ready to get started?</WfH2>
      <WfP>Compelling call-to-action text that motivates the visitor to take the next step and get in touch.</WfP>
      <div className="spb-wfl-btns spb-wfl-btns--center">
        <WfBtn label="Get in Touch" />
        <WfBtn label="Learn More" outline />
      </div>
    </div>
  );
}

function WfLayoutSplit() {
  return (
    <div className="spb-wfl-split">
      <WfImg className="spb-wfl-split-img" label="Image / Photo" />
      <div className="spb-wfl-split-text">
        <WfH2>Section Heading</WfH2>
        <WfP />
        <WfP>Additional supporting text that provides more detail and context for this section's content.</WfP>
        <WfBtn label="Learn More" />
      </div>
    </div>
  );
}

const WF_LAYOUTS = {
  hero: <WfLayoutHero />,
  cards: <WfLayoutCards />,
  gallery: <WfLayoutGallery />,
  form: <WfLayoutForm />,
  faq: <WfLayoutFaq />,
  cta: <WfLayoutCta />,
  split: <WfLayoutSplit />,
};

// ─── WireSection ─────────────────────────────────────────────────────────────
function WireSection({ section, onEdit }) {
  const kind = getSectionType(section.type);
  const color = wfColor(section.type);
  return (
    <section className="spb-wfs" style={{ '--wfs-color': color }} data-type={section.type}>
      <header className="spb-wfs-header">
        <span className="spb-wfs-badge">{section.type}</span>
        <strong className="spb-wfs-title">{section.title}</strong>
        {section.description && <span className="spb-wfs-desc">{section.description}</span>}
        {onEdit && (
          <button className="spb-wfs-edit" onClick={() => onEdit(section)}>✎ Edit</button>
        )}
      </header>
      {section.contentHints && (
        <div className="spb-wfs-ai-hint">✦ {section.contentHints}</div>
      )}
      <div className="spb-wfs-body">
        {WF_LAYOUTS[kind] || WF_LAYOUTS.split}
      </div>
    </section>
  );
}

// ─── WirePage ─────────────────────────────────────────────────────────────────
function WirePage({ page, onEditSection }) {
  return (
    <div className="spb-wfp">
      {/* Browser chrome */}
      <div className="spb-wfp-chrome">
        <div className="spb-wfp-dots">
          <span className="spb-wfp-dot" style={{ background: '#ff5f57' }} />
          <span className="spb-wfp-dot" style={{ background: '#febc2e' }} />
          <span className="spb-wfp-dot" style={{ background: '#28c840' }} />
        </div>
        <div className="spb-wfp-urlbar">
          <span className="spb-wfp-lock">🔒</span>
          <span className="spb-wfp-url">{page.path === '/' ? 'yoursite.com' : `yoursite.com${page.path}`}</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="spb-wfp-nav">
        <div className="spb-wfp-nav-logo">[ Logo ]</div>
        <div className="spb-wfp-nav-links">
          {['Home', 'Services', 'About', 'Contact'].map(l => (
            <span key={l} className="spb-wfp-nav-link">{l}</span>
          ))}
        </div>
        <div className="spb-wfp-nav-cta">[ Get in Touch ]</div>
      </nav>

      {/* Page label strip */}
      <div className="spb-wfp-strip">
        <span className="spb-wfp-strip-name">{page.name}</span>
        <code className="spb-wfp-strip-path">{page.path}</code>
        {page.layoutNotes && <span className="spb-wfp-layout-note">✦ {page.layoutNotes}</span>}
      </div>

      {/* Sections */}
      {(page.sections || []).length === 0 ? (
        <div className="spb-wfp-empty">No sections yet — add them in the Sitemap tab.</div>
      ) : (
        (page.sections || []).map(s => (
          <WireSection
            key={s.id}
            section={s}
            onEdit={onEditSection ? sec => onEditSection(page.id, sec) : null}
          />
        ))
      )}

      {/* Footer */}
      <footer className="spb-wfp-footer">
        <div className="spb-wfp-footer-top">
          <div className="spb-wfp-footer-brand">
            <div className="spb-wfp-footer-logo">[ Company Name ]</div>
            <div className="spb-wfp-footer-tagline">Your tagline or short description here.</div>
          </div>
          {[
            ['Company', ['About Us', 'Services', 'Blog', 'Contact']],
            ['Services', ['Web Design', 'Development', 'Hosting', 'Support']],
            ['Connect', ['Facebook', 'Instagram', 'LinkedIn', 'Twitter']],
          ].map(([heading, links]) => (
            <div key={heading} className="spb-wfp-footer-col">
              <div className="spb-wfp-footer-col-head">{heading}</div>
              {links.map(l => <div key={l} className="spb-wfp-footer-link">{l}</div>)}
            </div>
          ))}
        </div>
        <div className="spb-wfp-footer-bar">
          <span>© 2025 Company Name. All rights reserved.</span>
          <span>Privacy Policy · Terms of Service</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Style preview ────────────────────────────────────────────────────────────
function StylePreview({ style }) {
  const c = style.colors || {};
  const previewStyle = {
    '--prev-bg': c.background || '#fff',
    '--prev-surf': c.surface || '#f8fafc',
    '--prev-text': c.text || '#0f172a',
    '--prev-muted': c.muted || '#64748b',
    '--prev-accent': c.accent || '#198754',
    '--prev-line': c.line || '#e2e8f0',
    '--prev-radius': `${style.radius ?? 12}px`,
    fontFamily: style.bodyFont ? `'${style.bodyFont}', sans-serif` : 'sans-serif',
  };

  return (
    <div className="spb-preview-frame" style={previewStyle}>
      <div className="spb-prev-nav">
        <span className="spb-prev-logo" style={{ fontFamily: style.headingFont ? `'${style.headingFont}', serif` : 'serif' }}>Brand</span>
        <div className="spb-prev-nav-links">
          {['Home', 'Services', 'About', 'Contact'].map(l => <span key={l} className="spb-prev-nav-link">{l}</span>)}
        </div>
        <div className="spb-prev-btn spb-prev-btn--accent">Get started</div>
      </div>
      <div className="spb-prev-hero">
        <div className="spb-prev-hero-text">
          <div className="spb-prev-h1" style={{ fontFamily: style.headingFont ? `'${style.headingFont}', serif` : 'serif' }}>Your headline here</div>
          <div className="spb-prev-sub">A short description of what you do and who you serve.</div>
          <div className="spb-prev-btn spb-prev-btn--accent" style={{ display: 'inline-block', marginTop: 10 }}>Get in touch</div>
        </div>
        <div className="spb-prev-hero-img" />
      </div>
      <div className="spb-prev-cards">
        {['Service A', 'Service B', 'Service C'].map(n => (
          <div key={n} className="spb-prev-card">
            <div className="spb-prev-card-icon" />
            <div className="spb-prev-card-title" style={{ fontFamily: style.headingFont ? `'${style.headingFont}', serif` : 'serif' }}>{n}</div>
            <div className="spb-prev-card-body">Short description of this service for your visitors.</div>
          </div>
        ))}
      </div>
      <div className="spb-prev-chips">
        {['design', 'web', 'local'].map(t => <span key={t} className="spb-prev-chip">{t}</span>)}
      </div>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="spb-toast-wrap">
      <div className="spb-toast">{message}</div>
    </div>
  );
}

// ─── Section Edit Modal ───────────────────────────────────────────────────────
function SectionEditModal({ section, onSave, onClose }) {
  const [local, setLocal] = useState({ ...section });

  return (
    <div className="spb-modal-backdrop" onClick={onClose}>
      <div className="spb-modal" onClick={e => e.stopPropagation()}>
        <div className="spb-modal-header">
          <div className="spb-modal-title">Edit Section</div>
          <button className="spb-btn spb-btn--ghost spb-btn--icon" onClick={onClose}>✕</button>
        </div>
        <div className="spb-modal-body">
          <label className="spb-field-label">Title</label>
          <input className="spb-input" value={local.title} onChange={e => setLocal(p => ({ ...p, title: e.target.value }))} />
          <label className="spb-field-label" style={{ marginTop: 12 }}>Section type</label>
          <select className="spb-input" value={local.type} onChange={e => setLocal(p => ({ ...p, type: e.target.value }))}>
            {SECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="spb-field-label" style={{ marginTop: 12 }}>Description / content notes</label>
          <textarea className="spb-input spb-textarea" rows={4} value={local.description} onChange={e => setLocal(p => ({ ...p, description: e.target.value }))} />
        </div>
        <div className="spb-modal-footer">
          <button className="spb-btn spb-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="spb-btn spb-btn--primary" onClick={() => { onSave(local); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function BuilderSitePlan({ templateId, templateType, navigate }) {
  const [activeTab, setActiveTab] = useState('brief');
  const [toast, setToast] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [planId, setPlanId] = useState(null);
  // Phase 3 — AI suggest state
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiPreview, setAiPreview] = useState(null); // { summary, sitemap, warnings }
  // AI brief
  const [aiSuggestingBrief, setAiSuggestingBrief] = useState(false);
  const [aiPreviewBrief, setAiPreviewBrief] = useState(null);
  const [aiAppliedBriefFields, setAiAppliedBriefFields] = useState({});
  // AI sections (per-page)
  const [aiSuggestingSection, setAiSuggestingSection] = useState(null); // pageId or null
  const [aiPreviewSection, setAiPreviewSection] = useState(null);
  // AI wireframe
  const [aiSuggestingWireframe, setAiSuggestingWireframe] = useState(false);
  const [aiPreviewWireframe, setAiPreviewWireframe] = useState(null);
  // Auto-save
  const saveTimerRef = useRef(null);
  const [saveState, setSaveState] = useState('idle'); // 'idle'|'saving'|'saved'
  // Generate error
  const [generateError, setGenerateError] = useState(null);
  const [missingFields, setMissingFields] = useState(null); // 422 ANSWER_SHEET_INCOMPLETE payload
  // Phase 6 — template metadata
  const [templateMeta, setTemplateMeta] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
  }, []);

  // Phase 6 — fetch template metadata on mount, seed sitemap from supportedPages
  useEffect(() => {
    if (!templateId) return;
    getTemplateHostingTemplate(templateId)
      .then(meta => {
        setTemplateMeta(meta);
        // If template has supportedPages, seed the sitemap with them
        if (Array.isArray(meta?.supportedPages) && meta.supportedPages.length > 0) {
          setSitePlan(p => {
            // Only seed if user hasn't changed from defaults (first 2 pages)
            if (p.sitemap.pages.length <= 2) {
              const seeded = meta.supportedPages.map((page, i) => {
                // supportedPages can be strings ("Home") or objects ({ title, path })
                const pageName = typeof page === 'string' ? page : (page?.title || page?.name || `Page ${i + 1}`);
                const pagePath = typeof page === 'object' && page?.path
                  ? page.path
                  : (i === 0 ? '/' : `/${pageName.toLowerCase().replace(/\s+/g, '-')}`);
                const defaultSections = meta.supportedSections?.slice(0, 2).map(type => ({
                  id: uid(), title: type.charAt(0).toUpperCase() + type.slice(1), type, description: '',
                })) || [{ id: uid(), title: 'Section', type: 'hero', description: '' }];
                return { id: uid(), name: pageName, path: pagePath, sections: defaultSections };
              });
              return { ...p, sitemap: { ...p.sitemap, pages: seeded } };
            }
            return p;
          });
        }
      })
      .catch(() => {}); // fail silently — metadata is optional
  }, [templateId]);

  // Phase 3 — AI suggest sitemap handler
  const handleAiSuggest = async () => {
    if (!planId) {
      // Need to save plan first so the backend has context
      try {
        const result = await createTemplateSitePlan({ ...sitePlan, templateId, templateType });
        const newPlanId = result?.data?.planId || result?.planId;
        if (newPlanId) {
          setPlanId(newPlanId);
          await doAiSuggest(newPlanId);
        }
      } catch {
        showToast('Save failed — could not start AI suggestion.');
      }
    } else {
      // Save latest sitemap first
      try { await updateTemplateSitePlanPart(planId, 'sitemap', sitePlan.sitemap); } catch {}
      await doAiSuggest(planId);
    }
  };

  const doAiSuggest = async (pid) => {
    setAiSuggesting(true);
    try {
      const result = await aiSuggestSitemapForPlan(pid);
      setAiPreview(result?.data || result);
    } catch (e) {
      showToast(isAiDisabledError(e) ? 'RoxanneAI is not enabled on this server. You can continue manually.' : (e?.message || 'AI suggestion failed.'));
    } finally {
      setAiSuggesting(false);
    }
  };

  const applyAiSuggestion = () => {
    if (!aiPreview?.sitemap) return;
    setSitePlan(p => ({ ...p, sitemap: aiPreview.sitemap }));
    setAiPreview(null);
    showToast('AI suggestion applied. Review and edit as needed.');
    setActiveTab('sitemap');
  };

  // ── AI brief handler ─────────────────────────────────────────────────────
  const handleAiBrief = async () => {
    if (!planId) {
      try {
        const result = await createTemplateSitePlan({ ...sitePlan, templateId, templateType });
        const newPlanId = result?.data?.planId || result?.planId;
        if (newPlanId) { setPlanId(newPlanId); await doAiBrief(newPlanId); }
      } catch { showToast('Save failed — could not start AI suggestion.'); }
    } else { await doAiBrief(planId); }
  };
  const doAiBrief = async (pid) => {
    setAiSuggestingBrief(true);
    try {
      const result = await aiAutofillOptionalBrief(pid);
      const data = result?.data || result;
      setAiPreviewBrief(data);
      const defaults = {};
      Object.keys(data.suggestions || {}).forEach(k => { defaults[k] = true; });
      setAiAppliedBriefFields(defaults);
    } catch (e) { showToast(e?.message || 'AI brief suggestion failed.'); }
    finally { setAiSuggestingBrief(false); }
  };
  const applyAiBriefSuggestions = () => {
    if (!aiPreviewBrief?.suggestions) return;
    Object.entries(aiPreviewBrief.suggestions).forEach(([k, v]) => {
      if (aiAppliedBriefFields[k] && v) setBriefField(k, v);
    });
    setAiPreviewBrief(null);
    showToast('Brief fields updated by RoxanneAI.');
  };

  // ── AI sections handler ──────────────────────────────────────────────────
  const handleAiSections = async (pageId) => {
    if (!planId) {
      try {
        const result = await createTemplateSitePlan({ ...sitePlan, templateId, templateType });
        const newPlanId = result?.data?.planId || result?.planId;
        if (newPlanId) { setPlanId(newPlanId); await doAiSections(newPlanId, pageId); }
      } catch { showToast('Save failed — could not start AI suggestion.'); }
    } else {
      try { await updateTemplateSitePlanPart(planId, 'sitemap', sitePlan.sitemap); } catch {}
      await doAiSections(planId, pageId);
    }
  };
  const doAiSections = async (pid, pageId) => {
    setAiSuggestingSection(pageId);
    try {
      const result = await aiSuggestSectionsForPage(pid, pageId);
      setAiPreviewSection(result?.data || result);
    } catch (e) { showToast(isAiDisabledError(e) ? 'RoxanneAI is not enabled on this server. You can continue manually.' : (e?.message || 'AI section suggestion failed.')); }
    finally { setAiSuggestingSection(null); }
  };
  const applyAiSectionSuggestions = () => {
    if (!aiPreviewSection?.sections) return;
    const { pageId, sections } = aiPreviewSection;
    setSitePlan(p => ({
      ...p,
      sitemap: {
        ...p.sitemap,
        pages: p.sitemap.pages.map(pg => pg.id === pageId ? { ...pg, sections } : pg),
      },
    }));
    setAiPreviewSection(null);
    showToast('Page sections updated by RoxanneAI.');
  };

  // ── AI wireframe handler ─────────────────────────────────────────────────
  const handleAiWireframe = async () => {
    if (!planId) {
      try {
        const result = await createTemplateSitePlan({ ...sitePlan, templateId, templateType });
        const newPlanId = result?.data?.planId || result?.planId;
        if (newPlanId) { setPlanId(newPlanId); await doAiWireframe(newPlanId); }
      } catch { showToast('Save failed — could not start AI suggestion.'); }
    } else {
      try { await updateTemplateSitePlanPart(planId, 'sitemap', sitePlan.sitemap); } catch {}
      await doAiWireframe(planId);
    }
  };
  const doAiWireframe = async (pid) => {
    setAiSuggestingWireframe(true);
    try {
      const result = await aiSuggestWireframe(pid);
      setAiPreviewWireframe(result?.data || result);
    } catch (e) { showToast(isAiDisabledError(e) ? 'RoxanneAI is not enabled on this server. You can continue manually.' : (e?.message || 'AI wireframe suggestion failed.')); }
    finally { setAiSuggestingWireframe(false); }
  };
  const applyAiWireframeSuggestions = () => {
    if (!aiPreviewWireframe?.pages) return;
    setSitePlan(p => ({ ...p, sitemap: { ...p.sitemap, pages: aiPreviewWireframe.pages } }));
    setAiPreviewWireframe(null);
    showToast('Wireframe guidance applied by RoxanneAI.');
    setActiveTab('wireframe');
  };

  const [sitePlan, setSitePlan] = useState(() => ({
    source: 'hybrid-site-plan',
    templateId,
    templateType,
    status: 'draft',
    brief: {
      businessName: '', industry: '', description: '', targetAudience: '', offer: '',
      brandTone: '', colors: '', stylePreferences: '', pages: '', contact: '',
      domainPreference: '', notes: '',
    },
    sitemap: {
      name: 'New Website',
      pages: [
        {
          id: uid(), name: 'Home', path: '/', sections: [
            { id: uid(), title: 'Hero Section', type: 'hero', description: 'Introduce the business, value statement, and primary call to action.' },
            { id: uid(), title: 'Services Overview', type: 'services', description: 'Show the main services visitors can choose from.' },
            { id: uid(), title: 'Call To Action', type: 'cta', description: 'Encourage visitors to contact or get started.' },
          ],
        },
        {
          id: uid(), name: 'Contact', path: '/contact', sections: [
            { id: uid(), title: 'Contact Form', type: 'form', description: 'Collect name, email, phone, and message.' },
            { id: uid(), title: 'Business Details', type: 'details', description: 'Show email, phone, location, and opening hours.' },
          ],
        },
      ],
    },
    wireframe: null,
    style: {
      presetId: 'clean',
      colors: { background: '#ffffff', surface: '#ffffff', text: '#0f172a', muted: '#64748b', accent: '#198754', line: '#e6e8ee' },
      headingFont: 'Hanken Grotesk',
      bodyFont: 'Hanken Grotesk',
      radius: 12,
      space: 1,
    },
  }));

  // ── Auto-save debounce (must be after sitePlan is declared) ─────────────
  useEffect(() => {
    if (!planId) return;
    setSaveState('saving');
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateTemplateSitePlanPart(planId, 'brief', sitePlan.brief);
        await updateTemplateSitePlanPart(planId, 'sitemap', sitePlan.sitemap);
        await updateTemplateSitePlanPart(planId, 'style', sitePlan.style);
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 2000);
      } catch { setSaveState('idle'); }
    }, 1500);
    return () => clearTimeout(saveTimerRef.current);
  }, [sitePlan, planId]);

  // ── Brief helpers ────────────────────────────────────────────────────────
  const setBriefField = (field, value) => {
    setSitePlan(p => ({ ...p, brief: { ...p.brief, [field]: value } }));
  };

  const handleSuggestSitemap = () => {
    const suggested = suggestSitemapFromBrief(sitePlan.brief);
    setSitePlan(p => ({ ...p, sitemap: { ...p.sitemap, pages: suggested } }));
    setActiveTab('sitemap');
    showToast('Sitemap suggested based on your brief!');
  };

  // ── Sitemap helpers ──────────────────────────────────────────────────────
  const addPage = () => {
    setSitePlan(p => ({
      ...p,
      sitemap: {
        ...p.sitemap,
        pages: [...p.sitemap.pages, { id: uid(), name: 'New Page', path: '/new-page', sections: [] }],
      },
    }));
  };

  const deletePage = (pageId) => {
    setSitePlan(p => ({
      ...p,
      sitemap: { ...p.sitemap, pages: p.sitemap.pages.filter(pg => pg.id !== pageId) },
    }));
  };

  const updatePage = (pageId, field, value) => {
    setSitePlan(p => ({
      ...p,
      sitemap: {
        ...p.sitemap,
        pages: p.sitemap.pages.map(pg => pg.id === pageId ? { ...pg, [field]: value } : pg),
      },
    }));
  };

  const addSection = (pageId) => {
    setSitePlan(p => ({
      ...p,
      sitemap: {
        ...p.sitemap,
        pages: p.sitemap.pages.map(pg =>
          pg.id === pageId
            ? { ...pg, sections: [...pg.sections, { id: uid(), title: 'New Section', type: 'hero', description: '' }] }
            : pg
        ),
      },
    }));
  };

  const deleteSection = (pageId, sectionId) => {
    setSitePlan(p => ({
      ...p,
      sitemap: {
        ...p.sitemap,
        pages: p.sitemap.pages.map(pg =>
          pg.id === pageId ? { ...pg, sections: pg.sections.filter(s => s.id !== sectionId) } : pg
        ),
      },
    }));
  };

  const updateSection = (pageId, updated) => {
    setSitePlan(p => ({
      ...p,
      sitemap: {
        ...p.sitemap,
        pages: p.sitemap.pages.map(pg =>
          pg.id === pageId
            ? { ...pg, sections: pg.sections.map(s => s.id === updated.id ? updated : s) }
            : pg
        ),
      },
    }));
  };

  // ── Style helpers ────────────────────────────────────────────────────────
  const applyPreset = (presetId) => {
    const preset = STYLE_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setSitePlan(p => ({
      ...p,
      style: {
        presetId: preset.id,
        colors: { ...preset.colors },
        headingFont: preset.headingFont,
        bodyFont: preset.bodyFont,
        radius: preset.radius,
        space: preset.space,
      },
    }));
  };

  const setStyleColor = (key, value) => {
    setSitePlan(p => ({ ...p, style: { ...p.style, colors: { ...p.style.colors, [key]: value } } }));
  };

  const setStyleField = (field, value) => {
    setSitePlan(p => ({ ...p, style: { ...p.style, [field]: value } }));
  };

  // ── Save plan ────────────────────────────────────────────────────────────
  const handleSavePlan = async () => {
    try {
      if (planId) {
        await updateTemplateSitePlanPart(planId, 'brief', sitePlan.brief);
        await updateTemplateSitePlanPart(planId, 'sitemap', sitePlan.sitemap);
        await updateTemplateSitePlanPart(planId, 'style', sitePlan.style);
        showToast('Plan saved.');
      } else {
        const result = await createTemplateSitePlan(sitePlan);
        if (result?.data?.planId) setPlanId(result.data.planId);
        showToast('Plan created and saved.');
      }
    } catch {
      showToast('Could not save plan — continuing offline.');
    }
  };

  // ── Generate (Phase 5 — full handoff flow) ──────────────────────────────
  const handleGenerate = async () => {
    setGenerating(true);
    setMissingFields(null);
    setGenerateError(null);
    try {
      let activePlanId = planId;

      // Step 1: create or save the plan
      if (!activePlanId) {
        const created = await createTemplateSitePlan({ ...sitePlan, templateId, templateType });
        activePlanId = created?.data?.planId || created?.planId;
        if (activePlanId) setPlanId(activePlanId);
      } else {
        await updateTemplateSitePlanPart(activePlanId, 'brief', sitePlan.brief);
        await updateTemplateSitePlanPart(activePlanId, 'sitemap', sitePlan.sitemap);
        await updateTemplateSitePlanPart(activePlanId, 'style', sitePlan.style);
      }

      if (!activePlanId) throw new Error('Could not create plan record.');

      // Step 2: approve
      await approveTemplateSitePlan(activePlanId);

      // Step 3: handoff to Hosting Deploy Engine.
      // allowAiCompletion:false — this is the manual path; AI is never required here.
      let deploymentId, siteId;
      try {
        const handoff = await handoffTemplateSitePlan(activePlanId, { allowAiCompletion: false });
        deploymentId = handoff?.deploymentId || handoff?.data?.deploymentId;
        siteId = handoff?.siteId || handoff?.data?.siteId;
      } catch (handoffErr) {
        // 422 — the answer sheet failed validation. Show the missing fields so
        // the user can fix them; do NOT silently fall back to the legacy flow.
        if (handoffErr?.code === 'ANSWER_SHEET_INCOMPLETE' || handoffErr?.status === 422) {
          setMissingFields(handoffErr?.body?.missing || [{ message: handoffErr.message }]);
          setGenerateError('Some required details are missing. Fill them in below, then generate again.');
          return;
        }
        // 503 — handoff stage genuinely unavailable on the server. Fall back to
        // the prepare flow so the user can still configure deployment manually.
        if (handoffErr?.status === 503) {
          console.warn('[SitePlanBuilder] Handoff unavailable, falling back to createSite:', handoffErr.message);
          const answers = { source: 'hybrid-site-plan', ...sitePlan.brief, sitemap: sitePlan.sitemap, style: sitePlan.style };
          const fallback = await createSiteFromTailoredTemplate(templateId, answers, []);
          siteId = fallback?.siteId || fallback?.data?.siteId;
        } else {
          throw handoffErr;
        }
      }

      // Step 4: navigate to deployment settings or hosting detail
      if (deploymentId) {
        navigate({ view: 'hosting-detail', params: { id: deploymentId } });
      } else if (siteId) {
        navigate({ view: 'builder-deployment-settings', params: { siteId, templateId, templateType } });
      } else {
        navigate({ view: 'hosting-list' });
      }
    } catch (e) {
      setGenerateError(e?.message || 'Generation failed. Please try again.');
      showToast(e?.message || 'Generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  // ── Tab completion ───────────────────────────────────────────────────────
  const tabDone = {
    brief: !!(sitePlan.brief.businessName && sitePlan.brief.industry && sitePlan.brief.description),
    sitemap: sitePlan.sitemap.pages.length >= 2 && sitePlan.sitemap.pages.every(p => p.sections.length > 0),
    wireframe: sitePlan.sitemap.pages.length > 0,
    style: true,
    review: false,
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="site-plan-builder">
      {/* Topbar */}
      <div className="spb-topbar">
        <button className="spb-btn spb-btn--ghost spb-btn--sm" onClick={() => navigate({ view: 'builder-gallery' })}>
          ← Back
        </button>
        <div className="spb-topbar-name">
          {sitePlan.sitemap.name || 'New Website'} — Site Plan
        </div>
        <div className="spb-topbar-right">
          <button
            className="spb-btn spb-btn--ai spb-btn--sm"
            onClick={handleAiSuggest}
            disabled={aiSuggesting}
            title="Ask RoxanneAI to suggest a sitemap based on your brief"
          >
            {aiSuggesting ? '⏳ Thinking…' : '✦ RoxanneAI'}
          </button>
          <button className="spb-btn spb-btn--outline spb-btn--sm" onClick={handleSavePlan}>
            {saveState === 'saving' ? '↻ Saving…' : saveState === 'saved' ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="spb-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`spb-tab ${activeTab === tab.key ? 'spb-tab--active' : ''} ${tabDone[tab.key] ? 'spb-tab--done' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="spb-tab-num">{tabDone[tab.key] ? '✓' : tab.num}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="spb-tab-content">
        {activeTab === 'brief' && (
          <BriefTab
            brief={sitePlan.brief}
            onChange={setBriefField}
            onSuggest={handleSuggestSitemap}
            onAiBrief={handleAiBrief}
            aiSuggesting={aiSuggestingBrief}
          />
        )}
        {activeTab === 'sitemap' && (
          <SitemapTab
            sitemap={sitePlan.sitemap}
            onNameChange={name => setSitePlan(p => ({ ...p, sitemap: { ...p.sitemap, name } }))}
            onAddPage={addPage}
            onDeletePage={deletePage}
            onUpdatePage={updatePage}
            onAddSection={addSection}
            onDeleteSection={deleteSection}
            onEditSection={(pageId, section) => setEditingSection({ pageId, section })}
            onAiSections={handleAiSections}
            aiSuggestingSection={aiSuggestingSection}
          />
        )}
        {activeTab === 'wireframe' && (
          <WireframeTab
            pages={sitePlan.sitemap.pages}
            style={sitePlan.style}
            onAiWireframe={handleAiWireframe}
            aiSuggesting={aiSuggestingWireframe}
            onEditSection={(pageId, section) => setEditingSection({ pageId, section })}
          />
        )}
        {activeTab === 'style' && (
          <StyleTab
            style={sitePlan.style}
            onPreset={applyPreset}
            onColor={setStyleColor}
            onField={setStyleField}
            brief={sitePlan.brief}
          />
        )}
        {activeTab === 'review' && (
          <ReviewTab
            sitePlan={sitePlan}
            templateId={templateId}
            templateType={templateType}
            onGenerate={handleGenerate}
            generating={generating}
            generateError={generateError}
            missingFields={missingFields}
            onClearError={() => { setGenerateError(null); setMissingFields(null); }}
            onGoToBrief={() => setActiveTab('brief')}
            navigate={navigate}
          />
        )}
      </div>

      {/* Section edit modal */}
      {editingSection && (
        <SectionEditModal
          section={editingSection.section}
          onSave={updated => updateSection(editingSection.pageId, updated)}
          onClose={() => setEditingSection(null)}
        />
      )}

      {/* AI suggestion preview panel (Phase 3) */}
      {aiPreview && (
        <div className="spb-ai-preview-backdrop" onClick={() => setAiPreview(null)}>
          <div className="spb-ai-preview-panel" onClick={e => e.stopPropagation()}>
            <div className="spb-ai-preview-head">
              <span className="spb-ai-badge">✦ RoxanneAI</span>
              <h3>Sitemap suggestion</h3>
              <button className="spb-btn spb-btn--ghost spb-btn--sm" onClick={() => setAiPreview(null)}>✕</button>
            </div>
            <p className="spb-ai-summary">{aiPreview.summary}</p>
            {aiPreview.warnings?.length > 0 && (
              <div className="spb-ai-warnings">
                {aiPreview.warnings.map((w, i) => <div key={i} className="spb-ai-warning">⚠ {w}</div>)}
              </div>
            )}
            <div className="spb-ai-pages">
              {(aiPreview.sitemap?.pages || []).map(page => (
                <div key={page.id} className="spb-ai-page">
                  <div className="spb-ai-page-name">{page.name} <span className="spb-ai-page-path">{page.path}</span></div>
                  <ul className="spb-ai-sections">
                    {(page.sections || []).map(s => (
                      <li key={s.id}><strong>{s.title}</strong> — {s.description}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="spb-ai-actions">
              <button className="spb-btn spb-btn--ghost" onClick={() => setAiPreview(null)}>Cancel</button>
              <button className="spb-btn spb-btn--primary" onClick={applyAiSuggestion}>Apply changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Brief preview ── */}
      {aiPreviewBrief && (
        <div className="spb-ai-preview-backdrop" onClick={() => setAiPreviewBrief(null)}>
          <div className="spb-ai-preview-panel" onClick={e => e.stopPropagation()}>
            <div className="spb-ai-preview-head">
              <span className="spb-ai-badge">✦ RoxanneAI</span>
              <h3>Optional brief suggestions</h3>
              <button className="spb-btn spb-btn--ghost spb-btn--sm" onClick={() => setAiPreviewBrief(null)}>✕</button>
            </div>
            <p className="spb-ai-summary">{aiPreviewBrief.summary}</p>
            {aiPreviewBrief.warnings?.length > 0 && (
              <div className="spb-ai-warnings">{aiPreviewBrief.warnings.map((w,i) => <div key={i} className="spb-ai-warning">⚠ {w}</div>)}</div>
            )}
            <div className="spb-ai-suggestion-rows">
              {Object.entries(aiPreviewBrief.suggestions || {}).filter(([,v]) => v).map(([key, val]) => (
                <label key={key} className="spb-ai-suggestion-row">
                  <input type="checkbox" checked={!!aiAppliedBriefFields[key]} onChange={e => setAiAppliedBriefFields(prev => ({ ...prev, [key]: e.target.checked }))} />
                  <div className="spb-ai-suggestion-content">
                    <span className="spb-ai-suggestion-key">{key}</span>
                    <span className="spb-ai-suggestion-val">{val}</span>
                  </div>
                </label>
              ))}
            </div>
            <div className="spb-ai-actions">
              <button className="spb-btn spb-btn--ghost" onClick={() => setAiPreviewBrief(null)}>Cancel</button>
              <button className="spb-btn spb-btn--primary" onClick={applyAiBriefSuggestions}>Apply selected</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Section preview ── */}
      {aiPreviewSection && (
        <div className="spb-ai-preview-backdrop" onClick={() => setAiPreviewSection(null)}>
          <div className="spb-ai-preview-panel" onClick={e => e.stopPropagation()}>
            <div className="spb-ai-preview-head">
              <span className="spb-ai-badge">✦ RoxanneAI</span>
              <h3>Section suggestions — {aiPreviewSection.pageName}</h3>
              <button className="spb-btn spb-btn--ghost spb-btn--sm" onClick={() => setAiPreviewSection(null)}>✕</button>
            </div>
            <p className="spb-ai-summary">{aiPreviewSection.summary}</p>
            {aiPreviewSection.warnings?.length > 0 && (
              <div className="spb-ai-warnings">{aiPreviewSection.warnings.map((w,i) => <div key={i} className="spb-ai-warning">⚠ {w}</div>)}</div>
            )}
            <div className="spb-ai-pages">
              {(aiPreviewSection.sections || []).map(s => (
                <div key={s.id} className="spb-ai-page">
                  <div className="spb-ai-page-name"><span className="spb-section-type-badge">{s.type}</span><strong>{s.title}</strong></div>
                  {s.description && <div className="spb-ai-page-path">{s.description}</div>}
                </div>
              ))}
            </div>
            <div className="spb-ai-actions">
              <button className="spb-btn spb-btn--ghost" onClick={() => setAiPreviewSection(null)}>Cancel</button>
              <button className="spb-btn spb-btn--primary" onClick={applyAiSectionSuggestions}>Apply to page</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Wireframe preview ── */}
      {aiPreviewWireframe && (
        <div className="spb-ai-preview-backdrop" onClick={() => setAiPreviewWireframe(null)}>
          <div className="spb-ai-preview-panel" onClick={e => e.stopPropagation()}>
            <div className="spb-ai-preview-head">
              <span className="spb-ai-badge">✦ RoxanneAI</span>
              <h3>Wireframe guidance</h3>
              <button className="spb-btn spb-btn--ghost spb-btn--sm" onClick={() => setAiPreviewWireframe(null)}>✕</button>
            </div>
            <p className="spb-ai-summary">{aiPreviewWireframe.summary}</p>
            <div className="spb-ai-pages">
              {(aiPreviewWireframe.pages || []).map(pg => (
                <div key={pg.id} className="spb-ai-page">
                  <div className="spb-ai-page-name">{pg.name}{pg.layoutNotes && <span className="spb-ai-page-path"> — {pg.layoutNotes}</span>}</div>
                  <ul className="spb-ai-sections">
                    {(pg.sections || []).map(s => <li key={s.id}><strong>{s.title}</strong>{s.contentHints ? ` — ${s.contentHints}` : ''}</li>)}
                  </ul>
                </div>
              ))}
            </div>
            <div className="spb-ai-actions">
              <button className="spb-btn spb-btn--ghost" onClick={() => setAiPreviewWireframe(null)}>Cancel</button>
              <button className="spb-btn spb-btn--primary" onClick={applyAiWireframeSuggestions}>Apply guidance</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// ─── BriefTab ─────────────────────────────────────────────────────────────────
function BriefTab({ brief, onChange, onSuggest, onAiBrief, aiSuggesting }) {
  return (
    <div className="spb-panel">
      <div className="spb-panel-head">
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <h2 className="spb-panel-title" style={{ margin:0 }}>Client Brief</h2>
          <button className="spb-btn spb-btn--ai spb-btn--sm" onClick={onAiBrief} disabled={aiSuggesting}>
            {aiSuggesting ? '✦ Thinking…' : '✦ RoxanneAI — fill optional fields'}
          </button>
        </div>
        <p className="spb-panel-sub">Required fields are marked <span style={{color:'#ef4444'}}>*</span> — AI can suggest the rest.</p>
      </div>
      <div className="spb-brief-grid">
        <div className="spb-field">
          <label className="spb-field-label">Business name <span style={{color:'#ef4444'}}>*</span></label>
          <input className="spb-input" value={brief.businessName} onChange={e => onChange('businessName', e.target.value)} placeholder="e.g. Sunrise Plumbing" />
        </div>
        <div className="spb-field">
          <label className="spb-field-label">Industry <span style={{color:'#ef4444'}}>*</span></label>
          <input className="spb-input" value={brief.industry} onChange={e => onChange('industry', e.target.value)} placeholder="e.g. Construction, Restaurant, Consulting" />
        </div>
        <div className="spb-field spb-field--full">
          <label className="spb-field-label">Business description <span style={{color:'#ef4444'}}>*</span></label>
          <textarea className="spb-input spb-textarea" rows={3} value={brief.description || ''} onChange={e => onChange('description', e.target.value)} placeholder="e.g. Family-run plumbing company serving Sydney's north shore for 15 years, specialising in fast residential repairs" />
        </div>
        <div className="spb-field">
          <label className="spb-field-label">Target audience</label>
          <input className="spb-input" value={brief.targetAudience} onChange={e => onChange('targetAudience', e.target.value)} placeholder="e.g. Local homeowners in Sydney" />
        </div>
        <div className="spb-field">
          <label className="spb-field-label">Products / services offered <span style={{color:'#ef4444'}}>*</span></label>
          <input className="spb-input" value={brief.offer} onChange={e => onChange('offer', e.target.value)} placeholder="e.g. Plumbing repairs, hot water systems, installations" />
        </div>
        <div className="spb-field spb-field--full">
          <label className="spb-field-label">Brand tone</label>
          <textarea className="spb-input spb-textarea" rows={3} value={brief.brandTone} onChange={e => onChange('brandTone', e.target.value)} placeholder="e.g. Professional but friendly, trustworthy, down-to-earth" />
        </div>
        <div className="spb-field">
          <label className="spb-field-label">Preferred colors</label>
          <input className="spb-input" value={brief.colors} onChange={e => onChange('colors', e.target.value)} placeholder="e.g. Navy blue and white, or earthy tones" />
        </div>
        <div className="spb-field">
          <label className="spb-field-label">Style preferences</label>
          <input className="spb-input" value={brief.stylePreferences} onChange={e => onChange('stylePreferences', e.target.value)} placeholder="e.g. Clean and modern, warm and approachable" />
        </div>
        <div className="spb-field">
          <label className="spb-field-label">Pages needed</label>
          <input className="spb-input" value={brief.pages} onChange={e => onChange('pages', e.target.value)} placeholder="e.g. Home, Services, About, Contact" />
        </div>
        <div className="spb-field">
          <label className="spb-field-label">Contact details</label>
          <input className="spb-input" value={brief.contact} onChange={e => onChange('contact', e.target.value)} placeholder="e.g. Phone, email, address" />
        </div>
        <div className="spb-field">
          <label className="spb-field-label">Domain preference</label>
          <input className="spb-input" value={brief.domainPreference} onChange={e => onChange('domainPreference', e.target.value)} placeholder="e.g. sunriseplumbing.com.au" />
        </div>
        <div className="spb-field spb-field--full">
          <label className="spb-field-label">Extra notes</label>
          <textarea className="spb-input spb-textarea" rows={3} value={brief.notes} onChange={e => onChange('notes', e.target.value)} placeholder="Any other details, special requirements, or context for the site" />
        </div>
      </div>
      <div className="spb-brief-actions">
        <button className="spb-btn spb-btn--primary" onClick={onSuggest}>
          Suggest sitemap from brief →
        </button>
      </div>
    </div>
  );
}

// ─── Canvas view (node tree) ──────────────────────────────────────────────────
function SitemapCanvasView({ sitemap, onAddPage, onDeletePage, onUpdatePage, onAddSection, onDeleteSection, onEditSection }) {
  const viewportRef = useRef(null);
  const panRef      = useRef(null);
  const stageRef    = useRef(null);
  const svgRef      = useRef(null);
  const nav         = useRef({ tx: 40, ty: 40, scale: 1, min: 0.35, max: 1.7 });
  const drag        = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const rafRef      = useRef(0);

  // Apply transform
  const applyTransform = () => {
    const { tx, ty, scale } = nav.current;
    if (panRef.current) {
      panRef.current.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
    }
    const el = viewportRef.current?.querySelector('.spb-cv-zoom-val');
    if (el) el.textContent = Math.round(scale * 100) + '%';
  };

  const zoom = (delta) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const prev = nav.current.scale;
    const next = Math.max(nav.current.min, Math.min(nav.current.max, +(prev + delta).toFixed(2)));
    const cx = vp.clientWidth / 2, cy = vp.clientHeight / 2;
    nav.current.tx = cx - (cx - nav.current.tx) * (next / prev);
    nav.current.ty = cy - (cy - nav.current.ty) * (next / prev);
    nav.current.scale = next;
    applyTransform();
    scheduleWires();
  };

  const fitView = () => {
    const vp = viewportRef.current, stage = stageRef.current;
    if (!vp || !stage) return;
    const vw = vp.clientWidth, vh = vp.clientHeight;
    const sw = stage.offsetWidth, sh = stage.offsetHeight;
    const scale = Math.max(nav.current.min, Math.min(1, (vw - 48) / sw, (vh - 48) / sh));
    nav.current.scale = scale;
    nav.current.tx = Math.max(16, (vw - sw * scale) / 2);
    nav.current.ty = 32;
    applyTransform();
    scheduleWires();
  };

  // Draw connector wires
  const drawWires = () => {
    const stage = stageRef.current, svg = svgRef.current;
    if (!stage || !svg) return;
    const root = stage.querySelector('.spb-cv-root');
    const branches = [...(stage.querySelectorAll('.spb-cv-branch') || [])];
    if (!root || !branches.length) { svg.innerHTML = ''; return; }

    const W = stage.offsetWidth, H = stage.offsetHeight;
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.style.width = W + 'px'; svg.style.height = H + 'px';

    const cx = el => el.offsetLeft + el.offsetWidth / 2;
    const tops = branches.map(b => b.querySelector('.spb-cv-page') || b.querySelector('.spb-cv-add-page'));

    const rootBottom = { x: cx(root), y: root.offsetTop + root.offsetHeight };
    const firstTop = Math.min(...tops.filter(Boolean).map(t => t.offsetTop));
    const railY = rootBottom.y + (firstTop - rootBottom.y) * 0.52;

    const paths = [], dots = [];
    const validTops = tops.filter(Boolean);

    if (validTops.length === 1) {
      paths.push(`M ${rootBottom.x} ${rootBottom.y} L ${cx(validTops[0])} ${validTops[0].offsetTop}`);
    } else {
      paths.push(`M ${rootBottom.x} ${rootBottom.y} L ${rootBottom.x} ${railY}`);
      const xs = validTops.map(cx);
      paths.push(`M ${Math.min(...xs)} ${railY} L ${Math.max(...xs)} ${railY}`);
      validTops.forEach(t => {
        const x = cx(t);
        paths.push(`M ${x} ${railY} L ${x} ${t.offsetTop}`);
        dots.push({ x, y: railY, cls: 'accent' });
      });
    }
    dots.push({ x: rootBottom.x, y: rootBottom.y, cls: 'ink' });

    // Section spines
    branches.forEach(b => {
      const page = b.querySelector('.spb-cv-page');
      if (!page) return;
      const items = [...b.querySelectorAll('.spb-cv-section, .spb-cv-add-section')];
      if (!items.length) return;
      const x = cx(page);
      let prevBottom = page.offsetTop + page.offsetHeight;
      items.forEach(it => {
        paths.push(`M ${x} ${prevBottom} L ${x} ${it.offsetTop}`);
        if (!it.classList.contains('spb-cv-add-section')) dots.push({ x, y: it.offsetTop, cls: 'soft' });
        prevBottom = it.offsetTop + it.offsetHeight;
      });
    });

    const ink = '#181a1f', accent = '#2b54f0', line = '#c6c6bd';
    let markup = paths.map(d =>
      `<path d="${d}" fill="none" stroke="${line}" stroke-width="1.5" stroke-linecap="round"/>`
    ).join('');
    markup += dots.map(dt => {
      if (dt.cls === 'accent') return `<circle cx="${dt.x}" cy="${dt.y}" r="3.5" fill="#fff" stroke="${accent}" stroke-width="1.5"/>`;
      if (dt.cls === 'ink')    return `<circle cx="${dt.x}" cy="${dt.y}" r="3" fill="${ink}"/>`;
      return `<circle cx="${dt.x}" cy="${dt.y}" r="2.5" fill="${line}"/>`;
    }).join('');
    svg.innerHTML = markup;
  };

  const scheduleWires = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawWires);
  };

  // Pointer-based pan
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const onDown = (e) => {
      if (e.target.closest('.spb-cv-page, .spb-cv-section, button, input, textarea, .spb-cv-controls')) return;
      drag.current = { active: true, sx: e.clientX, sy: e.clientY, ox: nav.current.tx, oy: nav.current.ty };
      vp.classList.add('spb-cv-panning');
      vp.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!drag.current.active) return;
      nav.current.tx = drag.current.ox + (e.clientX - drag.current.sx);
      nav.current.ty = drag.current.oy + (e.clientY - drag.current.sy);
      applyTransform();
    };
    const onUp = (e) => {
      drag.current.active = false;
      vp.classList.remove('spb-cv-panning');
      try { vp.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { zoom(e.deltaY > 0 ? -0.1 : 0.1); }
      else { nav.current.tx -= e.deltaX; nav.current.ty -= e.deltaY; applyTransform(); scheduleWires(); }
    };

    vp.addEventListener('pointerdown', onDown);
    vp.addEventListener('pointermove', onMove);
    vp.addEventListener('pointerup', onUp);
    vp.addEventListener('pointercancel', onUp);
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      vp.removeEventListener('pointerdown', onDown);
      vp.removeEventListener('pointermove', onMove);
      vp.removeEventListener('pointerup', onUp);
      vp.removeEventListener('pointercancel', onUp);
      vp.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Redraw wires whenever sitemap changes
  useEffect(() => {
    scheduleWires();
  }, [sitemap]);

  // Fit on first mount
  useEffect(() => {
    const t = setTimeout(() => { fitView(); drawWires(); }, 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="spb-cv-viewport" ref={viewportRef}>
      <div className="spb-cv-pan" ref={panRef}>
        <div className="spb-cv-stage" ref={stageRef}>
          <svg className="spb-cv-wires" ref={svgRef} />

          {/* Root node */}
          <div className="spb-cv-root">
            <span className="spb-cv-root-name">{sitemap.name || 'New Website'}</span>
          </div>

          {/* Branches */}
          <div className="spb-cv-branches">
            {sitemap.pages.map((page) => (
              <div className="spb-cv-branch" key={page.id}>
                {/* Page node */}
                <div className="spb-cv-node spb-cv-page">
                  <div className="spb-cv-page-head">
                    <span className="spb-cv-page-dot" />
                    <input
                      className="spb-cv-page-input"
                      value={page.name}
                      onChange={e => { onUpdatePage(page.id, 'name', e.target.value); scheduleWires(); }}
                      spellCheck={false}
                    />
                    <button
                      className="spb-cv-icon-btn spb-cv-icon-btn--delete"
                      onClick={() => onDeletePage(page.id)}
                      title="Delete page"
                    >✕</button>
                  </div>
                  <div className="spb-cv-page-meta">
                    <span className="spb-cv-page-path">{page.path}</span>
                    <span className="spb-cv-page-count">{page.sections.length} sec</span>
                  </div>
                </div>

                {/* Section nodes */}
                <div className="spb-cv-sections">
                  {page.sections.map(s => (
                    <div
                      key={s.id}
                      className="spb-cv-node spb-cv-section"
                      onClick={() => onEditSection(page.id, s)}
                      title="Click to edit"
                    >
                      <span className="spb-cv-sec-dot" />
                      <span className="spb-cv-sec-title">{s.title}</span>
                      <span className="spb-cv-sec-type">{s.type}</span>
                      <button
                        className="spb-cv-icon-btn spb-cv-icon-btn--delete spb-cv-sec-del"
                        onClick={e => { e.stopPropagation(); onDeleteSection(page.id, s.id); }}
                        title="Delete section"
                      >✕</button>
                    </div>
                  ))}
                  <button
                    className="spb-cv-add spb-cv-add-section"
                    onClick={() => { onAddSection(page.id); scheduleWires(); }}
                  >+ Section</button>
                </div>
              </div>
            ))}

            {/* Add page node */}
            <div className="spb-cv-branch">
              <button className="spb-cv-add spb-cv-add-page" onClick={() => { onAddPage(); scheduleWires(); }}>
                <span className="spb-cv-add-page-ic">+</span>
                Add page
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="spb-cv-controls">
        <button onClick={() => zoom(-0.15)} title="Zoom out">−</button>
        <button onClick={fitView} title="Fit to view"><span className="spb-cv-zoom-val">100%</span></button>
        <button onClick={() => zoom(0.15)} title="Zoom in">+</button>
      </div>
      <div className="spb-cv-hint">Drag to pan · scroll or +/− to zoom</div>
    </div>
  );
}

// ─── SitemapTab ───────────────────────────────────────────────────────────────
function SitemapTab({ sitemap, onNameChange, onAddPage, onDeletePage, onUpdatePage, onAddSection, onDeleteSection, onEditSection, onAiSections, aiSuggestingSection }) {
  const [view, setView] = useState('cards'); // 'cards' | 'canvas'

  return (
    <div className="spb-panel">
      <div className="spb-panel-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="spb-panel-title" style={{ margin: 0 }}>Sitemap</h2>
          <input
            className="spb-input spb-site-name-input"
            value={sitemap.name}
            onChange={e => onNameChange(e.target.value)}
            placeholder="Site name"
          />
          {/* Cards / Canvas toggle — exact style from source */}
          <div className="spb-view-seg">
            <button
              className={view === 'cards' ? 'active' : ''}
              onClick={() => setView('cards')}
              title="Card columns view"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
                <rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="16" rx="1.5"/>
              </svg>
              Cards
            </button>
            <button
              className={view === 'canvas' ? 'active' : ''}
              onClick={() => setView('canvas')}
              title="Node tree canvas"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
                <rect x="8" y="2.5" width="8" height="5" rx="1.2"/>
                <rect x="2.5" y="16.5" width="7" height="5" rx="1.2"/>
                <rect x="14.5" y="16.5" width="7" height="5" rx="1.2"/>
                <path d="M12 7.5v4M6 16.5v-2.5h12v2.5"/>
              </svg>
              Canvas
            </button>
          </div>
          <span className="spb-count-chip"><b>{sitemap.pages.length}</b> pages</span>
        </div>
        <p className="spb-panel-sub">Build out the page structure and sections for this site.</p>
      </div>

      {/* Cards view */}
      {view === 'cards' && (
        <div className="spb-pages-grid">
          {sitemap.pages.map(page => (
            <div key={page.id} className="spb-page-card">
              <div className="spb-page-card-head">
                <div className="spb-page-fields">
                  <input
                    className="spb-input spb-input--sm spb-page-name"
                    value={page.name}
                    onChange={e => onUpdatePage(page.id, 'name', e.target.value)}
                    placeholder="Page name"
                  />
                  <input
                    className="spb-input spb-input--sm spb-page-path"
                    value={page.path}
                    onChange={e => onUpdatePage(page.id, 'path', e.target.value)}
                    placeholder="/path"
                  />
                </div>
                <div style={{ display:'flex', gap:4 }}>
                  <button
                    className="spb-btn spb-btn--ai spb-btn--icon"
                    onClick={() => onAiSections && onAiSections(page.id)}
                    disabled={aiSuggestingSection === page.id}
                    title="RoxanneAI — improve sections"
                  >{aiSuggestingSection === page.id ? '…' : '✦'}</button>
                  <button className="spb-btn spb-btn--ghost spb-btn--icon spb-delete-btn" onClick={() => onDeletePage(page.id)} title="Delete page">✕</button>
                </div>
              </div>
              <div className="spb-sections-list">
                {page.sections.map(section => (
                  <div key={section.id} className="spb-section-card" onClick={() => onEditSection(page.id, section)}>
                    <div className="spb-section-card-inner">
                      <div className="spb-section-type-badge">{section.type}</div>
                      <div className="spb-section-title">{section.title}</div>
                      {section.description && <div className="spb-section-desc">{section.description}</div>}
                    </div>
                    <button
                      className="spb-btn spb-btn--ghost spb-btn--icon spb-delete-btn"
                      onClick={e => { e.stopPropagation(); onDeleteSection(page.id, section.id); }}
                      title="Delete section"
                    >✕</button>
                  </div>
                ))}
              </div>
              <button className="spb-btn spb-btn--ghost spb-btn--sm spb-add-section-btn" onClick={() => onAddSection(page.id)}>
                + Add section
              </button>
            </div>
          ))}
          <div className="spb-page-card spb-page-card--add" onClick={onAddPage} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onAddPage()}>
            <div className="spb-add-page-inner">
              <div className="spb-add-page-icon">+</div>
              <div className="spb-add-page-label">Add page</div>
            </div>
          </div>
        </div>
      )}

      {/* Canvas view */}
      {view === 'canvas' && (
        <SitemapCanvasView
          sitemap={sitemap}
          onAddPage={onAddPage}
          onDeletePage={onDeletePage}
          onUpdatePage={onUpdatePage}
          onAddSection={onAddSection}
          onDeleteSection={onDeleteSection}
          onEditSection={onEditSection}
        />
      )}
    </div>
  );
}

// ─── WireframeTab ─────────────────────────────────────────────────────────────
function WireframeTab({ pages, style, onAiWireframe, aiSuggesting, onEditSection }) {
  return (
    <div className="spb-panel spb-panel--wire">
      <div className="spb-panel-head">
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <h2 className="spb-panel-title" style={{ margin:0 }}>Wireframe</h2>
          <button
            className="spb-btn spb-btn--ai spb-btn--sm"
            onClick={onAiWireframe}
            disabled={aiSuggesting || pages.length === 0}
          >
            {aiSuggesting ? '✦ Generating…' : '✦ RoxanneAI — add content guidance'}
          </button>
        </div>
        <p className="spb-panel-sub">Click any section to edit it. Sections mirror your Sitemap — update there to see changes here.</p>
      </div>
      <div className="spb-wireframe-canvas">
        {pages.length === 0 && (
          <div className="spb-wire-empty">No pages yet. Add pages in the Sitemap tab.</div>
        )}
        {pages.map(page => <WirePage key={page.id} page={page} onEditSection={onEditSection} />)}
      </div>
    </div>
  );
}

// ─── StyleTab ─────────────────────────────────────────────────────────────────
function StyleTab({ style, onPreset, onColor, onField, brief }) {
  const COLOR_ROWS = [
    { key: 'background', label: 'Background' },
    { key: 'surface', label: 'Surface' },
    { key: 'text', label: 'Text' },
    { key: 'muted', label: 'Muted text' },
    { key: 'accent', label: 'Accent' },
    { key: 'line', label: 'Border / Line' },
  ];

  return (
    <div className="spb-panel">
      <div className="spb-panel-head">
        <h2 className="spb-panel-title">Style Direction</h2>
        <p className="spb-panel-sub">Choose a visual style preset, then fine-tune colors, fonts, and spacing.</p>
      </div>
      <div className="spb-style-body">
        <div className="spb-style-controls">
          {/* Presets */}
          <div className="spb-style-section">
            <div className="spb-style-section-label">Presets</div>
            <div className="spb-preset-grid">
              {STYLE_PRESETS.map(p => (
                <button
                  key={p.id}
                  className={`spb-preset-btn ${style.presetId === p.id ? 'spb-preset-btn--active' : ''}`}
                  onClick={() => onPreset(p.id)}
                  style={{ '--preset-accent': p.colors.accent, '--preset-bg': p.colors.background }}
                >
                  <span className="spb-preset-swatch" style={{ background: p.colors.accent }} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Colors */}
          <div className="spb-style-section">
            <div className="spb-style-section-label">Colors</div>
            {COLOR_ROWS.map(row => (
              <div key={row.key} className="spb-color-row">
                <label className="spb-color-label">{row.label}</label>
                <input
                  type="color"
                  className="spb-color-picker"
                  value={style.colors?.[row.key] || '#ffffff'}
                  onChange={e => onColor(row.key, e.target.value)}
                />
                <input
                  className="spb-input spb-input--sm spb-color-hex"
                  value={style.colors?.[row.key] || '#ffffff'}
                  onChange={e => onColor(row.key, e.target.value)}
                  maxLength={7}
                />
              </div>
            ))}
          </div>

          {/* Fonts */}
          <div className="spb-style-section">
            <div className="spb-style-section-label">Fonts</div>
            <div className="spb-font-row">
              <label className="spb-color-label">Heading font</label>
              <div className="spb-font-seg">
                {FONT_OPTIONS.map(f => (
                  <button key={f} className={`spb-font-btn ${style.headingFont === f ? 'spb-font-btn--active' : ''}`} onClick={() => onField('headingFont', f)} style={{ fontFamily: `'${f}', serif` }}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="spb-font-row" style={{ marginTop: 10 }}>
              <label className="spb-color-label">Body font</label>
              <div className="spb-font-seg">
                {FONT_OPTIONS.map(f => (
                  <button key={f} className={`spb-font-btn ${style.bodyFont === f ? 'spb-font-btn--active' : ''}`} onClick={() => onField('bodyFont', f)} style={{ fontFamily: `'${f}', sans-serif` }}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Radius + Space */}
          <div className="spb-style-section">
            <div className="spb-style-section-label">Corner radius</div>
            <div className="spb-slider-row">
              <input type="range" min={0} max={24} value={style.radius ?? 12} onChange={e => onField('radius', Number(e.target.value))} className="spb-slider" />
              <span className="spb-slider-val">{style.radius ?? 12}px</span>
            </div>
          </div>
          <div className="spb-style-section">
            <div className="spb-style-section-label">Density</div>
            <div className="spb-slider-row">
              <input type="range" min={0.8} max={1.4} step={0.1} value={style.space ?? 1} onChange={e => onField('space', Number(e.target.value))} className="spb-slider" />
              <span className="spb-slider-val">
                {style.space <= 0.9 ? 'Compact' : style.space >= 1.3 ? 'Spacious' : 'Comfortable'}
              </span>
            </div>
          </div>
        </div>

        <div className="spb-style-preview">
          <div className="spb-style-preview-label">Live preview</div>
          <StylePreview style={style} />
        </div>
      </div>
    </div>
  );
}

// ─── ReviewTab ────────────────────────────────────────────────────────────────
function ReviewTab({ sitePlan, templateId, templateType, onGenerate, generating, generateError, missingFields, onClearError, onGoToBrief, navigate }) {
  const { brief, sitemap, style } = sitePlan;
  const totalSections = sitemap.pages.reduce((sum, p) => sum + (p.sections?.length || 0), 0);
  const preset = STYLE_PRESETS.find(p => p.id === style.presetId);

  return (
    <div className="spb-panel">
      <div className="spb-panel-head">
        <h2 className="spb-panel-title">Review & Generate</h2>
        <p className="spb-panel-sub">Review your plan before generating the site. Once generated, it will be handed to the Deploy Engine.</p>
      </div>

      <div className="spb-review-section">
        <div className="spb-review-label">Template</div>
        <div className="spb-review-value">{templateId || '—'} <span className="spb-review-tag">{templateType}</span></div>
      </div>

      <div className="spb-review-section">
        <div className="spb-review-label">Business profile</div>
        <div className="spb-review-rows">
          {brief.businessName && <div><strong>Business:</strong> {brief.businessName}</div>}
          {brief.industry && <div><strong>Industry:</strong> {brief.industry}</div>}
          {brief.description && <div><strong>Description:</strong> {brief.description}</div>}
          {brief.targetAudience && <div><strong>Audience:</strong> {brief.targetAudience}</div>}
          {brief.offer && <div><strong>Services:</strong> {brief.offer}</div>}
          {brief.brandTone && <div><strong>Tone:</strong> {brief.brandTone}</div>}
          {brief.domainPreference && <div><strong>Domain:</strong> {brief.domainPreference}</div>}
          {!brief.businessName && !brief.industry && <span className="spb-review-empty">No brief filled in yet.</span>}
        </div>
      </div>

      <div className="spb-review-section">
        <div className="spb-review-label">Pages ({sitemap.pages.length}) — {totalSections} sections total</div>
        <div className="spb-review-rows">
          {sitemap.pages.map(page => (
            <div key={page.id} className="spb-review-page-row">
              <span className="spb-review-page-name">{page.name}</span>
              <span className="spb-review-page-path">{page.path}</span>
              <span className="spb-review-page-count">{page.sections.length} sections</span>
            </div>
          ))}
        </div>
      </div>

      <div className="spb-review-section">
        <div className="spb-review-label">Style</div>
        <div className="spb-review-rows">
          <div><strong>Preset:</strong> {preset?.label || style.presetId}</div>
          <div><strong>Accent color:</strong> <span className="spb-review-color-swatch" style={{ background: style.colors?.accent }} /> {style.colors?.accent}</div>
          <div><strong>Heading font:</strong> {style.headingFont}</div>
          <div><strong>Body font:</strong> {style.bodyFont}</div>
          <div><strong>Corner radius:</strong> {style.radius}px</div>
        </div>
      </div>

      <div className="spb-review-section spb-review-section--note">
        <div className="spb-review-note-icon">ℹ</div>
        <div>
          This will prepare a generated source copy from the chosen template, apply your brief, sitemap, and style direction, then hand it to Glondia Hosting for deployment.
        </div>
      </div>

      {generateError && (
        <div className="spb-review-error-panel">
          <div className="spb-review-error-icon">⚠</div>
          <div className="spb-review-error-body">
            <strong>{missingFields?.length ? 'A few details are still needed' : 'Generation failed'}</strong>
            <p>{generateError}</p>
            {missingFields?.length > 0 ? (
              <>
                <ul style={{ margin:'8px 0 0', paddingLeft:18, fontSize:13 }}>
                  {missingFields.map((m, i) => (
                    <li key={m.path || i}>{m.message || m.path}</li>
                  ))}
                </ul>
                <p style={{ fontSize:12, color:'var(--spb-muted)', marginTop:8 }}>
                  <button className="spb-link-btn" onClick={onGoToBrief}>Go to Brief →</button>
                </p>
              </>
            ) : (
              <p style={{ fontSize:12, color:'var(--spb-muted)', marginTop:4 }}>
                Make sure the hosting integration is configured in{' '}
                <button className="spb-link-btn" onClick={() => navigate({ view:'settings' })}>Settings →</button>
              </p>
            )}
          </div>
          <button className="spb-btn spb-btn--ghost spb-btn--sm" onClick={onClearError}>✕</button>
        </div>
      )}

      <div className="spb-review-generate">
        <button
          className="spb-btn spb-btn--primary spb-btn--lg"
          onClick={onGenerate}
          disabled={generating}
        >
          {generating ? 'Generating…' : 'Generate & Deploy →'}
        </button>
      </div>
    </div>
  );
}
