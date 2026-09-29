import Link from 'next/link';
import { BRAND_NAME } from '@/shared/lib/brand.js';
import { LEGAL_COMPANY } from '@/shared/lib/legal.js';
import LegalDoc from '../legal-doc.jsx';

export const metadata = { title: `Privacy policy · ${BRAND_NAME}` };

const summary = [
  { term: 'No selling, no ads', detail: 'Your data is used only to run ProwPlus.' },
  { term: 'Your access, nothing more', detail: 'The assistant sees only what your account can see in the app.' },
  { term: 'Read-only on WhatsApp', detail: 'It can look things up there, never change anything.' },
  { term: 'Short memory', detail: 'WhatsApp conversations are deleted after 30 minutes.' },
];

const sections = [
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <ul>
        <li><strong>Account details:</strong> your name, email address, role, and the teams, clients and projects you belong to. Your organisation’s administrator creates your account.</li>
        <li><strong>Work you put in the app:</strong> tickets, comments, attachments, reports and settings.</li>
        <li><strong>Notifications:</strong> your email and in-app preferences, and a push subscription for each device where you turn notifications on.</li>
        <li><strong>Assistant conversations:</strong> what you type or say to the assistant, and its replies.</li>
        <li><strong>WhatsApp, if you link it:</strong> your WhatsApp number, the user ID WhatsApp gives us for you, and the messages you exchange with our WhatsApp number.</li>
        <li><strong>Technical logs:</strong> requests to our servers with times and error details, kept to run and secure the service.</li>
      </ul>
    ),
  },
  {
    id: 'use',
    title: 'How we use it',
    body: (
      <p>
        Only to provide {BRAND_NAME}: showing you the projects and tickets you have access to, sending the notifications you ask for,
        answering your questions through the assistant, and keeping the service secure. We don’t sell your data or use it for advertising.
      </p>
    ),
  },
  {
    id: 'assistant',
    title: 'The assistant and WhatsApp',
    body: (
      <ul>
        <li>The assistant works with the same access as your account. On WhatsApp it can look things up but can’t create, change or delete anything.</li>
        <li>To write a reply, your message and the app data it needs are sent to OpenAI. We ask OpenAI not to store these requests.</li>
        <li>Voice input in the app is sent to OpenAI to be turned into text. We don’t keep the recordings.</li>
        <li>WhatsApp messages travel through Meta’s WhatsApp Business Platform, where WhatsApp’s own terms and privacy policy apply.</li>
        <li>Your recent WhatsApp conversation is kept for 30 minutes so the assistant can follow up, then deleted.</li>
      </ul>
    ),
  },
  {
    id: 'providers',
    title: 'Who else handles your data',
    body: (
      <>
        <p>These providers process data only on our behalf, to run {BRAND_NAME}:</p>
        <ul>
          <li>Our hosting and database providers, which store the app’s data.</li>
          <li>Amazon Web Services (S3), which stores attachments.</li>
          <li>Our email provider, which delivers notification and account emails.</li>
          <li>OpenAI, which powers the assistant.</li>
          <li>Meta, if you use the assistant on WhatsApp.</li>
          <li>Your browser’s push service, if you turn on push notifications.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <p>
        Account and work data stays while your organisation uses {BRAND_NAME}. Short-lived data deletes itself: WhatsApp link codes after
        10&nbsp;minutes, the WhatsApp conversation after 30&nbsp;minutes, and the assistant’s usage counters after a few days.
      </p>
    ),
  },
  {
    id: 'choices',
    title: 'Your choices',
    body: (
      <ul>
        <li>Change your notification settings at any time in the app.</li>
        <li>Unlink WhatsApp from your profile. The link is removed immediately.</li>
        <li>Ask for a copy of your data, a correction, or deletion. See <Link href="/data-deletion">Data deletion</Link>.</li>
      </ul>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDoc
      current="/privacy"
      kicker="Privacy policy"
      title="How ProwPlus handles your data"
      lede={`What ${LEGAL_COMPANY} collects when you use ${BRAND_NAME} and its assistant, including on WhatsApp, and what we do with it.`}
      summary={summary}
      sections={sections}
    />
  );
}
