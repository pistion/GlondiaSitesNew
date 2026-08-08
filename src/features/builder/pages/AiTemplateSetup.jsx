// AiTemplateSetup.jsx — RoxanneAI guided customization before Hosting handoff.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ICN } from '../../../icons';
import { GD } from '../../../data';
import {
  aiEditTemplateHostingSite,
  buildAnswerSheetForPlan,
  createSiteFromTailoredTemplate,
  createTemplateSitePlan,
  generateAnswerSheetForPlan,
  generateTailoredTemplate,
  getTemplateAiSettings,
  handoffTemplateSitePlan,
  prepareTemplateHostingSite,
  suggestIntakeAnswer,
  updateAnswerSheetForPlan,
} from '../../../api/template-ai.js';
import './AiTemplateSetup.css';

const QUESTIONS = [
  { key: 'businessName', label: 'Business name', question: "What's your business or website name?" },
  { key: 'industry', label: 'Industry', question: 'What industry or niche is this website for?' },
  { key: 'audience', label: 'Target audience', question: 'Who is your ideal customer or audience?' },
  { key: 'offer', label: 'Products/services', question: 'What do you sell or offer? Include your most important products, services, or packages.' },
  { key: 'tone', label: 'Brand tone', question: 'What should the brand feel like? Examples: luxury, bold, friendly, minimal, premium, playful.' },
  { key: 'colors', label: 'Colors', question: 'Any brand colors or color preferences? You can type hex codes, color names, or "keep existing".' },
  { key: 'stylePreferences', label: 'Style preferences', question: 'Any visual taste preferences? Examples: clean, editorial, streetwear, corporate, elegant, modern.' },
  { key: 'pages', label: 'Pages needed', question: 'Which pages should the site include? Example: Home, Shop, About, Contact, FAQ.' },
  { key: 'contact', label: 'Contact details', question: 'What contact details should appear on the site? Email, phone, location, or type "skip".' },
  { key: 'domain', label: 'Domain preference', question: 'Do you have a preferred domain or subdomain? This is optional.' },
];

const REQUIRED_KEYS = ['businessName', 'industry', 'offer'];

const GREETING_LINES = [
  "Hi, I'm RoxanneAI. I'll turn this template into a website that matches your business.",
  "I'll ask focused editing questions, sharpen your answers into structured website data, then create a copied draft from the template.",
  'The original template stays untouched. Your customized version becomes the deployable site.',
];

function isSkip(value) {
  return !value || value.trim().toLowerCase() === 'skip';
}

