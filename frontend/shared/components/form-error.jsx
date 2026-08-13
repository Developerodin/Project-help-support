export default function FormError({ error }) {
  if (!error) return null;

  return (
    <div role="alert" style={{ color: 'var(--danger)', margin: '8px 0' }}>
      <div>{error.message}</div>
      {error.fields && (
        <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
          {Object.entries(error.fields).map(([field, message]) => (
            <li key={field}>{String(message)}</li>
          ))}
        </ul>
      )}
      {error.requestId && (
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Reference: {error.requestId}</div>
      )}
    </div>
  );
}
