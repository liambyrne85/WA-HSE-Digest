import { clsx } from 'clsx';

/**
 * Access & Site Services mark: three ascending platforms (scaffold staging),
 * top tier in platform yellow. `tile` draws it on its own Access Blue square.
 */
export function BrandMark({ className, tile = true, mono }: { className?: string; tile?: boolean; mono?: string }) {
  const white = mono ?? '#ffffff';
  const yellow = mono ?? '#f5b81a';
  return (
    <svg viewBox="0 0 100 100" className={clsx('shrink-0', className)} role="img" aria-label="Access & Site Services">
      {tile && <rect width="100" height="100" rx="6" fill="#2047c6" />}
      <rect x="47" y="25" width="34" height="13" fill={yellow} />
      <rect x="33" y="44" width="48" height="13" fill={white} />
      <rect x="19" y="63" width="62" height="13" fill={white} />
    </svg>
  );
}

/** Mark + stacked wordmark, as in the logo suite (divider between them). */
export function BrandLockup({ dark = true, size = 'md' }: { dark?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const mark = size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
  const text = size === 'lg' ? 'text-lg' : size === 'sm' ? 'text-[11px]' : 'text-[12px]';
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark className={mark} />
      <span className={clsx('h-9 w-px', dark ? 'bg-white/40' : 'bg-steel-900/40', size === 'lg' && 'h-14')} />
      <span className={clsx('font-sans font-extrabold uppercase leading-[1.05] tracking-wide', text, dark ? 'text-white' : 'text-steel-900')}>
        Access<br />&amp; Site<br />Services
      </span>
    </span>
  );
}
