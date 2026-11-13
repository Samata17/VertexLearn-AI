import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BadgeCheck, Bell, Camera, CheckCheck, Compass, Monitor, Moon, ShieldX, Sun, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { notifIcon, type Notification } from '@/components/common/NotificationBell';
import { Avatar, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, PageLoader, Segmented, Select, Skeleton, Textarea } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import { homeFor, useAuth } from '@/store/auth';
import { useTheme, type ThemeChoice } from '@/store/theme';
import { date, timeAgo } from '@/utils/format';
import { LANGUAGES, useI18n } from '@/utils/i18n';

export function NotFound() {
  const user = useAuth((s) => s.user);
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <p className="bg-gradient-to-br from-brand-500 to-brand-800 bg-clip-text text-7xl font-extrabold text-transparent">404</p>
      <h1 className="mt-4 text-2xl font-bold">This page doesn't exist</h1>
      <p className="mt-2 text-muted">The link may be broken, or the page may have been moved.</p>
      <div className="mt-6 flex gap-2"><Link to={user ? homeFor(user.role) : '/'}><Button>{user ? 'Go to dashboard' : 'Go home'}</Button></Link><Link to="/courses"><Button variant="outline" icon={<Compass className="h-4 w-4" />}>Browse courses</Button></Link></div>
    </div>
  );
}

