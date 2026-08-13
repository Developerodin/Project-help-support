'use client';

import { useRef } from 'react';
import { API_URL } from '@/shared/lib/env.js';
import { attachmentDownloadUrl } from '@/shared/api/tickets.js';

export default function TicketAttachments({ ticket, onUpload }) {
  const input = useRef(null);

  function submit() {
    const files = input.current?.files;
    if (!files?.length) return;

    const form = new FormData();
    for (const file of files) form.append('files', file);
    form.append('clientRef', crypto.randomUUID());
    onUpload(form);
    input.current.value = '';
  }

  return (
    <section>
      <h2>Attachments</h2>

      <ul>
        {ticket.attachments.map((attachment) => (
          <li key={attachment._id || attachment.id}>
            {/* The download endpoint authorizes and THEN 302s to a short-lived
                presigned URL. No URL is stored anywhere. */}
            <a href={`${API_URL}${attachmentDownloadUrl(ticket.ticketId, attachment._id || attachment.id)}`}>
              {attachment.name}
            </a>
          </li>
        ))}
      </ul>

      <input ref={input} type="file" multiple aria-label="Add attachments" />
      <button type="button" onClick={submit}>Upload</button>
    </section>
  );
}
