import { AuthIcon } from './auth-icons.jsx';

/** Auth-card error / info line — matches .autherr in pms-screens.html. */
export default function AuthError({ error, tone = 'alarm', children }) {
  const message = children || error?.message;
  if (!message) return null;

  return (
    <p
      className="autherr"
      id={error ? 'aperr' : undefined}
      role="alert"
      data-tone={tone === 'muted' ? 'muted' : undefined}
    >
      <AuthIcon name={tone === 'muted' ? 'info' : 'alert'} className="" size={12} />
      <span>{message}</span>
    </p>
  );
}
