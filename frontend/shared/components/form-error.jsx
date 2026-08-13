export default function FormError({ error }) {
  if (!error) return null;

  return (
    <div className="banner" role="alert">
      <div>
        <div>{error.message}</div>
        {error.fields && (
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {Object.entries(error.fields).map(([field, message]) => (
              <li key={field}>{String(message)}</li>
            ))}
          </ul>
        )}
        {error.requestId && (
          <div className="meta">Reference: {error.requestId}</div>
        )}
      </div>
    </div>
  );
}
