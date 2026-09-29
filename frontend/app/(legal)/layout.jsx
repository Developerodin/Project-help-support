import './legal.css';

/* Public, server-rendered, no sign-in: Meta's app review and anyone else must be able to read these. */
export default function LegalLayout({ children }) {
  return <main className="legal-page">{children}</main>;
}
