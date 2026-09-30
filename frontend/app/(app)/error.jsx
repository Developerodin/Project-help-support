'use client';

import { useEffect } from 'react';

/** A page inside the app threw while rendering. The sidebar and header stay up. */
export default function AppError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="empty-state" role="alert">
      <h3>Something went wrong</h3>
      <p>This page could not load. Try again, or come back in a moment.</p>
      <button type="button" className="btn btn-primary" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
