'use client';

import './globals.css';
import { useEffect } from 'react';

/** The root layout itself failed, so this renders its own html and body. */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: 520, margin: '15vh auto', padding: '0 16px' }}>
          <div className="empty-state" role="alert">
            <h3>Something went wrong</h3>
            <p>The app could not load. Try again, or refresh the page in a moment.</p>
            <button type="button" className="btn btn-primary" onClick={() => reset()}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
