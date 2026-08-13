'use client';

import { useState } from 'react';
import { initials } from '../icons.jsx';

export default function TicketComments({ ticket, onAdd }) {
  const [content, setContent] = useState('');

  function submit() {
    if (!content.trim()) return;
    onAdd({ content, clientRef: crypto.randomUUID() });
    setContent('');
  }

  return (
    <section>
      <h2>Comments</h2>
      {ticket.comments.map((comment) => (
        <article key={comment._id || comment.id} className="comment">
          <div className="avatar sm">{initials(comment.commentedBy?.name)}</div>
          <div>
            <strong>{comment.commentedBy?.name || 'Someone'}</strong>{' '}
            <span className="meta">{new Date(comment.createdAt).toLocaleString()}
              {comment.editedAt && ' (edited)'}</span>
            <p>{comment.content}</p>
          </div>
        </article>
      ))}

      <div className="composer">
        <textarea
          id="new-comment"
          rows={3}
          placeholder="Add a comment. Type @ to notify someone."
          aria-label="Add a comment"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="composer-foot">
          <span className="spacer" />
          <button type="button" className="btn btn-primary btn-sm" onClick={submit}>Comment</button>
        </div>
      </div>
    </section>
  );
}
