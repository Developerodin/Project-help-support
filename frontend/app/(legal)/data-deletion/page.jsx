import { BRAND_NAME } from '@/shared/lib/brand.js';
import { LEGAL_CONTACT_EMAIL } from '@/shared/lib/legal.js';
import LegalDoc from '../legal-doc.jsx';

export const metadata = { title: `Data deletion · ${BRAND_NAME}` };

const sections = [
  {
    id: 'whatsapp',
    title: 'Unlink WhatsApp',
    body: (
      <p>
        In {BRAND_NAME}, open your profile and choose <strong>Unlink</strong> in the WhatsApp section. Your WhatsApp number and user ID are
        removed immediately and the assistant stops answering that number. The recent conversation deletes itself within 30&nbsp;minutes.
      </p>
    ),
  },
  {
    id: 'account',
    title: 'Delete your account and data',
    body: (
      <>
        <p>
          Email <a href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent(`${BRAND_NAME} data deletion`)}`}>{LEGAL_CONTACT_EMAIL}</a> from
          the address on your account and say what you want deleted. We’ll confirm we received it and reply within 30&nbsp;days.
        </p>
        <p>
          Tickets and comments belong to your organisation’s projects, so your organisation’s administrator may need to approve deleting them.
          Anything the law requires us to keep is kept only as long as required.
        </p>
      </>
    ),
  },
];

export default function DataDeletionPage() {
  return (
    <LegalDoc
      current="/data-deletion"
      kicker="Data deletion"
      title="Deleting your data"
      lede="Remove your WhatsApp link yourself in seconds, or ask us to delete your account data."
      sections={sections}
    />
  );
}
