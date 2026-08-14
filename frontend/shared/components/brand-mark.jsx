/**
 * The Dharwin mark, inline so it stays crisp at any size and costs no request.
 * Geometry matches app/icon.svg and the PNG attached to mail; edit together.
 *
 * Mask ids are suffixed per instance: two inline SVGs sharing one id makes the
 * second resolve against the first, which silently drops the notch.
 */
export default function BrandMark({ id = 'brand', className = 'mark' }) {
  const maskId = `dharwin-notch-${id}`;
  return (
    <svg
      className={className}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <mask id={maskId}>
        <rect width="512" height="512" fill="#fff" />
        <rect x="190" y="190" width="132" height="132" rx="34" fill="#000" />
      </mask>
      <g mask={`url(#${maskId})`}>
        <rect x="190" y="100" width="222" height="222" rx="56" fill="#45A15E" />
        <rect x="100" y="190" width="222" height="222" rx="56" fill="#1E3A5F" />
      </g>
    </svg>
  );
}
