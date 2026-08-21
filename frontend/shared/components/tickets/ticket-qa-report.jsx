'use client';

import { stageLabel } from '@pms/shared';
import Icon from '../icons.jsx';
import { formatFileSize } from '@/shared/lib/attachment-config.js';
import { formatWhen } from './ticket-drawer-utils.js';
import { TicketAttachmentImage, TicketAttachmentLink } from './ticket-attachment.jsx';

const isImage = (file) => {
  const mime = file.mimeType || file.type || '';
  if (mime.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|ico)$/i.test(file.name || '');
};

/**
 * Rejections come straight off stageHistory — the move IS the report, so there
 * is nothing to keep in sync. External responses drop `decision`, `note` and
 * the evidence entirely, so this list is empty for a client even if the tab
 * were somehow rendered for one.
 */
export function qaRejections(ticket) {
  return (ticket.stageHistory || [])
    .filter((entry) => entry.decision === 'rejected')
    .slice()
    .reverse();
}

function ReportAttachment({ ticketId, file }) {
  const attachmentId = file._id || file.id;
  if (!attachmentId) return null;

  if (isImage(file)) {
    return (
      <TicketAttachmentImage
        ticketId={ticketId}
        attachmentId={attachmentId}
        alt={file.name}
        className="attach attach-img"
      >
        <span className="nm">{file.name}</span>
        {file.size != null && <span className="sz">{formatFileSize(file.size)}</span>}
      </TicketAttachmentImage>
    );
  }

  return (
    <span className="attach">
      <Icon name="clip" size={12} aria-hidden="true" />
      <TicketAttachmentLink ticketId={ticketId} attachmentId={attachmentId}>
        {file.name}
      </TicketAttachmentLink>
      {file.size != null && <span className="sz">{formatFileSize(file.size)}</span>}
    </span>
  );
}

export default function TicketQaReport({ ticket }) {
  const rejections = qaRejections(ticket);

  return (
    <section className="qa-tab" aria-label="QA report">
      <p className="qa-tab-cue">
        <Icon name="lock" size={12} aria-hidden="true" />
        <span>Internal team only. Clients never see these reports.</span>
      </p>

      {rejections.length === 0 ? (
        <p className="meta">QA has not rejected this ticket.</p>
      ) : (
        <ol className="qa-list">
          {rejections.map((entry, index) => (
            <li key={entry.id || entry._id || `${entry.at}-${index}`} className="qa-item">
              <div className="qa-item-head">
                <span className="qa-item-who">{entry.by?.name || 'Someone'}</span>
                <span className="qa-item-move">
                  {stageLabel(entry.from)}
                  {' → '}
                  {stageLabel(entry.to)}
                </span>
                {entry.at && (
                  <time className="when" dateTime={entry.at}>{formatWhen(entry.at)}</time>
                )}
              </div>

              {entry.note && <p className="qa-item-note">{entry.note}</p>}

              {entry.attachments?.length > 0 && (
                <div className="qa-item-files">
                  {entry.attachments.map((file) => (
                    <ReportAttachment
                      key={file._id || file.id || file.name}
                      ticketId={ticket.ticketId}
                      file={file}
                    />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
