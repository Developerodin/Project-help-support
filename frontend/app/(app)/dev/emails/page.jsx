'use client';

import { useMemo, useState } from 'react';
import { listEmailPreviews } from '@pms/shared/email';
import { useAuth } from '@/shared/contexts/auth-context.jsx';

/**
 * Real messages carry the mark as an attachment and reference it as
 * cid:prowplus-icon. A browser cannot resolve a cid, and a srcDoc iframe cannot
 * resolve a relative path either, so point it at the served copy absolutely.
 */
function previewHtml(html) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return html.replaceAll('cid:prowplus-icon', `${origin}/prowplus-icon.png`);
}

// The two widths that decide whether an email holds up: a desktop reading pane
// and a phone. Anything between behaves like one of them.
const WIDTHS = [
  { id: 'desktop', label: 'Desktop', px: null },
  { id: 'mobile', label: 'Mobile', px: 390 },
];

function EmailPreviewFrame({ html, title, width }) {
  // A fixed height crops the email mid-button and makes the preview lie about
  // the template. Measure the rendered document instead; the key remounts the
  // frame on every template or width change so onLoad fires again.
  const [height, setHeight] = useState(600);

  const fitToContent = (event) => {
    const doc = event.currentTarget.contentDocument;
    if (doc?.body) setHeight(doc.body.scrollHeight + 2);
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <iframe
        key={`${title}-${width ?? 'full'}`}
        title={title}
        srcDoc={html}
        sandbox="allow-same-origin"
        onLoad={fitToContent}
        scrolling="no"
        style={{
          width: width ? `${width}px` : '100%',
          maxWidth: '100%',
          height: `${height}px`,
          border: '1px solid var(--rule)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--canvas)',
        }}
      />
    </div>
  );
}

export default function EmailPreviewPage() {
  const { user } = useAuth();
  // Sample links point at wherever this app is actually served from, so the
  // previews never carry a hardcoded host. Same window guard as previewHtml.
  const previews = useMemo(
    () => listEmailPreviews(typeof window === 'undefined' ? undefined : window.location.origin),
    [],
  );
  const [activeId, setActiveId] = useState(previews[0]?.id ?? 'invite');
  const [viewport, setViewport] = useState('desktop');
  const active = previews.find((item) => item.id === activeId) ?? previews[0];
  const frameWidth = WIDTHS.find((w) => w.id === viewport)?.px ?? null;

  if (process.env.NODE_ENV === 'production' || user?.role !== 'admin') {
    return (
      <div className="page">
        <h1>Email previews</h1>
        <p>This page is available to admins in development only.</p>
      </div>
    );
  }

  const groups = previews.reduce((acc, item) => {
    acc[item.category] = acc[item.category] || [];
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div className="page email-preview-page">
      <header className="email-preview-page__head">
        <h1>Email previews</h1>
        <p className="sub">
          Branded HTML layouts for every email sent from Dharwin PMS — warm paper palette, pipeline rail, and detail tables.
        </p>
      </header>

      <div className="email-preview-page__layout">
        <aside className="email-preview-page__nav" aria-label="Email types">
          {Object.entries(groups).map(([category, items]) => (
            <div className="email-preview-page__group" key={category}>
              <span className="email-preview-page__cap">{category}</span>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`email-preview-page__link${item.id === active?.id ? ' is-active' : ''}`}
                  onClick={() => setActiveId(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <section className="email-preview-page__panel">
          {active ? (
            <>
              <div className="email-preview-page__meta">
                <div className="email-preview-page__meta-head">
                  <span className="email-preview-page__badge">{active.category}</span>
                  <h2>{active.label}</h2>
                </div>
                <p><strong>Subject:</strong> {active.subject}</p>
                <div className="email-preview-page__widths" role="group" aria-label="Preview width">
                  {WIDTHS.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      className={`email-preview-page__width${w.id === viewport ? ' is-active' : ''}`}
                      aria-pressed={w.id === viewport}
                      onClick={() => setViewport(w.id)}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <EmailPreviewFrame html={previewHtml(active.html)} title={active.label} width={frameWidth} />
              <details className="email-preview-page__plain">
                <summary>Plain text fallback</summary>
                <pre>{active.text}</pre>
              </details>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}