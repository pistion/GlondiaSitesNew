// BuilderGallery.jsx - guided Site Builder start screen.
import React from 'react';
import { ICN } from '../../../icons';
import { isFeatureEnabled } from '../../../app/features.js';

function ChoiceCard({ icon: Icon, eyebrow, title, body, points = [], action, onClick, tone = 'default', disabled = false }) {
  return (
    <button
      type="button"
      className={`card builder-choice-card builder-choice-card--${tone}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <div className="builder-choice-top">
        <div className="builder-choice-icon">
          <Icon size={20} />
        </div>
        {disabled ? <span className="badge warn"><span className="dot" />Next</span> : <span className="badge info"><span className="dot" />Ready</span>}
      </div>

      <div>
        <div className="page-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>
        <h2>{title}</h2>
        <p className="muted">{body}</p>
      </div>

      {points.length > 0 && (
        <div className="builder-choice-points">
          {points.map((point) => (
            <div key={point} className="builder-choice-point">
              <ICN.CheckCircle size={14} />
              <span>{point}</span>
            </div>
          ))}
        </div>
      )}

      <div className={`btn ${disabled ? 'btn-outline' : 'btn-primary'} builder-choice-action`}>
        {action} {!disabled && <ICN.ArrowRight size={14} />}
      </div>
    </button>
  );
}

export function BuilderGallery({ navigate }) {
  const showAi = isFeatureEnabled('aiBuilder');
  const showTemplates = isFeatureEnabled('siteBuilder');
  const showProjectFlow = isFeatureEnabled('builderProjectFlow');

  const cards = [
    showProjectFlow && {
      key: 'projects',
      icon: ICN.Folder,
      eyebrow: 'Project history',
      title: 'Your saved projects',
      body: 'Open previous work, continue draft plans, review generated revisions, approve previews, and deploy when ready.',
      points: ['Saved to the server', 'Resume after refresh', 'Plan, generate, preview, deploy'],
      action: 'Open projects',
      onClick: () => navigate({ view: 'builder-project', params: {} }),
      tone: 'projects',
    },
    showTemplates && {
      key: 'templates',
      icon: ICN.Layers,
      eyebrow: 'Template first',
      title: 'Choose templates',
      body: 'Preview real parent templates like Pulse Works and Forge, then customize the copied version for the client.',
      points: ['Shows only real templates', 'Preview before editing', 'Current production flow'],
      action: 'Choose a template',
      onClick: () => navigate({ view: 'builder-templates' }),
      tone: 'templates',
    },
    showAi && {
      key: 'roxanne',
      icon: ICN.Sparkles,
      eyebrow: 'AI first',
      title: 'Build with RoxanneAI',
      body: 'Describe the business, audience, pages, and tone. RoxanneAI turns it into an editable site draft.',
      points: ['Guided business questions', 'Good with no content yet', 'Routes into the build flow'],
      action: 'Start RoxanneAI',
      onClick: () => navigate({ view: 'builder-roxanne' }),
      tone: 'ai',
    },
  ].filter(Boolean);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Site builder</div>
          <h1>Choose how to build your site</h1>
          <p className="sub">
            Continue saved work, start from a real template, or let RoxanneAI shape the first version before Hosting.
          </p>
        </div>
      </div>

      <div className="builder-start-grid">
        {cards.map((card) => (
          <ChoiceCard
            key={card.key}
            icon={card.icon}
            eyebrow={card.eyebrow}
            title={card.title}
            body={card.body}
            points={card.points}
            action={card.action}
            onClick={card.onClick}
            tone={card.tone}
          />
        ))}
      </div>
    </>
  );
}
