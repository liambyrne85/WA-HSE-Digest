import { clsx } from 'clsx';
import { Loader2, X } from 'lucide-react';
import { cloneElement, forwardRef, isValidElement, useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { BadgeColor } from '../../lib/types';

// ---------------------------------------------------------------------------
// Button — min 44px touch targets; "lg" = 56px for field use.
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm',
  secondary: 'bg-white text-steel-800 border-2 border-steel-200 hover:border-steel-300 hover:bg-steel-50',
  ghost: 'text-steel-700 hover:bg-steel-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  dark: 'bg-steel-900 text-white hover:bg-steel-800',
};
const sizes: Record<Size, string> = {
  sm: 'min-h-[36px] px-3 text-sm gap-1.5 rounded-lg',
  md: 'min-h-[44px] px-4 text-[15px] gap-2 rounded-lg',
  lg: 'min-h-[56px] px-5 text-base gap-2.5 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant], sizes[size], block && 'w-full', className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
const badgeColors: Record<BadgeColor, string> = {
  slate: 'bg-steel-100 text-steel-700 ring-steel-300',
  blue: 'bg-blue-50 text-blue-800 ring-blue-300',
  amber: 'bg-amber-50 text-amber-900 ring-amber-300',
  orange: 'bg-brand-50 text-brand-800 ring-brand-300',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  red: 'bg-red-50 text-red-800 ring-red-300',
  purple: 'bg-violet-50 text-violet-800 ring-violet-300',
};
const dotColors: Record<BadgeColor, string> = {
  slate: 'bg-steel-400', blue: 'bg-blue-500', amber: 'bg-amber-500', orange: 'bg-brand-500',
  green: 'bg-emerald-500', red: 'bg-red-500', purple: 'bg-violet-500',
};

export function Badge({ color = 'slate', children, dot = true, className }: { color?: BadgeColor; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide ring-1 ring-inset', badgeColors[color], className)}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full', dotColors[color])} />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function Field({ label, hint, error, children, required, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; required?: boolean; htmlFor?: string }) {
  const autoId = useId();
  // Associate the label with a single form-control child automatically (a11y + testability).
  let control = children;
  let id = htmlFor;
  if (!id && isValidElement<{ id?: string }>(children)) {
    const t = children.type;
    const isControl = t === Input || t === Select || t === Textarea || (typeof t === 'string' && ['input', 'select', 'textarea'].includes(t));
    if (isControl) {
      id = children.props.id ?? autoId;
      control = cloneElement(children, { id });
    }
  }
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label} {required && <span className="text-brand-600">*</span>}
      </label>
      {control}
      {hint && !error && <p className="mt-1 text-xs text-steel-500">{hint}</p>}
      {error && <p className="mt-1 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx('input', className)} {...p} />;
});

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx('input min-h-[96px]', className)} {...p} />;
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx('input appearance-none bg-[length:20px] bg-[right_10px_center] bg-no-repeat pr-10', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23515c73' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...p}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        size === 'md' ? 'h-8 w-14' : 'h-6 w-11',
        checked ? 'bg-emerald-500' : 'bg-steel-300',
      )}
    >
      <span className={clsx(
        'inline-block transform rounded-full bg-white shadow transition-transform',
        size === 'md' ? 'h-6 w-6' : 'h-4 w-4',
        checked ? (size === 'md' ? 'translate-x-7' : 'translate-x-6') : 'translate-x-1',
      )} />
    </button>
  );
}

export function Checkbox({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg py-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-2 border-steel-300 text-brand-500 accent-brand-500" />
      <span>
        <span className="block text-sm font-semibold text-steel-800">{label}</span>
        {description && <span className="block text-xs text-steel-500">{description}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-bold uppercase tracking-widest text-brand-600">{eyebrow}</p>}
        <h1 className="text-3xl font-bold uppercase leading-tight text-steel-900 sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-steel-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, title, actions, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; padded?: boolean }) {
  return (
    <section className={clsx('card min-w-0', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-steel-200 px-4 py-3">
          <h2 className="font-display text-lg font-bold uppercase tracking-wide text-steel-800">{title}</h2>
          {actions}
        </header>
      )}
      <div className={clsx(padded && 'p-4')}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-steel-300 bg-white/50 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-steel-400">{icon}</div>}
      <p className="font-display text-xl font-bold uppercase text-steel-700">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-steel-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-steel-500" role="status">
      <Loader2 className="h-6 w-6 animate-spin" /> <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span className="font-medium">{message}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" className="inline-flex min-w-full gap-1 rounded-xl bg-steel-200/70 p-1 sm:min-w-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={value === t.key}
            onClick={() => onChange(t.key)}
            className={clsx(
              'flex min-h-[40px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors sm:flex-none',
              value === t.key ? 'bg-white text-steel-900 shadow-sm' : 'text-steel-600 hover:text-steel-900',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={clsx('rounded-full px-1.5 text-xs', value === t.key ? 'bg-brand-100 text-brand-800' : 'bg-steel-300/70 text-steel-700')}>{t.count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Responsive modal: bottom sheet on mobile, centred dialog / side drawer on desktop.
 */
export function Modal({ open, onClose, title, children, footer, wide, drawer }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; drawer?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-steel-950/60" onClick={onClose} />
      <div
        className={clsx(
          'relative flex max-h-[92vh] w-full flex-col bg-white shadow-2xl',
          'rounded-t-2xl sm:rounded-2xl',
          drawer ? 'sm:fixed sm:inset-y-0 sm:right-0 sm:max-h-none sm:max-w-xl sm:rounded-none sm:rounded-l-2xl' : wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-steel-200 px-5 py-4">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-steel-500 hover:bg-steel-100">
            <X className="h-6 w-6" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="pb-safe flex flex-col-reverse gap-2 border-t border-steel-200 px-5 py-3 sm:flex-row sm:justify-end">{footer}</footer>}
      </div>
    </div>
  );
}

export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-16 w-16 text-xl' : 'h-10 w-10 text-sm';
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('') || '?';
  return (
    <span className={clsx('inline-flex shrink-0 items-center justify-center rounded-full bg-steel-800 font-bold text-white', s, className)}>
      {letters}
    </span>
  );
}

export function StatCard({ label, value, icon, tone = 'slate', hint, placeholder }: { label: string; value: ReactNode; icon?: ReactNode; tone?: BadgeColor; hint?: string; placeholder?: boolean }) {
  const toneBar: Record<BadgeColor, string> = {
    slate: 'bg-steel-400', blue: 'bg-blue-500', amber: 'bg-amber-500', orange: 'bg-brand-500',
    green: 'bg-emerald-500', red: 'bg-red-500', purple: 'bg-violet-500',
  };
  return (
    <div className="card relative overflow-hidden p-4">
      <span className={clsx('absolute inset-y-0 left-0 w-1.5', toneBar[tone])} />
      <div className="flex items-start justify-between gap-2 pl-1">
        <p className="text-xs font-bold uppercase tracking-wider text-steel-500">{label}</p>
        {icon && <span className="text-steel-400">{icon}</span>}
      </div>
      <p className={clsx('mt-2 pl-1 font-display text-4xl font-bold leading-none', placeholder ? 'text-steel-300' : 'text-steel-900')}>{value}</p>
      {hint && <p className="mt-2 pl-1 text-xs font-medium text-steel-500">{hint}</p>}
    </div>
  );
}
