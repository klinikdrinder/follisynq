'use client';
import React, { useEffect } from 'react';
import clsx from 'clsx';
import { X, ChevronDown } from 'lucide-react';

export const cx = clsx;

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal' | 'record'; size?: 'sm' | 'md' | 'lg' | 'xl' };
export function Button({ variant = 'primary', size = 'md', className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[.98] disabled:opacity-40 disabled:pointer-events-none select-none',
        size === 'sm' && 'h-9 px-3 text-sm', size === 'md' && 'h-11 px-4 text-[15px]', size === 'lg' && 'h-14 px-6 text-base', size === 'xl' && 'h-20 px-6 text-lg',
        variant === 'primary' && 'bg-navy-800 text-white hover:bg-navy-700 shadow-sm',
        variant === 'teal' && 'bg-teal-600 text-white hover:bg-teal-700 shadow-sm',
        variant === 'secondary' && 'bg-white text-navy-800 border border-navy-200 hover:bg-navy-50',
        variant === 'ghost' && 'text-navy-700 hover:bg-navy-50',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        variant === 'record' && 'bg-red-600 text-white hover:bg-red-700 shadow-lg',
        className,
      )}
    />
  );
}

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx('rounded-2xl bg-white border border-navy-100 shadow-card', className)}>{children}</div>;
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'teal' | 'navy' | 'amber' | 'red' | 'green' | 'blue'; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
      tone === 'neutral' && 'bg-navy-50 text-navy-600', tone === 'teal' && 'bg-teal-50 text-teal-700', tone === 'navy' && 'bg-navy-800 text-white',
      tone === 'amber' && 'bg-amber-50 text-amber-800', tone === 'red' && 'bg-red-50 text-red-700', tone === 'green' && 'bg-emerald-50 text-emerald-700',
      tone === 'blue' && 'bg-sky-50 text-sky-700', className)}>{children}</span>
  );
}

export const inputCls = 'w-full h-11 rounded-xl border border-navy-200 bg-white px-3 text-[15px] text-navy-900 placeholder:text-navy-300 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400';

export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(inputCls, p.className)} />;
}
export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(inputCls, 'h-auto min-h-[88px] py-2', p.className)} />;
}
export function Select({ options, placeholder = '—', value, onChange, className, ...p }: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & { options: (string | { v: string; l: string })[]; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <div className={cx('relative', className)}>
      <select {...p} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cx(inputCls, 'appearance-none pr-9')}>
        <option value="">{placeholder}</option>
        {options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-3 h-5 w-5 text-navy-300" />
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-[13px] font-medium text-navy-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-navy-400">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-navy-950/40 backdrop-blur-sm p-0 sm:p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={cx('w-full max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl', wide ? 'sm:max-w-4xl' : 'sm:max-w-xl')}>
        <div className="flex items-center justify-between border-b border-navy-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-navy-50" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-navy-100 px-6 py-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 text-navy-400">
      {icon && <div className="mb-3 text-navy-200">{icon}</div>}
      <p className="font-medium text-navy-600">{title}</p>
      {children && <div className="mt-1 text-sm">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-navy-400 text-[13px]"><span>{label}</span>{icon}</div>
      <div className="mt-1 text-2xl font-semibold text-navy-900 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-navy-400 mt-0.5">{sub}</div>}
    </Card>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { v: T; l: React.ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-navy-50 p-1 no-scrollbar">
      {tabs.map((t) => (
        <button key={t.v} onClick={() => onChange(t.v)}
          className={cx('whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition', value === t.v ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-500 hover:text-navy-800')}>{t.l}</button>
      ))}
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, right, count }: { title: string; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode; count?: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-5 py-4 text-left">
        <span className="flex items-center gap-2 font-semibold text-navy-900">{title}{count}</span>
        <span className="flex items-center gap-3">{right}<ChevronDown className={cx('h-5 w-5 text-navy-300 transition', open && 'rotate-180')} /></span>
      </button>
      {open && <div className="border-t border-navy-100 px-5 py-4">{children}</div>}
    </Card>
  );
}

export function PageHeader({ title, sub, actions, back }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back}
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {sub && <div className="mt-0.5 text-sm text-navy-500">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ───────── toast ─────────
type Toast = { id: number; msg: string; tone: 'ok' | 'err' | 'info' };
let toastFn: ((t: Omit<Toast, 'id'>) => void) | null = null;
export const toast = { ok: (msg: string) => toastFn?.({ msg, tone: 'ok' }), err: (msg: string) => toastFn?.({ msg, tone: 'err' }), info: (msg: string) => toastFn?.({ msg, tone: 'info' }) };
export function Toaster() {
  const [items, setItems] = React.useState<Toast[]>([]);
  useEffect(() => {
    toastFn = (t) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === 'err' ? 7000 : 3500);
    };
    return () => { toastFn = null; };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto max-w-lg rounded-2xl px-5 py-3 text-[15px] font-medium shadow-xl',
          t.tone === 'ok' && 'bg-emerald-600 text-white', t.tone === 'err' && 'bg-red-600 text-white', t.tone === 'info' && 'bg-navy-800 text-white')}>{t.msg}</div>
      ))}
    </div>
  );
}
