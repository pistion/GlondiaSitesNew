// TemplateGallery.jsx — Real template picker for the Site Builder.
import React, { useEffect, useState as useStateB } from 'react';
import { ICN } from '../../../icons';
import { TEMPLATES_REPO } from '../../../data';
import { Empty } from '../../../components';
import { useTemplates } from '../../../use-templates';
import { listTemplateHostingTemplates } from '../../../api/template-ai.js';

function TemplateCardPreview({ tpl }) {
  const pages = Array.isArray(tpl?.contentJson?.pages) ? tpl.contentJson.pages : [];
  const firstPage = pages[0];

  if (!firstPage?.html) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--bg-deep)', color: 'var(--text-muted)' }}>
        <ICN.Image size={22} />
        <span style={{ fontSize: 11 }}>Preview unavailable</span>
      </div>
    );
  }

  return (
    <iframe
      sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
      srcDoc={firstPage.html}
      style={{ width: '900px', height: '600px', border: 'none', transform: 'scale(0.245)', transformOrigin: 'top left', pointerEvents: 'none', display: 'block' }}
      title={`${tpl.name} preview`}
    />
  );
}

function TemplatePreviewModal({ template, onClose, onHost, onConfigure }) {
  const pages = Array.isArray(template?.contentJson?.pages) ? template.contentJson.pages : [];
  const [activePage, setActivePage] = useStateB(pages[0] || null);

  React.useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="tpl-preview-modal-backdrop" onClick={onClose}>
      <div className="tpl-preview-modal-header" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-icon btn-ghost" onClick={onClose} title="Close (Esc)">
          <ICN.X size={16} />
        </button>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{template.name}</div>
        {template.tagline && <div className="muted" style={{ fontSize: 13 }}>{template.tagline}</div>}
        {pages.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 16 }}>
            {pages.map((page, i) => (
              <button key={i} className={`btn btn-sm ${activePage === page ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActivePage(page)}>
                {page.title || `Page ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-outline" onClick={() => onHost && onHost(template)}>
          Plan with this template
        </button>
        <button className="btn btn-primary" onClick={() => onConfigure && onConfigure(template)}>
          <ICN.Wand2 size={14} /> Configure with AI
        </button>
      </div>
      <div className="tpl-preview-modal-body" onClick={(e) => e.stopPropagation()}>
        <iframe
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          srcDoc={activePage?.html || '<!doctype html><html><body></body></html>'}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          title={`${template.name} full preview`}
        />
      </div>
    </div>
  );
}

export function BuilderTemplates({ navigate }) {
  const { templates, loading } = useTemplates();
  const [cat, setCat] = useStateB('All');
  const [previewTpl, setPreviewTpl] = useStateB(null);
  const [repoTemplates, setRepoTemplates] = useStateB([]);

  const htmlTemplates = templates.filter(t => t.contentJson?._source === 'html-template');
  useEffect(() => {
    listTemplateHostingTemplates()
      .then((result) => setRepoTemplates((result.templates || []).map((tpl) => ({
        id: tpl.templateId,
        name: tpl.name,
        category: tpl.category,
        tagline: tpl.description || `${tpl.framework || 'Website'} template`,
        previewImage: tpl.previewImage,
        contentJson: { _source: 'template-library-repo', pages: [] },
      }))))
      .catch(() => setRepoTemplates([]));
  }, []);

  const displayTemplates = [...repoTemplates, ...htmlTemplates.filter((tpl) => !repoTemplates.some((repoTpl) => repoTpl.id === tpl.id))];
  const cats = ['All', ...Array.from(new Set(displayTemplates.map(t => t.category).filter(Boolean)))];
  const filtered = cat === 'All' ? displayTemplates : displayTemplates.filter(t => t.category === cat);

  const handleHostTemplate = (t) => {
    setPreviewTpl(null);
    navigate({ view: 'builder-site-plan', params: { templateId: t.id, templateType: t.contentJson?._source === 'template-library-repo' ? 'repo-template' : 'html' } });
  };

  const handleConfigureTemplate = (t) => {
    setPreviewTpl(null);
    navigate({ view: 'builder-ai-intake', params: { templateId: t.id, templateType: t.contentJson?._source === 'template-library-repo' ? 'repo-template' : 'html' } });
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
            <h1>Pick a template</h1>
            <p className="sub">Choose a real template, preview it, customize it with AI, then deploy it to your domain.</p>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '14px 16px', marginBottom: 18 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Real templates only</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
          Placeholder storefront designs are hidden until they are converted into real master templates. Current live templates: Pulse Works and Forge.
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Website templates</h2>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
              Preview the parent template first. AI customization creates a copied draft after you choose one.
            </p>
          </div>
          {cats.length > 2 && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {cats.map(c => (
                <button key={c} onClick={() => setCat(c)} className="btn btn-sm" style={{ border: `1px solid ${cat === c ? 'var(--accent)' : 'var(--border)'}`, background: cat === c ? 'var(--accent-soft)' : 'var(--bg-elev)', color: cat === c ? 'var(--accent-ink)' : 'var(--text)', fontWeight: 500 }}>
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="tpl-grid">
            {[1, 2].map(i => (
              <div key={i} className="tpl-card" style={{ opacity: 0.5 }}>
                <div className="tpl-thumb" style={{ background: 'var(--bg-deep)' }} />
                <div className="tpl-body">
                  <div style={{ height: 16, background: 'var(--bg-deep)', borderRadius: 4, width: '60%', marginBottom: 8 }} />
                  <div style={{ height: 12, background: 'var(--bg-deep)', borderRadius: 4, width: '90%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : displayTemplates.length === 0 ? (
          <div className="card" style={{ padding: '48px 24px' }}>
            <Empty icon="Layers" title="No real templates yet" body="Real HTML master templates will appear here once they are added to the builder template registry." action={TEMPLATES_REPO ? <a href={TEMPLATES_REPO} target="_blank" rel="noopener noreferrer" className="btn btn-outline"><ICN.Git size={14} /> View template repo</a> : null} />
          </div>
        ) : (
          <div className="tpl-grid">
            {filtered.map(t => (
              <div className="tpl-card tpl-card--clickable" key={t.id} onClick={() => setPreviewTpl(t)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setPreviewTpl(t)}>
                <div className="tpl-thumb tpl-thumb--iframe"><TemplateCardPreview tpl={t} /></div>
                <div className="tpl-body">
                  <div className="row between"><h4>{t.name}</h4><span className="faint" style={{ fontSize: 11 }}>{t.category}</span></div>
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t.tagline}</p>
                  <div className="tag-row">
                    <span className="ttag" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: '1px solid var(--accent)' }}>{t.contentJson?._source === 'template-library-repo' ? 'Repo template' : 'Real HTML'}</span>
                    {Array.isArray(t.contentJson?.pages) && <span className="ttag">{t.contentJson.pages.length} {t.contentJson.pages.length === 1 ? 'page' : 'pages'}</span>}
                    <span className="ttag">AI ready</span>
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 12 }}>
                    <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={(e) => { e.stopPropagation(); setPreviewTpl(t); }}>
                      <ICN.Eye size={12} /> Preview {t.name}
                    </button>
                    <button className="btn btn-sm btn-outline" title="Preview template" onClick={(e) => { e.stopPropagation(); setPreviewTpl(t); }}>
                      <ICN.Eye size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {previewTpl && <TemplatePreviewModal template={previewTpl} onClose={() => setPreviewTpl(null)} onHost={handleHostTemplate} onConfigure={handleConfigureTemplate} />}
    </>
  );
}
