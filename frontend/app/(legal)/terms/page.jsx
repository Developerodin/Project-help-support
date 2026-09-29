import Link from 'next/link';
import { BRAND_NAME } from '@/shared/lib/brand.js';
import { LEGAL_COMPANY } from '@/shared/lib/legal.js';
import LegalDoc from '../legal-doc.jsx';

export const metadata = { title: `Terms of service · ${BRAND_NAME}` };

const sections = [
  {
    id: 'account',
    title: 'Your account',
    body: (
      <ul>
        <li>Your organisation’s administrator creates your account and decides what you can access.</li>
        <li>Keep your sign-in details to yourself, and tell your administrator if you think someone else has used your account.</li>
        <li>If you link WhatsApp, link only a number you own and control, and unlink it if you stop using that number.</li>
      </ul>
    ),
  },
  {
    id: 'use',
    title: 'Acceptable use',
    body: (
      <>
        <p>Don’t use {BRAND_NAME} to:</p>
        <ul>
          <li>reach data you aren’t allowed to see, or get around access controls;</li>
          <li>upload anything unlawful, harmful, or that you have no right to share;</li>
          <li>disrupt the service, or send it automated traffic beyond normal use;</li>
          <li>use the assistant for anything other than your work in {BRAND_NAME}.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'assistant',
    title: 'The assistant',
    body: (
      <p>
        The assistant answers from the data your account can see, and it can make mistakes. Check important details in the app before relying on them.
        On WhatsApp it can look things up and file new tickets you confirm; other changes are made in the app. WhatsApp’s own terms also apply to your use of WhatsApp.
      </p>
    ),
  },
  {
    id: 'data',
    title: 'Your data',
    body: (
      <p>
        Your organisation owns the work it puts in {BRAND_NAME}. We handle personal data as described in the <Link href="/privacy">privacy policy</Link>.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Availability and changes',
    body: (
      <p>
        We work to keep {BRAND_NAME} available but can’t promise it will be uninterrupted or error-free. We may change or suspend features,
        and may suspend accounts that break these terms. When the terms change, we update this page.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Liability',
    body: (
      <p>
        To the extent the law allows, {BRAND_NAME} is provided “as is”, and {LEGAL_COMPANY} is not liable for indirect or consequential losses
        arising from its use.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDoc
      current="/terms"
      kicker="Terms of service"
      title="Using ProwPlus"
      lede={`The rules for using ${BRAND_NAME} and its assistant, in the app and on WhatsApp. Using ${BRAND_NAME} means you agree to them.`}
      sections={sections}
    />
  );
}
