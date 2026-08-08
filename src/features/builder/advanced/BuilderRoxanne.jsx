// BuilderRoxanne.jsx - AI-assisted site generation as a guided chat.
import React, { useMemo, useRef, useState as useStateB } from 'react';
import { ICN } from '../../../icons';
import { useTemplates } from '../../../use-templates';
import { createBuilderSite, saveBuilderPage, getStoredAuth } from '../../../api';

const ROXANNE_IMAGE = '/images/roxanne-ai-card.png';
const PAGE_OPTIONS = ['Home', 'About', 'Services', 'Contact', 'Blog', 'Pricing', 'Portfolio'];
const TONES = ['Professional', 'Luxury', 'Friendly', 'Minimal', 'Bold', 'Creative'];

const INTAKE_STEPS = [
  {
    key: 'businessName',
    question: 'What is the business or project name?',
  },
  {
    key: 'branding',
    question: 'Tell me the branding direction: colors, logo style, voice, feeling, competitors, or anything the design must avoid.',
  },
  {
    key: 'pages',
    question: 'Which pages and setup should this site include? You can mention pages, forms, booking, pricing, gallery, shop, or contact needs.',
  },
  {
    key: 'layout',
    question: 'What layout should I design around: modern sections, landing page, portfolio, service pages, luxury editorial, dashboard-like, or something else?',
  },
  {
    key: 'launch',
    question: 'Add final launch details: domain, hosting notes, images to use, files to follow, or anything RoxanneAI must respect before building.',
  },
];

const STARTER_MESSAGES = [
  {
    role: 'assistant',
    text: "Hi, I'm RoxanneAI. I will capture the site brief through chat first, then build the template flow from it.",
  },
  {
    role: 'assistant',
    text: INTAKE_STEPS[0].question,
  },
];

function AiSiteGeneratingLoader({ businessName, pages }) {
  const letters = 'Generating'.split('');
  const pageList = pages?.length ? pages.join(', ') : 'site pages';
  return (
    <div className="ai-site-loader-card" aria-live="polite" aria-busy="true">
      <div className="ai-site-loader-copy">
        <div className="eyebrow">RoxanneAI is building</div>
        <h2>{businessName?.trim() || 'Your site draft'}</h2>
        <p>{pageList}</p>
      </div>
      <div className="loader-wrapper ai-site-loader-wrapper" aria-label="Generating site draft">
        {letters.map((letter, index) => (
          <span className="loader-letter" key={`${letter}-${index}`}>{letter}</span>
        ))}
        <div className="loader" />
      </div>
      <div className="ai-site-loader-steps">
        <span>Reading the brief</span>
        <span>Designing the template</span>
        <span>Preparing preview and hosting</span>
      </div>
    </div>
  );
}

function waitForMinimumLoaderTime(startedAt, minimumMs = 1200) {
  const remaining = minimumMs - (Date.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => setTimeout(resolve, remaining)) : Promise.resolve();
}

function normalizePages(text, fallback) {
  const lowered = text.toLowerCase();
  const picked = PAGE_OPTIONS.filter((page) => lowered.includes(page.toLowerCase()));
  return picked.length ? picked : fallback;
}

function normalizeTone(text, fallback) {
  const lowered = text.toLowerCase();
  return TONES.find((tone) => lowered.includes(tone.toLowerCase())) || fallback;
}

function deriveBrief({ intake, tone, pages, attachments }) {
  const lines = [
    `Business name: ${intake.businessName || 'Not provided'}`,
    `Branding: ${intake.branding || 'Use a polished modern brand direction.'}`,
    `Pages and setup: ${intake.pages || pages.join(', ')}`,
    `Layout direction: ${intake.layout || 'Clean conversion-focused layout.'}`,
    `Launch notes: ${intake.launch || 'Prepare for preview and hosting handoff.'}`,
    `Tone: ${tone}`,
  ];
  if (attachments.length) {
    lines.push(`Attached guidance files: ${attachments.map((file) => `${file.name} (${file.kind})`).join(', ')}.`);
  }
  return lines.join('\n');
}

function formatFileSize(bytes = 0) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function briefValue(value, fallback = 'Not captured yet') {
  return String(value || '').trim() || fallback;
}

