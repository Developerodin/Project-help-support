'use client';

import { useState } from 'react';

export default function TicketComments({ ticket, onAdd }) {
  const [content, setContent] = useState('');

  function submit() {
    if (!content.trim()) return;
    // A fresh UUID per submission: a retried request is a no-op server-side
    // rather than a duplicate comment.
    onAdd({ content, clientRef: crypto.randomUUID() });
    setContent('');
  }

  return (
    <section>
      <h2>Comments</h2>

      {ticket.comments.map((comment) => (
        <article key={comment._id || comment.id} style={{ marginBottom: 8 }}>
          <strong>{comment.commentedBy?.name || 'Someone'}</strong>{' '}
          <small style={{ color: 'var(--muted)' }}>
            {new Date(comment.createdAt).toLocaleString()}
            {comment.editedAt && ' (edited)'}
          </small>
          <div>{comment.content}</div>
        </article>
      ))}

      <label htmlFor="new-comment">Add a comment</label>
      <textarea id="new-comment" rows={3} style={{ width: '100%' }}
        value={content} onChange={(e) => setContent(e.target.value)} />
      <button type="button" onClick={submit}>Comment</button>
    </section>
  );
}
