'use client';
import { useState } from 'react';
import { signIn, StaffProfile } from '@/lib/auth';
import { Button, Input, Field } from './ui';
import { Logo } from './AppProvider';
import { ShieldCheck, WifiOff } from 'lucide-react';

export function Login({ onSignedIn }: { onSignedIn: (p: StaffProfile) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      <div className="hidden lg:flex flex-col justify-between bg-navy-900 p-12 text-white">
        <div className="flex items-center gap-3"><Logo className="h-11 w-11" /><span className="text-xl font-semibold tracking-tight">Follisync</span></div>
        <div>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Clinical media collection<br />for hair transplantation.</h2>
          <p className="mt-4 max-w-md text-navy-200">Capture first. Document when you can. Every recording is saved and verified on this iPad, with its clinical context preserved.</p>
        </div>
        <p className="text-sm text-navy-300">Klinik Dr Inder · Internal clinical use only</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form className="w-full max-w-sm" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr('');
          try { onSignedIn(await signIn(email, password)); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
        }}>
          <div className="lg:hidden mb-8 flex items-center gap-3"><Logo className="h-11 w-11" /><span className="text-xl font-semibold text-navy-900">Follisync</span></div>
          <h1 className="text-2xl font-semibold text-navy-900">Staff sign in</h1>
          <p className="mt-1 text-sm text-navy-500">Accounts are created by your Follisync administrator.</p>
          {offline && <p className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><WifiOff className="h-4 w-4" />First sign-in on this iPad requires an internet connection.</p>}
          <div className="mt-6 space-y-4">
            <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoCapitalize="none" /></Field>
            <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          </div>
          {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
          <Button size="lg" className="mt-6 w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          <p className="mt-6 flex items-start gap-2 text-xs text-navy-400"><ShieldCheck className="h-4 w-4 shrink-0" />Use only on clinic-managed, passcode-protected iPads. Access is logged.</p>
        </form>
      </div>
    </div>
  );
}
