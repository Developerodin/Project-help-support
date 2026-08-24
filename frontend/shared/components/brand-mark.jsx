export default function BrandMark({ className = 'mark', logoUrl = null }) {
  if (typeof logoUrl !== 'string' || logoUrl.trim() === '') return null;
  return <img src={logoUrl} alt="" className={className} aria-hidden="true" />;
}
