import Link from 'next/link';
import BrandMark from '@/shared/components/brand-mark.jsx';
import { BRAND_NAME } from '@/shared/lib/brand.js';
import { LEGAL_COMPANY, LEGAL_CONTACT_EMAIL, LEGAL_UPDATED } from '@/shared/lib/legal.js';

const DOCS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/data-deletion', label: 'Data deletion' },
];

const num = (i) => String(i + 1).padStart(2, '0');

/**
 * One legal document: title block, optional summary, numbered sections with a
 * contents list, and a contact footer. Server-rendered so review bots read it.
 * sections: [{ id, title, body }]; summary: [{ term, detail }] (optional).
 */
export default function LegalDoc({
  current, kicker, title, lede, summary, sections,
}) {
  return (
    <div className="legal">
      <header className="legal-top">
        <Link href="/" className="legal-top__brand">
          <BrandMark name={BRAND_NAME} />
          <b>{BRAND_NAME}</b>
        </Link>
        <nav aria-label="Legal documents" className="legal-top__docs">
          {DOCS.map((doc) => (
            <Link key={doc.href} href={doc.href} aria-current={doc.href === current ? 'page' : undefined}>
              {doc.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="legal-title">
        <p className="legal-kicker">{kicker}</p>
        <h1>{title}</h1>
        <p className="legal-lede">{lede}</p>
        <p className="legal-meta">
          <span>{LEGAL_COMPANY}</span>
          <span aria-hidden="true">·</span>
          <span>Updated {LEGAL_UPDATED}</span>
        </p>
      </div>

      {summary ? (
        <section className="legal-summary" aria-labelledby="legal-summary-title">
          <h2 id="legal-summary-title">In short</h2>
          <dl>
            {summary.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>{item.detail}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <div className="legal-grid">
        <nav className="legal-toc" aria-label="On this page">
          <p>On this page</p>
          <ol>
            {sections.map((section, i) => (
              <li key={section.id}>
                <a href={`#${section.id}`}><span>{num(i)}</span>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="legal-body">
          {sections.map((section, i) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
              <h2 id={`${section.id}-title`}><span className="legal-num">{num(i)}</span>{section.title}</h2>
              {section.body}
            </section>
          ))}

          <footer className="legal-contact">
            <div>
              <h2>Questions?</h2>
              <p>Write to us about privacy, your data, or these terms.</p>
            </div>
            <a className="btn btn-primary" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
          </footer>
        </article>
      </div>
    </div>
  );
}