export function VerifyCertificate() {
  const { code } = useParams();
  const q = useQuery({ queryKey: ['verify', code], queryFn: async () => (await api.get(`/certificates/verify/${code}`)).data, retry: false });
  return (
    <div className="mx-auto max-w-xl px-4 py-20">
      {q.isLoading ? <PageLoader label="Verifying certificate…" /> : q.isError ? (
        <Card className="p-8 text-center"><ShieldX className="mx-auto mb-3 h-12 w-12 text-rose-500" /><h1 className="text-xl font-bold">Certificate not found</h1><p className="mt-2 text-sm text-muted">No certificate matches the ID <span className="font-mono">{code}</span>.</p></Card>
      ) : (
        <Card className="p-8 text-center">
          <BadgeCheck className="mx-auto mb-3 h-14 w-14 text-emerald-500" />
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-600">Verified certificate</p>
          <h1 className="mt-3 text-2xl font-bold">{q.data.student_name}</h1>
          <p className="mt-1 text-muted">completed</p>
          <p className="mt-1 text-lg font-semibold">{q.data.course_title}</p>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5 text-sm">
            <div><p className="text-muted">Issued</p><p className="font-semibold">{date(q.data.issued_at)}</p></div>
            <div><p className="text-muted">Instructor</p><p className="font-semibold">{q.data.instructor_name}</p></div>
          </div>
          <p className="mt-5 font-mono text-xs text-muted">ID {q.data.certificate_code}</p>
        </Card>
      )}
    </div>
  );
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const q = useQuery({ queryKey: ['notifications', 'page', filter], queryFn: async () => (await api.get<{ data: Notification[]; unread_count: number }>('/notifications', { params: { unread: filter === 'unread' || undefined } })).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api.put('/notifications/read-all'), onSuccess: refresh });
  const read = useMutation({ mutationFn: (id: string) => api.put(`/notifications/${id}/read`), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/notifications/${id}`), onSuccess: refresh });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notifications" subtitle={`${q.data?.unread_count ?? 0} unread`} actions={<Button variant="outline" icon={<CheckCheck className="h-4 w-4" />} onClick={() => readAll.mutate()} disabled={!q.data?.unread_count}>Mark all read</Button>} />
      <div className="mb-4"><Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} /></div>
      {q.isLoading ? <Skeleton className="h-60" /> : !q.data?.data.length ? <EmptyState icon={<Bell className="h-6 w-6" />} title="You're all caught up" description="New grades, announcements and badges will appear here." /> : (
        <Card className="divide-y divide-border">
          {q.data.data.map((n) => (
            <div key={n.id} className={clsx('group flex gap-3 px-5 py-4', !n.is_read && 'bg-brand-50/40 dark:bg-brand-500/5')}>
              <div className={clsx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', n.is_read ? 'bg-surface-2 text-muted' : 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300')}>{notifIcon(n.type)}</div>
              <button className="min-w-0 flex-1 text-left" onClick={() => { if (!n.is_read) read.mutate(n.id); if (n.link) nav(n.link); }}>
                <p className={clsx('text-sm', !n.is_read && 'font-semibold')}>{n.title}</p>
                <p className="text-sm text-muted">{n.body}</p>
                <p className="mt-1 text-xs text-muted">{timeAgo(n.created_at)}</p>
              </button>
              <button onClick={() => del.mutate(n.id)} className="h-fit rounded-lg p-1.5 text-muted opacity-0 transition hover:text-rose-600 group-hover:opacity-100" aria-label="Delete notification"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

export function SettingsPage() {
  const user = useAuth((s) => s.user)!;
  const setUser = useAuth((s) => s.setUser);
  const { choice, setChoice } = useTheme();
  const { lang, setLang } = useI18n();
  const [profile, setProfile] = useState({ full_name: user.full_name, bio: user.bio ?? '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  const saveProfile = useMutation({ mutationFn: async () => (await api.put('/users/me', profile)).data.user, onSuccess: (u) => { setUser(u); toast.success('Profile saved'); }, onError: (e) => toast.error(errMsg(e)) });
  const uploadAvatar = useMutation({
    mutationFn: async (f: File) => { const form = new FormData(); form.append('avatar', f); return (await api.post('/users/me/avatar', form)).data; },
    onSuccess: (d) => { setUser({ ...user, avatar_url: d.avatar_url }); toast.success('Photo updated'); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const changePw = useMutation({ mutationFn: () => api.put('/users/me/password', { current_password: pw.current_password, new_password: pw.new_password }), onSuccess: () => { setPw({ current_password: '', new_password: '', confirm: '' }); toast.success('Password changed'); }, onError: (e) => toast.error(errMsg(e)) });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" subtitle="Manage your profile, security and preferences." />
      <Card>
        <CardHeader title="Profile" />
        <div className="space-y-5 p-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar name={user.full_name} src={user.avatar_url} size={72} />
              <button onClick={() => fileRef.current?.click()} className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border-2 border-surface bg-brand-600 text-white" aria-label="Change photo"><Camera className="h-4 w-4" /></button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar.mutate(e.target.files[0])} />
            </div>
            <div><p className="font-semibold">{user.full_name}</p><p className="text-sm text-muted">{user.email}</p><p className="text-xs capitalize text-muted">{user.roles.join(', ')}</p></div>
          </div>
          <Field label="Full name"><Input value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} maxLength={150} /></Field>
          <Field label="Bio" hint="Shown on your instructor profile and in discussions."><Textarea value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} maxLength={1000} /></Field>
          <Button onClick={() => saveProfile.mutate()} loading={saveProfile.isPending}>Save profile</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Appearance & language" />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <Field label="Theme">
            <Segmented value={choice} onChange={(v) => setChoice(v as ThemeChoice)} options={[{ value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="h-4 w-4" />Light</span> }, { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="h-4 w-4" />Dark</span> }, { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor className="h-4 w-4" />Auto</span> }]} />
          </Field>
          <Field label="Language" hint="Interface translation is partial (i18n scaffolding).">
            <Select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</Select>
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Change password" subtitle="Use at least 8 characters with a letter and a number." />
        <form className="grid gap-4 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (pw.new_password !== pw.confirm) return toast.error('New passwords do not match'); changePw.mutate(); }}>
          <div className="sm:col-span-2"><Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field></div>
          <Field label="New password"><Input type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
          <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Button type="submit" loading={changePw.isPending} disabled={!pw.current_password || !pw.new_password}>Update password</Button></div>
        </form>
      </Card>
    </div>
  );
}
