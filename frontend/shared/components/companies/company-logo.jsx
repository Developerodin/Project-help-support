'use client';

export default function CompanyLogo({ company, size = 28, className = '' }) {
  const label = company?.name?.trim() || 'Company';
  const initials = label.charAt(0).toUpperCase();

  if (company?.logoUrl) {
    return (
      <img
        src={company.logoUrl}
        alt=""
        className={`company-logo${className ? ` ${className}` : ''}`}
        width={size}
        height={size}
      />
    );
  }

  return (
    <span
      className={`company-logo-fallback${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42) }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
