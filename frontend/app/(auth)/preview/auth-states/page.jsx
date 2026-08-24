'use client';

import { Suspense, useMemo } from 'react';
import { notFound, useSearchParams } from 'next/navigation';
import AppLoader from '@/shared/components/app-loader.jsx';
import AuthRequiredScreen from '@/shared/components/auth/auth-required-screen.jsx';
import SessionExpiredScreen from '@/shared/components/auth/session-expired-screen.jsx';

const FRAMES = [
  { id: 'loading', label: 'Loading', caption: 'AUTH_BOOTING · AppLoader' },
  { id: 'required', label: 'Sign in required', caption: 'AUTH_REQUIRED · cold visit' },
  { id: 'expired', label: 'Session expired', caption: 'AUTH_EXPIRED · interrupt' },
];

function FakeWorkspace() {
  return (
    <div className="auth-preview-workspace" aria-hidden="true">
      <aside className="auth-preview-workspace__rail">
        <b>ProwPlus</b>
        <span>Board</span>
        <span>Tickets</span>
        <span>Projects</span>
        <span>Teams</span>
      </aside>
      <div className="auth-preview-workspace__main">
        <header>Mobile App Redesign</header>
        <div className="auth-preview-workspace__lanes">
          <section>
            <h3>Backlog</h3>
            <article>MOB-241 Invite flow copy</article>
            <article>MOB-242 Attachment upload</article>
          </section>
          <section>
            <h3>In progress</h3>
            <article>MOB-243 API timeout on refresh</article>
          </section>
          <section>
            <h3>In review</h3>
            <article>MOB-244 Board filters</article>
          </section>
        </div>
      </div>
    </div>
  );
}

function AuthStateFrame({ id }) {
  if (id === 'loading') return <AppLoader />;
  if (id === 'required') return <AuthRequiredScreen />;
  return (
    <>
      <FakeWorkspace />
      <SessionExpiredScreen />
    </>
  );
}

function AuthStatesPreviewInner() {
  const searchParams = useSearchParams();
  const frame = searchParams.get('frame');
  const embed = searchParams.get('embed') === '1';
  const active = useMemo(() => FRAMES.find((item) => item.id === frame) ?? null, [frame]);

  if (process.env.NODE_ENV === 'production') notFound();

  if (active) {
    return (
      <div className="auth-preview-solo">
        {embed ? null : (
          <a className="auth-preview-solo__back" href="/preview/auth-states">All three states</a>
        )}
        <AuthStateFrame id={active.id} />
      </div>
    );
  }

  return (
    <div className="auth-preview">
      <header className="auth-preview__head">
        <p className="auth-preview__eyebrow">Preview</p>
        <h1>Authentication states</h1>
        <p>The three production surfaces. Each pane is the real component, isolated in its own viewport.</p>
      </header>
      <div className="auth-preview__grid">
        {FRAMES.map((item) => (
          <figure key={item.id} className="auth-preview__pane">
            <figcaption>
              <strong>{item.label}</strong>
              <span>{item.caption}</span>
              <a href={`/preview/auth-states?frame=${item.id}`}>Open full screen</a>
            </figcaption>
            <iframe
              title={item.label}
              src={`/preview/auth-states?frame=${item.id}&embed=1`}
              className="auth-preview__frame"
            />
          </figure>
        ))}
      </div>
    </div>
  );
}

export default function AuthStatesPreviewPage() {
  return (
    <Suspense fallback={<AppLoader />}>
      <AuthStatesPreviewInner />
    </Suspense>
  );
}