export function BuilderRoxanne({ navigate }) {
  const { templates } = useTemplates();
  const fileInputRef = useRef(null);
  const threadRef = useRef(null);
  const [messages, setMessages] = useStateB(STARTER_MESSAGES);
  const [composer, setComposer] = useStateB('');
  const [intakeStep, setIntakeStep] = useStateB(0);
  const [intake, setIntake] = useStateB({
    businessName: '',
    branding: '',
    pages: '',
    layout: '',
    launch: '',
  });
  const [tone, setTone] = useStateB('Professional');
  const [pages, setPages] = useStateB(['Home', 'About', 'Contact']);
  const [attachments, setAttachments] = useStateB([]);
  const [generating, setGenerating] = useStateB(false);
  const [generatedSite, setGeneratedSite] = useStateB(null);
  const [genError, setGenError] = useStateB(null);

  const businessName = intake.businessName;
  const canGenerate = Boolean(businessName.trim() && intakeStep >= INTAKE_STEPS.length);
  const brief = useMemo(() => deriveBrief({ intake, tone, pages, attachments }), [intake, tone, pages, attachments]);

  const pushMessages = (items) => {
    setMessages((prev) => [...prev, ...items]);
    window.setTimeout(() => {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
    }, 40);
  };

  const askNextQuestion = (nextStep) => {
    if (nextStep < INTAKE_STEPS.length) {
      pushMessages([{ role: 'assistant', text: INTAKE_STEPS[nextStep].question }]);
      return;
    }
    pushMessages([
      {
        role: 'assistant',
        text: 'I have the initial design brief. Say "build it" or use the build action here in chat and I will generate the first template preview.',
        action: 'generate',
      },
    ]);
  };

  const handleIntakeAnswer = (text) => {
    const step = INTAKE_STEPS[intakeStep];
    if (!step) {
      pushMessages([{ role: 'assistant', text: 'Noted. I will add that to the design brief for this build.' }]);
      setIntake((current) => ({ ...current, launch: `${current.launch}\n${text}`.trim() }));
      return;
    }

    setIntake((current) => ({ ...current, [step.key]: text }));
    if (step.key === 'pages') setPages((current) => normalizePages(text, current));
    if (step.key === 'branding' || step.key === 'layout') setTone((current) => normalizeTone(text, current));

    const nextStep = intakeStep + 1;
    setIntakeStep(nextStep);
    window.setTimeout(() => askNextQuestion(nextStep), 180);
  };

  const sendMessage = () => {
    const text = composer.trim();
    if (!text || generating) return;
    setComposer('');
    pushMessages([{ role: 'user', text }]);

    if (canGenerate && /\b(build|generate|create|draft|start)\b/i.test(text)) {
      window.setTimeout(() => handleGenerate(), 140);
      return;
    }
    handleIntakeAnswer(text);
  };

  const onAttach = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const mapped = files.map((file) => ({
      id: `${file.name}-${file.lastModified}-${file.size}`,
      name: file.name,
      size: file.size,
      kind: file.type?.startsWith('image/') ? 'image' : file.type || 'file',
    }));
    setAttachments((prev) => [...prev, ...mapped]);
    pushMessages([
      { role: 'user', text: `Attached ${mapped.map((file) => file.name).join(', ')}` },
      { role: 'assistant', text: 'Got it. I will use those attachments as brand, layout, image, or content guidance for the generated site.' },
    ]);
    event.target.value = '';
  };

  const removeAttachment = (id) => {
    setAttachments((prev) => prev.filter((file) => file.id !== id));
  };

  const handleGenerate = async () => {
    if (!businessName.trim()) { setGenError('RoxanneAI still needs a business name.'); return; }
    const { accessToken } = getStoredAuth();
    if (!accessToken) { setGenError('Sign in to generate a draft.'); return; }
    const startedAt = Date.now();
    setGenerating(true);
    setGenError(null);
    pushMessages([{ role: 'assistant', text: 'Building the first template preview now.' }]);

    try {
      const tpl = templates[0];
      const site = await createBuilderSite({ name: businessName.trim(), templateId: tpl?.id });

      if (site?.pages?.[0]?.id) {
        await saveBuilderPage(site.id, site.pages[0].id, {
          siteName: businessName.trim(),
          tagline: `${businessName.trim()} - ${tone.toLowerCase()} and launch-ready`,
          heroLede: brief,
          ctaLabel: 'Get in touch',
          features: [
            { title: 'Brand direction', body: intake.branding || 'A polished identity tailored to the customer.' },
            { title: 'Site structure', body: intake.pages || pages.join(', ') },
            { title: 'Layout approach', body: intake.layout || `A ${tone.toLowerCase()} layout built for conversion.` },
          ],
          aboutHeading: `About ${businessName.trim()}`,
          about: brief,
          contactHeading: 'Start the conversation',
          contactEmail: '',
          contactPhone: '',
          contactAddress: '',
        });
      }

      await waitForMinimumLoaderTime(startedAt);
      setGeneratedSite({ id: site.id, templateId: tpl?.id, name: businessName.trim() });
      pushMessages([
        {
          role: 'assistant',
          text: 'The first template draft is ready. Preview it, keep editing the template, or continue toward hosting from the actions below.',
        },
      ]);
    } catch (err) {
      setGenError(err.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const openEditor = () => {
    if (!generatedSite) return;
    navigate({ view: 'builder-editor', params: { id: generatedSite.templateId, siteId: generatedSite.id } });
  };

  return (
    <>
      <div className="page-head">
        <div className="builder-subpage-head">
          <button
            className="builder-projects-back"
            type="button"
            onClick={() => navigate({ view: 'builder-gallery' })}
            title="Back to Site Builder"
          >
            <ICN.ArrowLeft size={18} />
          </button>
          <div>
            <div className="page-eyebrow">Site builder</div>
            <h1>Build with RoxanneAI</h1>
            <p className="sub">Chat through the brief, let RoxanneAI generate the template, then preview and host it.</p>
          </div>
        </div>
      </div>

      <section className="roxanne-chat-shell" style={{ '--roxanne-bg': `url(${ROXANNE_IMAGE})` }}>
        {generating ? (
          <AiSiteGeneratingLoader businessName={businessName} pages={pages} />
        ) : (
          <>
            <div className="roxanne-chat-header">
              <div className="roxanne-avatar">
                <img src={ROXANNE_IMAGE} alt="" />
              </div>
              <div>
                <strong>RoxanneAI</strong>
                <span>{generatedSite ? 'Template preview ready' : 'Capturing website build details'}</span>
              </div>
            </div>

            <div className="roxanne-chat-body">
              <div ref={threadRef} className="roxanne-thread" aria-live="polite">
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`roxanne-message ${message.role}`}>
                    {message.role === 'assistant' && <span className="roxanne-message-avatar">R</span>}
                    <div className="roxanne-bubble">
                      {message.text}
                      {message.action === 'generate' && !generatedSite && (
                        <button className="roxanne-inline-action" type="button" onClick={handleGenerate}>
                          <ICN.Sparkles size={14} /> Build the template preview
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {attachments.length > 0 && (
                  <div className="roxanne-attachment-strip" aria-label="Attached files">
                    {attachments.map((file) => (
                      <button key={file.id} type="button" onClick={() => removeAttachment(file.id)} title="Remove file">
                        <ICN.File size={13} />
                        <span>{file.name}</span>
                        <small>{formatFileSize(file.size)}</small>
                        <ICN.X size={12} />
                      </button>
                    ))}
                  </div>
                )}
                {genError && <div className="roxanne-error">{genError}</div>}
              </div>

              <aside className="roxanne-brief-panel" aria-label="Site brief snapshot">
                <div className="roxanne-brief-progress">
                  <span>{Math.min(intakeStep, INTAKE_STEPS.length)} of {INTAKE_STEPS.length}</span>
                  <div>
                    {INTAKE_STEPS.map((step, index) => (
                      <i key={step.key} className={index < intakeStep ? 'is-done' : index === intakeStep ? 'is-current' : ''} />
                    ))}
                  </div>
                </div>
                <div className="roxanne-brief-row">
                  <label>Project</label>
                  <p>{briefValue(intake.businessName)}</p>
                </div>
                <div className="roxanne-brief-row">
                  <label>Tone</label>
                  <p>{tone}</p>
                </div>
                <div className="roxanne-brief-row">
                  <label>Pages</label>
                  <div className="roxanne-page-chips">
                    {pages.map((page) => <span key={page}>{page}</span>)}
                  </div>
                </div>
                <div className="roxanne-brief-row">
                  <label>Brand direction</label>
                  <p>{briefValue(intake.branding, 'Waiting for brand notes')}</p>
                </div>
                <div className="roxanne-brief-row">
                  <label>Layout</label>
                  <p>{briefValue(intake.layout, 'Waiting for layout direction')}</p>
                </div>
                {attachments.length > 0 && (
                  <div className="roxanne-brief-row">
                    <label>Files</label>
                    <p>{attachments.length} attached</p>
                  </div>
                )}
              </aside>
            </div>

            {generatedSite ? (
              <div className="roxanne-build-actions">
                <div>
                  <strong>{generatedSite.name}</strong>
                  <span>Generated template is ready for preview, edits, and hosting handoff.</span>
                </div>
                <button className="btn btn-outline" type="button" onClick={openEditor}>
                  <ICN.Eye size={14} /> Preview template
                </button>
                <button className="btn btn-primary" type="button" onClick={openEditor}>
                  <ICN.Rocket size={14} /> Continue to deploy
                </button>
              </div>
            ) : (
              <div className="roxanne-composer">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv"
                  onChange={onAttach}
                  hidden
                />
                <button className="btn btn-icon btn-ghost" type="button" onClick={() => fileInputRef.current?.click()} title="Attach files">
                  <ICN.Paperclip size={18} />
                </button>
                <textarea
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder={canGenerate ? 'Say "build it" to generate, or add more instructions...' : 'Reply to RoxanneAI...'}
                  rows={1}
                />
                <button className="btn btn-ghost" type="button" onClick={sendMessage} disabled={!composer.trim() || generating}>
                  <ICN.Send size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
