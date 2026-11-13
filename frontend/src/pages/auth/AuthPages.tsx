import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Eye, EyeOff, GraduationCap, MailCheck, Presentation, Quote, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Logo } from '@/components/common/Logo';
import { Button, Field, Input } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import { afterLogin, homeFor, useAuth } from '@/store/auth';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10 animate-fade-in">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-brand-800 lg:block">
        <div className="absolute -right-20 -top-20 h-96 w-96 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="absolute -bottom-32 left-10 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          <Quote className="mb-4 h-8 w-8 text-brand-300" />
          <p className="max-w-md text-xl font-medium leading-relaxed">“At 11 PM before my exam, the AI tutor explained quicksort's worst case and pointed me to the exact minute in the lecture. Game changer.”</p>
          <p className="mt-4 text-sm text-white/70">Ananya S. · Final-year B.Tech student</p>
        </div>
      </div>
    </div>
  );
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className="pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

const DEMO = [
  { label: 'Student', email: 'ananya@example.com', icon: GraduationCap },
  { label: 'Instructor', email: 'rohit@vertexlearn.ai', icon: Presentation },
  { label: 'Admin', email: 'meera@vertexlearn.ai', icon: ShieldCheck },
];

export function Login() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(params.get('suspended') ? 'This account is suspended. Contact support.' : null);

  const login = useMutation({
    mutationFn: async (body: { email: string; password: string }) => (await api.post('/auth/login', body)).data,
    onSuccess: (data) => {
      setSession(data);
      toast.success(`Welcome back, ${data.user.full_name.split(' ')[0]}!`);
      // Back to the page the user wanted (?next=), else their role's home
      nav(afterLogin(params.get('next'), data.user.role), { replace: true });
    },
    onError: (e) => setError(errMsg(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate({ email, password });
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue learning." footer={<>New to VertexLearn? <Link to="/register" className="font-semibold text-brand-600 hover:underline">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300" role="alert">{error}</div>}
        <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" /></Field>
        <Field label="Password" htmlFor="password">
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
        </Field>
        <div className="flex justify-end"><Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:underline">Forgot password?</Link></div>
        <Button type="submit" className="w-full" size="lg" loading={login.isPending}>Sign in</Button>
      </form>
      <div className="mt-8">
        <div className="relative mb-4 text-center text-xs text-muted"><span className="relative z-10 bg-bg px-2">Demo accounts · password Password123!</span><div className="absolute inset-x-0 top-1/2 h-px bg-border" /></div>
        <div className="grid grid-cols-3 gap-2">
          {DEMO.map(({ label, email: demoEmail, icon: Icon }) => (
            <button key={label} type="button" disabled={login.isPending} onClick={() => { setEmail(demoEmail); setPassword('Password123!'); setError(null); login.mutate({ email: demoEmail, password: 'Password123!' }); }}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-2 py-3 text-xs font-medium transition hover:border-brand-300 hover:bg-brand-50/50 dark:hover:bg-brand-500/10">
              <Icon className="h-4 w-4 text-brand-600" />{label}
            </button>
          ))}
        </div>
      </div>
    </AuthShell>
  );
}

export function Register() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role: (params.get('role') === 'instructor' ? 'instructor' : 'student') as 'student' | 'instructor' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const register = useMutation({
    mutationFn: async () => (await api.post('/auth/register', form)).data,
    onSuccess: (data) => {
      setSession(data);
      toast.success('Account created — welcome to VertexLearn!');
      nav(homeFor(data.user.role), { replace: true });
    },
    onError: (e: any) => {
      const field = e?.response?.data?.error?.field;
      setErrors(field ? { [field]: errMsg(e).replace(`${field}: `, '') } : { form: errMsg(e) });
    },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.full_name.trim().length < 2) e.full_name = 'Enter your full name';
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Enter a valid email address';
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) e.password = 'At least 8 characters, with a letter and a number';
    setErrors(e);
    return !Object.keys(e).length;
  };
  const strength = [form.password.length >= 8, /[A-Za-z]/.test(form.password) && /\d/.test(form.password), /[^A-Za-z0-9]/.test(form.password) || form.password.length >= 12].filter(Boolean).length;

  return (
    <AuthShell title="Create your account" subtitle="Start learning in under a minute." footer={<>Already have an account? <Link to="/login" className="font-semibold text-brand-600 hover:underline">Sign in</Link></>}>
      <form onSubmit={(e) => { e.preventDefault(); if (validate()) register.mutate(); }} className="space-y-4" noValidate>
        {errors.form && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300" role="alert">{errors.form}</div>}
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="I want to">
          {([['student', 'Learn', GraduationCap], ['instructor', 'Teach', Presentation]] as const).map(([value, label, Icon]) => (
            <button type="button" key={value} role="radio" aria-checked={form.role === value} onClick={() => setForm({ ...form, role: value })}
              className={clsx('flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-sm transition', form.role === value ? 'border-brand-500 bg-brand-50 ring-4 ring-brand-500/10 dark:bg-brand-500/10' : 'border-border bg-surface hover:bg-surface-2')}>
              <Icon className={clsx('h-5 w-5', form.role === value ? 'text-brand-600' : 'text-muted')} />
              <div><p className="font-semibold">I want to {label.toLowerCase()}</p><p className="text-xs text-muted">{value === 'student' ? 'Student account' : 'Instructor account'}</p></div>
            </button>
          ))}
        </div>
        <Field label="Full name" htmlFor="name" error={errors.full_name}><Input id="name" autoComplete="name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Ananya Sharma" /></Field>
        <Field label="Email" htmlFor="email" error={errors.email}><Input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" /></Field>
        <Field label="Password" htmlFor="password" error={errors.password} hint="At least 8 characters, with a letter and a number">
          <PasswordInput id="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {form.password && (
            <div className="mt-2 flex gap-1">{[0, 1, 2].map((i) => <span key={i} className={clsx('h-1 flex-1 rounded-full', i < strength ? ['bg-rose-400', 'bg-amber-400', 'bg-emerald-500'][strength - 1] : 'bg-surface-2')} />)}</div>
          )}
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={register.isPending}>Create account</Button>
        {form.role === 'instructor' && <p className="text-center text-xs text-muted">New courses are reviewed by our team before they appear in the catalog.</p>}
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const m = useMutation({
    mutationFn: () => api.post('/auth/forgot-password', { email }),
    onSuccess: () => setSent(true),
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <AuthShell title={sent ? 'Check your inbox' : 'Reset your password'} subtitle={sent ? undefined : "Enter your email and we'll send you a reset link."}
      footer={<Link to="/login" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline"><ArrowLeft className="h-4 w-4" />Back to sign in</Link>}>
      {sent ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-center">
          <MailCheck className="mx-auto mb-3 h-10 w-10 text-emerald-500" />
          <p className="text-sm">If an account exists for <b>{email}</b>, a reset link is on its way. It expires in 30 minutes.</p>
          <p className="mt-3 text-xs text-muted">Running locally? Emails are captured by Mailpit at <a className="text-brand-600 underline" href="http://localhost:8025" target="_blank" rel="noreferrer">localhost:8025</a>.</p>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-4">
          <Field label="Email" htmlFor="email"><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
          <Button type="submit" className="w-full" size="lg" loading={m.isPending}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const token = params.get('token') ?? '';
  const m = useMutation({
    mutationFn: () => api.post('/auth/reset-password', { token, password }),
    onSuccess: () => { toast.success('Password updated — please sign in.'); nav('/login'); },
    onError: (e) => setError(errMsg(e)),
  });
  return (
    <AuthShell title="Choose a new password" footer={<Link to="/login" className="font-semibold text-brand-600 hover:underline">Back to sign in</Link>}>
      {!token ? <p className="text-sm text-rose-600">This reset link is missing its token. Request a new one from the forgot-password page.</p> : (
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (password !== confirm) return setError('Passwords do not match');
          if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return setError('Use at least 8 characters, with a letter and a number');
          setError(null);
          m.mutate();
        }}>
          {error && <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" role="alert">{error}</p>}
          <Field label="New password" htmlFor="pw"><PasswordInput id="pw" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Confirm password" htmlFor="pw2"><PasswordInput id="pw2" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          <Button type="submit" className="w-full" size="lg" loading={m.isPending}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}