function RoxanneGeneratingLoader({ templateName }) {
  return (
    <div className="card" style={{ padding: 28, borderRadius: '1.25rem', background: '#111', color: '#7c7c7c', maxWidth: 720, margin: '30px auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div style={{ width: 38, height: 38, borderRadius: 999, background: 'rgba(149,106,250,.16)', color: '#956afa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ICN.Sparkles size={18} />
        </div>
        <div>
          <div style={{ color: '#fff', fontWeight: 700 }}>RoxanneAI is editing your copied template</div>
          <div style={{ fontSize: 13 }}>Customizing {templateName || 'your selected template'} and preparing it for hosting settings.</div>
        </div>
      </div>
      <div className="roxanne-loader">
        <p>loading</p>
        <div className="roxanne-loader-words">
          <span className="roxanne-loader-word">branding</span>
          <span className="roxanne-loader-word">sections</span>
          <span className="roxanne-loader-word">products</span>
          <span className="roxanne-loader-word">layouts</span>
          <span className="roxanne-loader-word">pages</span>
          <span className="roxanne-loader-word">branding</span>
        </div>
      </div>
      <p style={{ margin: '18px 0 0', color: '#a6a6a6', fontSize: 13 }}>
        This can take a moment. Do not close this screen.
      </p>
    </div>
  );
}

// ── Answer sheet review panel ──────────────────────────────────────────────────
function AnswerSheetReview({ answerSheet, planId, onConfirm, onEdit, onBack, confirming }) {
  const business = answerSheet?.business || {};
  const brand = answerSheet?.brand || {};
  const contact = answerSheet?.contact || {};
  const seo = answerSheet?.seo || {};
  // Hero content lives inside pages[].sections[] — find the first hero-type
  // section (including template variants like technical-hero).
  const pages = Array.isArray(answerSheet?.pages) ? answerSheet.pages : [];
  const allSections = pages.flatMap(p => (Array.isArray(p.sections) ? p.sections : []));
  const hero = allSections.find(s => /(^|-)hero(-|$)/.test(String(s?.type || '').toLowerCase())) || {};

  return (
    <div className="card" style={{ maxWidth: 680, margin: '0 auto', padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(149,106,250,.16)', color: '#956afa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ICN.Sparkles size={16} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Review your AI-generated content</div>
          <div className="muted" style={{ fontSize: 13 }}>Check the fields below before generating your site. Edit anything that looks wrong.</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {[
          ['Business name', business.name],
          ['Industry', business.industry],
          ['Description', business.description],
          ['Target audience', business.targetAudience],
          ['Services/offer', business.offer],
          ['Unique selling point', business.uniqueSellingPoint],
          ['Brand tone', brand.tone],
          ['Colors', brand.colors],
          ['Hero headline', hero.title],
          ['Hero CTA', hero.ctaText],
          ['Contact action', contact.primaryAction],
          ['SEO title', seo.title],
          ['SEO description', seo.description],
        ].filter(([, v]) => v).map(([label, value]) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, fontSize: 13 }}>
            <span className="muted" style={{ fontWeight: 500 }}>{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" onClick={onBack} disabled={confirming}>← Back</button>
        <button className="btn btn-outline" onClick={onEdit} disabled={confirming}>Edit answers</button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={confirming}>
          {confirming ? 'Generating site…' : <><ICN.Sparkles size={14} /> Generate site with this data</>}
        </button>
      </div>
    </div>
  );
}

export function BuilderAiIntake({ templateId, templateType, navigate }) {
  const template = GD.templates.find(t => t.id === templateId) || null;
  const isHtml = template?.contentJson?._source === 'html-template' || templateType === 'html';
  const isRepoTemplate = templateType === 'repo-template';
  const tplPages = Array.isArray(template?.contentJson?.pages) ? template.contentJson.pages : [];

  // AI configuration state — fetched from backend
  const [aiConfigured, setAiConfigured] = useState(null); // null = loading
  const [aiModel, setAiModel] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(true);

  const [messages, setMessages] = useState(() => [
    ...GREETING_LINES.map(text => ({ role: 'ai', text })),
    { role: 'ai', text: QUESTIONS[0].question, questionKey: QUESTIONS[0].key },
  ]);
  const [step, setStep] = useState(0);
  const [input, setInput] = useState('');
  const [answers, setAnswers] = useState({});
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState(null);

  // Answer sheet review state (repo template flow)
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewAnswerSheet, setReviewAnswerSheet] = useState(null);
  const [reviewPlanId, setReviewPlanId] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  const complete = step >= QUESTIONS.length;
  const minRequired = REQUIRED_KEYS.every(k => answers[k]?.trim());

  // Fetch AI config on mount — never exposes API key, only a boolean
  useEffect(() => {
    getTemplateAiSettings()
      .then(result => {
        setAiConfigured(result?.aiConfigured ?? result?.openAiConfigured ?? false);
        setAiModel(result?.aiModel || 'gpt-4o-mini');
      })
      .catch(() => {
        setAiConfigured(false);
      })
      .finally(() => setSettingsLoading(false));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!complete && !generating) inputRef.current?.focus();
  }, [step, complete, generating]);

  const handleAiSuggest = useCallback(async () => {
    if (!aiConfigured) {
      setSuggestError('AI is not configured on this server. Contact your administrator.');
      return;
    }
    const currentQ = QUESTIONS[step];
    if (!currentQ || suggesting || generating) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestion(null);
    try {
      const result = await suggestIntakeAnswer(currentQ.key, answers);
      setSuggestion({ text: result?.suggestion || '' });
    } catch (err) {
      setSuggestError(err.message || 'AI could not suggest an answer. Try typing your own.');
    } finally {
      setSuggesting(false);
    }
  }, [step, answers, suggesting, generating, aiConfigured]);

  const sendAnswer = (text) => {
    const currentQ = QUESTIONS[step];
    if (!currentQ || generating) return;

    const rawValue = text.trim();
    const value = isSkip(rawValue) ? '' : rawValue;
    const display = rawValue || '(skip)';
    const newAnswers = { ...answers, [currentQ.key]: value };
    const nextStep = step + 1;
    const nextQ = QUESTIONS[nextStep];

    setAnswers(newAnswers);
    setMessages(prev => [
      ...prev,
      { role: 'user', text: display },
      nextQ
        ? { role: 'ai', text: nextQ.question, questionKey: nextQ.key }
        : { role: 'ai', text: REQUIRED_KEYS.every(k => newAnswers[k]?.trim())
          ? 'Perfect. I have the core details. Click "Generate with RoxanneAI" and I will edit the copied template for Hosting handoff.'
          : 'I still need business name, industry, and products/services before I can generate the copied template.' },
    ]);
    setStep(nextStep);
    setInput('');
    setSuggestion(null);
    setSuggestError(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (complete) return;
    sendAnswer(input);
  };

  const buildSiteProfile = () => ({
    source: 'roxanne-ai-intake',
    parentTemplateId: templateId,
    templateType: isRepoTemplate ? 'repo-template' : 'html',
    businessName: answers.businessName || '',
    industry: answers.industry || '',
    targetAudience: answers.audience || '',
    offer: answers.offer || '',
    brandTone: answers.tone || '',
    colors: answers.colors || '',
    stylePreferences: answers.stylePreferences || '',
    pages: answers.pages || '',
    contact: answers.contact || '',
    domainPreference: answers.domain || '',
  });

  // ── Repo template: plan → answer sheet → generate → review → handoff ─────────
  const handleGenerateRepoTemplate = async () => {
    if (!aiConfigured) {
      setGenError('AI (OPENAI_API_KEY) is not configured on this server. Contact your administrator to enable AI generation.');
      return;
    }
    setGenerating(true);
    setGenError(null);

    try {
      const siteProfile = buildSiteProfile();

      // 1. Create a site plan from the collected answers
      const planResult = await createTemplateSitePlan({
        templateId,
        templateType: 'repo-template',
        brief: {
          businessName: siteProfile.businessName,
          industry: siteProfile.industry,
          targetAudience: siteProfile.targetAudience,
          offer: siteProfile.offer,
          brandTone: siteProfile.brandTone,
          colors: siteProfile.colors,
          stylePreferences: siteProfile.stylePreferences,
          pages: siteProfile.pages,
          contact: siteProfile.contact,
          domainPreference: siteProfile.domainPreference,
        },
      });
      const planId = planResult?.planId || planResult?.data?.planId;
      if (!planId) throw new Error('Could not create plan record.');

      // 2. Build answer sheet from plan brief
      await buildAnswerSheetForPlan(planId);

      // 3. AI-complete the answer sheet (fills gaps, improves copy)
      const generated = await generateAnswerSheetForPlan(planId);
      const sheet = generated?.answerSheet || generated?.data?.answerSheet;

      if (!sheet) throw new Error('AI did not return an answer sheet. Check OPENAI_API_KEY is set correctly.');

      // 4. Show review/edit screen
      setReviewAnswerSheet(sheet);
      setReviewPlanId(planId);
      setReviewMode(true);
    } catch (err) {
      // Surface clear AI config errors
      const msg = err.message || '';
      if (msg.includes('OPENAI_API_KEY') || msg.includes('not configured')) {
        setGenError('AI is not configured on this server (OPENAI_API_KEY missing). Contact your administrator.');
      } else {
        setGenError(msg || 'RoxanneAI generation failed. Please try again.');
      }
    } finally {
      setGenerating(false);
    }
  };

  // Called from review screen — user has confirmed/edited answer sheet, proceed to deploy
  const handleConfirmAndDeploy = async () => {
    if (!reviewPlanId) return;
    setConfirming(true);
    try {
      // Save any edits the user made back to the answer sheet
      if (reviewAnswerSheet) {
        await updateAnswerSheetForPlan(reviewPlanId, reviewAnswerSheet);
      }

      // Handoff — answer sheet is already generated, skip AI re-completion
      const handoff = await handoffTemplateSitePlan(reviewPlanId, { allowAiCompletion: false });
      const deploymentId = handoff?.deploymentId || handoff?.data?.deploymentId;
      const siteId = handoff?.siteId || handoff?.data?.siteId;

      if (deploymentId) {
        navigate({ view: 'hosting-detail', params: { id: deploymentId } });
      } else if (siteId) {
        navigate({ view: 'builder-deployment-settings', params: { siteId, templateId, templateType: 'repo-template' } });
      } else {
        navigate({ view: 'hosting-list' });
      }
    } catch (err) {
      setGenError(err.message || 'Handoff failed. Please try again.');
      setConfirming(false);
    }
  };

  // ── Legacy HTML template flow (unchanged) ────────────────────────────────────
  const handleGenerateHtmlTemplate = async () => {
    if (!aiConfigured) {
      setGenError('AI (OPENAI_API_KEY) is not configured on this server. Contact your administrator to enable AI generation.');
      return;
    }
    setGenerating(true);
    setGenError(null);

    try {
      const siteProfile = buildSiteProfile();
      const tailored = [];

      for (const page of tplPages) {
        const result = await generateTailoredTemplate(templateId, page.html || '', siteProfile);
        const tailoredHtml = result?.pages?.[0]?.html || page.html || '';
        tailored.push({ title: page.title || 'Home', path: page.path || '/', html: tailoredHtml });
      }

      const record = await createSiteFromTailoredTemplate(templateId, siteProfile, tailored);
      navigate({
        view: 'builder-deployment-settings',
        params: { siteId: record.siteId, templateId, templateType: 'html', tailored: true },
      });
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('OPENAI_API_KEY') || msg.includes('not configured')) {
        setGenError('AI is not configured on this server (OPENAI_API_KEY missing). Contact your administrator.');
      } else {
        setGenError(msg || 'RoxanneAI could not generate the copied template. Please try again.');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateAndContinue = async () => {
    if (generating) return;
    if (!minRequired) {
      setGenError('Please answer business name, industry, and products/services first.');
      return;
    }
    if (!aiConfigured) {
      setGenError('AI (OPENAI_API_KEY) is not configured on this server. Contact your administrator to enable RoxanneAI generation.');
      return;
    }
    if (isRepoTemplate) {
      return handleGenerateRepoTemplate();
    }
    if (!isHtml || tplPages.length === 0) {
      setGenError('This template is not ready for RoxanneAI generation yet. Choose Pulse Works or Forge.');
      return;
    }
    return handleGenerateHtmlTemplate();
  };

  if (generating) {
    return <RoxanneGeneratingLoader templateName={template?.name || templateId} />;
  }

  // Show answer sheet review screen
  if (reviewMode && reviewAnswerSheet) {
    return (
      <>
        <div className="page-head">
          <div>
            <a className="page-eyebrow" href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'builder-templates' }); }}>
              Site builder / Templates
            </a>
            <h1>Review AI-generated content</h1>
            <p className="sub">RoxanneAI has filled in your site content. Review and edit before generating your site.</p>
          </div>
        </div>
        <AnswerSheetReview
          answerSheet={reviewAnswerSheet}
          planId={reviewPlanId}
          onConfirm={handleConfirmAndDeploy}
          onEdit={() => {
            // Allow editing by going back to chat with existing answers intact
            setReviewMode(false);
          }}
          onBack={() => setReviewMode(false)}
          confirming={confirming}
        />
        {genError && (
          <div style={{ maxWidth: 680, margin: '16px auto', padding: '12px 16px', background: 'var(--bg-warn, #fff3cd)', borderRadius: 8, color: 'var(--text-warn, #664d03)', fontSize: 13 }}>
            ⚠ {genError}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <a className="page-eyebrow" href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'builder-templates' }); }}>
            Site builder / Templates
          </a>
          <h1>RoxanneAI setup for {template?.name || templateId}</h1>
          <p className="sub">
            Answer the editing questions. RoxanneAI will create a copied template draft, customize it, and send you to Hosting handoff.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-outline" onClick={() => navigate({ view: 'builder-templates' })}>← Back to templates</button>
        </div>
      </div>

      {/* AI config status banner */}
      {!settingsLoading && (
        <div style={{ maxWidth: 900, marginBottom: 16 }}>
          {aiConfigured === false ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-warn, #fff3cd)', border: '1px solid var(--border-warn, #ffc107)', borderRadius: 8, fontSize: 13, color: 'var(--text-warn, #664d03)' }}>
              <ICN.AlertCircle size={15} />
              <span>
                <strong>AI not configured.</strong> OPENAI_API_KEY is not set on this server.
                You can still fill in answers manually — but "Generate with RoxanneAI" will not work until the key is added.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'var(--accent-soft, #f0faf5)', border: '1px solid var(--accent, #0ea85a)', borderRadius: 8, fontSize: 12, color: 'var(--accent-ink, #0a5c33)' }}>
              <ICN.CheckCircle size={13} />
              <span>AI configured ({aiModel}) — RoxanneAI is ready.</span>
            </div>
          )}
        </div>
      )}

      <div className="ai-intake-layout">
        <aside className="ai-intake-sidebar">
          <div className="ai-intake-sidebar-section">
            <div className="label">Parent template</div>
            <div className="ai-intake-tpl-name">{template?.name || templateId}</div>
            {template?.tagline && <div className="ai-intake-tpl-tag">{template.tagline}</div>}
          </div>

          <div className="ai-intake-sidebar-section">
            <div className="label" style={{ marginBottom: 8 }}>Structured JSON data</div>
            <div className="ai-intake-answers">
              {QUESTIONS.map(q => (
                <div key={q.key} className={`ai-intake-answer-row${answers[q.key] ? ' filled' : ''}`}>
                  <span className="ai-intake-answer-label">{q.label}</span>
                  <span className="ai-intake-answer-value">{answers[q.key] || '—'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="ai-intake-sidebar-actions">
            <div className="ai-intake-progress">
              <div className="ai-intake-progress-bar" style={{ width: `${Math.round((Math.min(step, QUESTIONS.length) / QUESTIONS.length) * 100)}%` }} />
            </div>
            <div className="faint" style={{ fontSize: 12, marginBottom: 10 }}>
              {Math.min(step, QUESTIONS.length)} of {QUESTIONS.length} questions
            </div>
            <button
              className="btn btn-primary"
              onClick={handleGenerateAndContinue}
              disabled={!complete || !minRequired || !aiConfigured}
              title={
                !complete ? 'Finish the questions first'
                : !minRequired ? 'Business name, industry, and offer are required'
                : !aiConfigured ? 'AI (OPENAI_API_KEY) is not configured on this server'
                : ''
              }
            >
              <ICN.Sparkles size={14} /> Generate with RoxanneAI
            </button>
            {!aiConfigured && !settingsLoading && (
              <div style={{ fontSize: 12, color: 'var(--text-warn, #664d03)', marginTop: 8, lineHeight: 1.4 }}>
                AI not configured. Ask your administrator to set OPENAI_API_KEY on the server.
              </div>
            )}
            {genError && <div className="ai-intake-error">{genError}</div>}
          </div>
        </aside>

        <div className="ai-intake-chat">
          <div className="ai-intake-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`ai-intake-msg ai-intake-msg--${msg.role}`}>
                {msg.role === 'ai' && <div className="ai-intake-avatar"><ICN.Sparkles size={13} /></div>}
                <div className="ai-intake-bubble">
                  {msg.text.split('\n').map((line, j, arr) => (
                    <React.Fragment key={j}>{line}{j < arr.length - 1 && <br />}</React.Fragment>
                  ))}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {!complete ? (
            <div className="ai-intake-input-area">
              {suggestion && (
                <div className="ai-intake-suggestion">
                  <span className="ai-intake-suggestion-label">✨ AI suggestion</span>
                  <p className="ai-intake-suggestion-text">{suggestion.text}</p>
                  <div className="ai-intake-suggestion-actions">
                    <button className="btn btn-sm btn-primary" onClick={() => { setInput(suggestion.text); setSuggestion(null); inputRef.current?.focus(); }}>Use this</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setSuggestion(null)}>Dismiss</button>
                  </div>
                </div>
              )}
              {suggestError && <div className="ai-intake-suggest-error">{suggestError}</div>}
              <form className="ai-intake-input-row" onSubmit={handleSubmit}>
                <button
                  type="button"
                  className={`btn btn-outline ai-intake-suggest-btn${suggesting ? ' loading' : ''}`}
                  onClick={handleAiSuggest}
                  disabled={suggesting || !aiConfigured}
                  title={!aiConfigured ? 'AI not configured on this server' : 'Let RoxanneAI suggest an answer'}
                >
                  {suggesting ? '…' : '✨'} AI
                </button>
                <input ref={inputRef} className="input" value={input} onChange={e => setInput(e.target.value)} placeholder={QUESTIONS[step]?.question || 'Type your answer…'} />
                <button type="submit" className="btn btn-primary"><ICN.ArrowRight size={14} /></button>
                <button type="button" className="btn btn-ghost" onClick={() => sendAnswer('')} title="Skip this question">Skip</button>
              </form>
            </div>
          ) : (
            <div className="ai-intake-complete-bar">
              <span className="faint" style={{ fontSize: 13 }}>
                All questions answered.
                {aiConfigured
                  ? ' Generate the copied site to continue to Hosting handoff.'
                  : ' AI is not configured — contact your administrator to enable generation.'}
              </span>
              <button
                className="btn btn-primary"
                onClick={handleGenerateAndContinue}
                disabled={!minRequired || !aiConfigured}
                title={!aiConfigured ? 'AI (OPENAI_API_KEY) is not configured on this server' : ''}
              >
                <ICN.Sparkles size={14} /> Generate with RoxanneAI
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function slugify(value) { return String(value || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site'; }
