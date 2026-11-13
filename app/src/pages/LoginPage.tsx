import { HardHat, KeyRound, Mail, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Field, Input } from '../components/ui';
import { api } from '../lib/api';
import { ROLE_COLOR, ROLE_LABEL } from '../lib/labels';
import { errMsg } from '../lib/useAsync';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'magic' | 'reset'>('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const demo = api.mode === 'demo';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'password') await api.signInWithPassword(email, password);
      if (mode === 'magic') {
        await api.signInWithMagicLink(email);
        setInfo('Check your email for a sign-in link.');
      }
      if (mode === 'reset') {
        await api.sendPasswordReset(email);
        setInfo('If that account exists, a reset link is on its way.');
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Hero */}
      <div className="relative flex flex-col justify-between overflow-hidden bg-steel-900 px-6 py-8 text-white lg:w-[46%] lg:px-12 lg:py-12">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'repeating-linear-gradient(-45deg, #f97316 0 18px, transparent 18px 36px)' }} />
        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500"><HardHat className="h-6 w-6" /></span>
          <span className="font-display text-3xl font-bold uppercase tracking-wide">Field<span className="text-brand-500">Ops</span></span>
        </div>
        <div className="relative mt-8 lg:mt-0">
          <h1 className="text-4xl font-bold uppercase leading-[0.95] sm:text-5xl lg:text-6xl">
            Operations.<br />HSEQ.<br /><span className="text-brand-500">Workforce.</span>
          </h1>
          <p className="mt-4 max-w-md text-steel-300">
            One place for your crews, contractors, sites, safety records and plant — built for the field, from the ute to the office.
          </p>
        </div>
        <p className="relative mt-8 hidden text-xs font-semibold uppercase tracking-widest text-steel-500 lg:block">Phase 1 · Foundation</p>
      </div>

      {/* Form */}
      <div className="flex flex-1 items-start justify-center bg-steel-100 px-4 py-8 lg:items-center">
        <div className="w-full max-w-md">
          <div className="card p-6">
            <h2 className="text-3xl font-bold uppercase">{mode === 'reset' ? 'Reset password' : 'Sign in'}</h2>
            <p className="mb-5 mt-1 text-sm text-steel-600">
              {mode === 'reset' ? "We'll email you a link to set a new password." : 'Use the email address your invitation was sent to.'}
            </p>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Email" htmlFor="email">
                <Input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com.au" />
              </Field>
              {mode === 'password' && (
                <Field label="Password" htmlFor="password">
                  <Input id="password" type="password" autoComplete="current-password" required={!demo} value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
              )}
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
              {info && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{info}</p>}
              <Button type="submit" size="lg" block loading={busy}
                icon={mode === 'password' ? <KeyRound className="h-5 w-5" /> : mode === 'magic' ? <Mail className="h-5 w-5" /> : <RotateCcw className="h-5 w-5" />}>
                {mode === 'password' ? 'Sign in' : mode === 'magic' ? 'Email me a sign-in link' : 'Send reset link'}
              </Button>
            </form>
            <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm font-semibold">
              {mode !== 'password'
                ? <button className="text-brand-700 hover:underline" onClick={() => setMode('password')}>Sign in with password</button>
                : <button className="text-brand-700 hover:underline" onClick={() => setMode('magic')}>Email me a link instead</button>}
              {mode !== 'reset' && <button className="text-steel-600 hover:underline" onClick={() => setMode('reset')}>Forgot password?</button>}
            </div>
          </div>

          {demo && api.demoAccounts && (
            <div className="card mt-4 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xl font-bold uppercase">Demo accounts</h3>
                <Badge color="amber">No database</Badge>
              </div>
              <p className="mb-3 text-sm text-steel-600">
                Supabase isn't configured, so the app is running on local demo data. Pick a user to see how each role experiences the app.
              </p>
              <div className="space-y-2">
                {api.demoAccounts().map((a) => (
                  <button key={a.id} onClick={() => api.demoSignIn!(a.id)}
                    className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border-2 border-steel-200 bg-white px-4 py-2 text-left hover:border-brand-400 hover:bg-brand-50">
                    <span className="min-w-0">
                      <span className="block font-bold text-steel-900">{a.label}</span>
                      <span className="block truncate text-xs text-steel-500">{a.description}</span>
                    </span>
                    <Badge color={ROLE_COLOR[a.role]}>{ROLE_LABEL[a.role]}</Badge>
                  </button>
                ))}
              </div>
              <button className="mt-3 text-xs font-semibold text-steel-500 hover:underline"
                onClick={() => { api.demoReset?.(); setInfo('Demo data reset.'); }}>
                Reset demo data
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
