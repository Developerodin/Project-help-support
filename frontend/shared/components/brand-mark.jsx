export default function BrandMark({ className = 'mark', logoUrl = null, name = null }) {
  const label = typeof name === 'string' && name.trim() ? name.trim() : 'Brand';
  const src = typeof logoUrl === 'string' && logoUrl.trim() ? logoUrl.trim() : null;

  if (src) {
    return <img src={src} alt={`${label} logo`} className={className} />;
  }

  return (
    <span
      className={`company-logo-fallback${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={`${label} logo`}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
