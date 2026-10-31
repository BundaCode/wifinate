import { useEffect, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import { Loader2, X, TrendingUp, TrendingDown, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary', size = 'md', loading, icon: Icon, className, children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: LucideIcon }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55',
        size === 'sm' && 'h-9 px-3 text-sm',
        size === 'md' && 'h-11 px-4 text-[15px]',
        size === 'lg' && 'h-12 px-6 text-base',
        variant === 'primary' && 'bg-brand-600 text-white shadow-sm shadow-brand-600/25 hover:bg-brand-700',
        variant === 'secondary' && 'border bg-[var(--surface)] hover:bg-[var(--surface-2)]',
        variant === 'ghost' && 'hover:bg-[var(--surface-2)]',
        variant === 'danger' && 'bg-rose-600 text-white hover:bg-rose-700',
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {error ? <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('input', props.className)} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={clsx('input cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 20 20%27 fill=%27%2394a3b8%27%3E%3Cpath d=%27M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z%27/%3E%3C/svg%3E")] bg-[length:20px] bg-[right_10px_center] bg-no-repeat pr-10', props.className)}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition hover:bg-[var(--surface-2)]">
      <span className={clsx('mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition', checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600')}>
        <span className={clsx('size-5 rounded-full bg-white shadow transition', checked && 'translate-x-5')} />
      </span>
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
    </button>
  );
}

const badgeTones = {
  green: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400',
  blue: 'bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-400',
  amber: 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400',
  red: 'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-400',
  gray: 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-400',
  brand: 'bg-brand-500/10 text-brand-700 ring-brand-500/20 dark:text-brand-300',
};

export function Badge({ tone = 'gray', children, dot }: { tone?: keyof typeof badgeTones; children: ReactNode; dot?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', badgeTones[tone])}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const voucherStatus: Record<string, { label: string; tone: keyof typeof badgeTones }> = {
  new: { label: 'Belum dipakai', tone: 'blue' },
  active: { label: 'Aktif', tone: 'green' },
  expired: { label: 'Habis', tone: 'gray' },
  disabled: { label: 'Dinonaktifkan', tone: 'red' },
};

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, tone = 'brand', delta, sub }: {
  label: string; value: ReactNode; icon: LucideIcon; tone?: 'brand' | 'green' | 'amber' | 'sky' | 'rose'; delta?: number | null; sub?: ReactNode;
}) {
  const tones = {
    brand: 'from-brand-500 to-violet-500', green: 'from-emerald-500 to-teal-500', amber: 'from-amber-500 to-orange-500',
    sky: 'from-sky-500 to-cyan-500', rose: 'from-rose-500 to-pink-500',
  };
  return (
    <div className="card relative overflow-hidden p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted sm:text-sm">{label}</p>
          <p className="mt-2 truncate text-lg font-extrabold tracking-tight sm:text-2xl">{value}</p>
        </div>
        <span className={clsx('hidden size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg sm:grid', tones[tone])}>
          <Icon className="size-5" />
        </span>
      </div>
      {(delta !== undefined || sub) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {delta !== undefined && delta !== null && (
            <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', delta >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600')}>
              {delta >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {Math.abs(delta).toFixed(0)}%
            </span>
          )}
          {sub && <span className="text-muted">{sub}</span>}
        </div>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm animate-[fade_.15s_ease-out]" onClick={onClose} />
      <div className={clsx(
        'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border bg-[var(--surface)] shadow-2xl sm:rounded-3xl animate-[pop_.18s_ease-out]',
        size === 'md' && 'sm:max-w-lg', size === 'lg' && 'sm:max-w-2xl', size === 'xl' && 'sm:max-w-4xl',
      )}>
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <h2 className="text-lg font-bold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-[var(--surface-2)]" aria-label="Tutup"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t bg-[var(--surface-2)]/50 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-brand-500/10 text-brand-600"><Icon className="size-8" /></span>
      <h3 className="mt-4 text-lg font-bold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3.5 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-sky-600" />
      <div className="text-[var(--text)]/85">{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-6 animate-spin text-brand-600', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-xl bg-[var(--surface-2)]', className)} />;
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
      <span className="text-muted">
        {total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} dari ${total.toLocaleString('id-ID')}` : 'Tidak ada data'}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>Sebelumnya</Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>Berikutnya</Button>
      </div>
    </div>
  );
}
