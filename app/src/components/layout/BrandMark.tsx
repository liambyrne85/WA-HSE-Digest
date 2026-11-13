import { clsx } from 'clsx';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Three ascending platforms (scaffold staging), top tier in the accent colour.
 * Colours follow the Branding settings via CSS variables.
 */
export function BrandMark({ className, tile = true }: { className?: string; tile?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={clsx('shrink-0', className)} role="img" aria-hidden="true">
      {tile && <rect width="100" height="100" rx="6" fill="rgb(var(--brand-500))" />}
      <rect x="47" y="25" width="34" height="13" fill="rgb(var(--hivis-500))" />
      <rect x="33" y="44" width="48" height="13" fill="#ffffff" />
      <rect x="19" y="63" width="62" height="13" fill="#ffffff" />
    </svg>
  );
}

/** Uploaded logo, or the mark + stacked company name. */
export function BrandLockup({ dark = true, size = 'md' }: { dark?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const { settings } = useTheme();
  const mark = size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-9 w-9' : 'h-10 w-10';
  const text = size === 'lg' ? 'text-lg max-w-[11rem]' : 'text-[12px] max-w-[7.5rem]';
  if (settings.logo_url) {
    return (
      <span className={clsx('flex items-center rounded-lg', dark && 'bg-white px-2 py-1')}>
        <img src={settings.logo_url} alt={settings.company_name} className={clsx('w-auto max-w-[180px] object-contain', size === 'lg' ? 'h-14' : 'h-9')} />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2.5" aria-label={settings.company_name}>
      <BrandMark className={mark} />
      <span className={clsx('w-px self-stretch', dark ? 'bg-white/40' : 'bg-steel-900/40')} />
      <span className={clsx('font-sans font-extrabold uppercase leading-[1.05] tracking-wide [text-wrap:balance]', text, dark ? 'text-white' : 'text-steel-900')}>
        {settings.company_name}
      </span>
    </span>
  );
}
