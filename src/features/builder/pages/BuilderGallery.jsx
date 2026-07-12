// BuilderGallery.jsx — guided Site Builder start screen.
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
      style={{
        textAlign: 'left',
        padding: 22,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        opacity: disabled ? 0.68 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        minHeight: 260,
      }}
    >
      <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} />
        </div>
        {disabled ? <span className="badge warn"><span className="dot" />Next</span> : <span className="badge info"><span className="dot" />Ready</span>}
      </div>

      <div>
        <div className="page-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>
        <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.55 }}>{body}</p>
      </div>

      {points.length > 0 && (
        <div style={{ display: 'grid', gap: 7, marginTop: 'auto' }}>
          {points.map((point) => (
            <div key={point} className="row" style={{ gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
              <ICN.CheckCircle size={14} style={{ color: 'var(--accent)' }} />
              <span>{point}</span>
            </div>
          ))}
        </div>
      )}

      <div className={`btn ${disabled ? 'btn-outline' : 'btn-primary'}`} style={{ justifyContent: 'center', marginTop: 6 }}>
        {action} {!disabled && <ICN.ArrowRight size={14} />}
      </div>
    </button>
  );
}

export function BuilderGallery({ navigate }) {
  const showAi = isFeatureEnabled('aiBuilder');
  // Template picker is part of the core Site Builder surface.
  const showTemplates = isFeatureEnabled('siteBuilder');
  // Canonical durable project flow (refresh-safe projects). When on, it is the
  // recommended production path and replaces the transient template setup.
  const showProjectFlow = isFeatureEnabled('builderProjectFlow');
  const visibleCount = Math.max(1, (showAi ? 1 : 0) + (showTemplates ? 1 : 0));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Site builder</div>
          <h1>Choose how to build your site</h1>
          <p className="sub">
            Start with a template or use RoxanneAI to shape the first version before sending it to Hosting.
          </p>
        </div>
      </div>

      {showProjectFlow && (
        <div className="card" style={{ padding: '16px 18px', marginBottom: 18, borderColor: 'var(--accent)' }}>
          <div className="row between" style={{ alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700 }}>Your saved projects</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                Durable projects that save to the server and resume after refresh — plan, generate, preview, approve, and deploy.
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => navigate({ view: 'builder-project', params: {} })}>
              Open projects
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: '14px 16px', marginBottom: 18 }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ICN.Sparkles size={16} />
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>Recommended path</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
              Choose templates here. Existing projects from GitHub or ZIP upload now live under Hosting.
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${visibleCount}, minmax(0, 1fr))`, gap: 16 }}>
        {showAi && (
          <ChoiceCard
            icon={ICN.Sparkles}
            eyebrow="AI first"
            title="Create with RoxanneAI"
            body="Start from a guided AI website session. RoxanneAI collects the business idea first, then helps route the client into the right website build path."
            points={['Guided business questions', 'Good for clients with no content', 'Can connect to templates next']}
            action="Start with RoxanneAI"
            onClick={() => navigate({ view: 'builder-roxanne' })}
            tone="ai"
          />
        )}

        {showTemplates && (
          <ChoiceCard
            icon={ICN.Layers}
            eyebrow="Template first"
            title="Choose templates"
            body="Preview real parent templates like Pulse Works and Forge, then use RoxanneAI to customize the copied version for the client."
            points={['Shows only real templates', 'Preview before AI editing', 'Best current production flow']}
            action="Choose a template"
            onClick={() => navigate({ view: 'builder-templates' })}
            tone="templates"
          />
        )}
      </div>
    </>
  );
}
