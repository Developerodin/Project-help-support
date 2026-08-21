import Image from 'next/image';

/** Dharwin PMS mark — served from /prowplus-icon.png (shared with favicon and email). */
export default function BrandMark({ className = 'mark' }) {
  return (
    <Image
      src="/prowplus-icon.png"
      alt=""
      width={512}
      height={512}
      className={className}
      aria-hidden="true"
      priority
    />
  );
}
