import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Ban, CheckCircle2, FileClock, Megaphone, Search, Send, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Avatar, Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Segmented, Select, Skeleton, Textarea, Toggle } from '@/components/common/ui';
import { useDebounce } from '@/hooks/useDebounce';
import { api, errMsg } from '@/services/api';
import { useAuth } from '@/store/auth';
import type { Role } from '@/types';
import { date, dateTime, timeAgo } from '@/utils/format';

const ROLES: Role[] = ['student', 'instructor', 'admin'];
const roleTone = (r: string) => (r === 'admin' ? 'danger' : r === 'instructor' ? 'brand' : 'neutral') as 'danger' | 'brand' | 'neutral';

export function AdminUsers() {
  const me = useAuth((s) => s.user)!;
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounce(q);
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: ['admin-users', dq, role, status, page],
    queryFn: async () => (await api.get('/admin/users', { params: { q: dq || undefined, role: role || undefined, status: status || undefined, page } })).data as any,
    placeholderData: keepPreviousData,
  });
  const [detail, setDetail] = useState<string | null>(null);
  const [roles, setRoles] = useState<{ id: string; name: string; roles: Role[] } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'suspend' | 'reactivate' | 'delete'; user: any } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin-users'] }); qc.invalidateQueries({ queryKey: ['admin-user'] }); };
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); p.delete('page'); setParams(p, { replace: true }); };

  const saveRoles = useMutation({ mutationFn: () => api.put(`/admin/users/${roles!.id}/role`, { roles: roles!.roles }), onSuccess: () => { toast.success('Roles updated — the user must sign in again'); setRoles(null); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const act = useMutation({
    mutationFn: () => confirm!.kind === 'delete' ? api.delete(`/admin/users/${confirm!.user.id}`) : api.put(`/admin/users/${confirm!.user.id}/suspend`, { suspended: confirm!.kind === 'suspend' }),
    onSuccess: () => { toast.success(confirm!.kind === 'delete' ? 'Account deleted' : confirm!.kind === 'suspend' ? 'Account suspended' : 'Account reactivated'); setConfirm(null); setDetail(null); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div>
      <PageHeader title="User management" subtitle="Search accounts, manage roles, and suspend or delete users." />
      <Card className="mb-5 flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => { setQ(e.target.value); set('q', e.target.value); }} placeholder="Search by name or email" className="pl-9" /></div>
        <Select value={role} onChange={(e) => set('role', e.target.value)} className="md:w-44" aria-label="Role"><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}</Select>
        <Segmented value={status || 'all'} onChange={(v) => set('status', v === 'all' ? '' : v)} options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} />
      </Card>
      {users.isLoading ? <Skeleton className="h-96" /> : users.isError ? <ErrorState message={errMsg(users.error)} /> : !users.data.data.length ? <EmptyState title="No users match" /> : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-border bg-surface-2/50"><tr><th className="table-th">User</th><th className="table-th">Roles</th><th className="table-th">Status</th><th className="table-th">Activity</th><th className="table-th">Joined</th><th className="table-th text-right">Actions</th></tr></thead>
              <tbody className={clsx('divide-y divide-border', users.isFetching && 'opacity-60')}>
                {users.data.data.map((u: any) => (
                  <tr key={u.id} className="hover:bg-surface-2/40">
                    <td className="table-td"><button onClick={() => setDetail(u.id)} className="flex items-center gap-3 text-left"><Avatar name={u.full_name} src={u.avatar_url} size={34} /><div><p className="font-medium hover:text-brand-600">{u.full_name}{u.id === me.id && <span className="ml-1 text-xs text-muted">(you)</span>}</p><p className="text-xs text-muted">{u.email}</p></div></button></td>
                    <td className="table-td"><div className="flex flex-wrap gap-1">{u.roles.map((r: string) => <Badge key={r} tone={roleTone(r)} className="capitalize">{r}</Badge>)}</div></td>
                    <td className="table-td">{u.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Suspended</Badge>}</td>
                    <td className="table-td text-xs text-muted">{u.enrollments} enrollments{u.courses > 0 && ` · ${u.courses} courses`}<br />{u.last_login_at ? `seen ${timeAgo(u.last_login_at)}` : 'never signed in'}</td>
                    <td className="table-td text-muted">{date(u.created_at)}</td>
                    <td className="table-td">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" icon={<UserCog className="h-4 w-4" />} onClick={() => setRoles({ id: u.id, name: u.full_name, roles: u.roles })}>Roles</Button>
                        {u.id !== me.id && (u.is_active
                          ? <Button variant="ghost" size="sm" icon={<Ban className="h-4 w-4" />} onClick={() => setConfirm({ kind: 'suspend', user: u })}>Suspend</Button>
                          : <Button variant="ghost" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setConfirm({ kind: 'reactivate', user: u })}>Reactivate</Button>)}
                        {u.id !== me.id && <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirm({ kind: 'delete', user: u })} aria-label="Delete" />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination page={users.data.page} totalPages={users.data.total_pages} onChange={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); }} />
          <p className="mt-2 text-center text-xs text-muted">{users.data.total} users</p>
        </>
      )}

      {roles && (
        <Modal open onClose={() => setRoles(null)} title={`Roles — ${roles.name}`} size="sm" footer={<><Button variant="outline" onClick={() => setRoles(null)}>Cancel</Button><Button onClick={() => saveRoles.mutate()} loading={saveRoles.isPending} disabled={!roles.roles.length}>Save roles</Button></>}>
          <p className="mb-4 text-sm text-muted">A user can hold several roles. Their dashboard follows the highest one (admin › instructor › student).</p>
          <div className="space-y-2">{ROLES.map((r) => (
            <label key={r} className="flex cursor-pointer items-center justify-between rounded-xl border border-border px-4 py-3">
              <span className="font-medium capitalize">{r}</span>
              <Toggle checked={roles.roles.includes(r)} onChange={(on) => setRoles({ ...roles, roles: on ? [...roles.roles, r] : roles.roles.filter((x) => x !== r) })} label={r} />
            </label>
          ))}</div>
        </Modal>
      )}
      {detail && <UserDetail id={detail} onClose={() => setDetail(null)} />}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => act.mutate()} loading={act.isPending} danger={confirm?.kind !== 'reactivate'}
        title={confirm?.kind === 'delete' ? 'Delete this account?' : confirm?.kind === 'suspend' ? 'Suspend this account?' : 'Reactivate this account?'}
        message={confirm?.kind === 'delete' ? `${confirm.user.full_name}'s personal data will be anonymised and they will be signed out everywhere. Payment and audit records are kept. This can't be undone.` : confirm?.kind === 'suspend' ? `${confirm?.user.full_name} will be signed out immediately and unable to sign in.` : `${confirm?.user.full_name} will be able to sign in again.`}
        confirmLabel={confirm?.kind === 'delete' ? 'Delete account' : confirm?.kind === 'suspend' ? 'Suspend' : 'Reactivate'} />
    </div>
  );
}

function UserDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['admin-user', id], queryFn: async () => (await api.get(`/admin/users/${id}`)).data as any });
  return (
    <Modal open onClose={onClose} title="User details" size="lg">
      {q.isLoading ? <Skeleton className="h-60" /> : q.isError ? <ErrorState message={errMsg(q.error)} /> : (
        <div className="space-y-5">
          <div className="flex items-center gap-4"><Avatar name={q.data.full_name} src={q.data.avatar_url} size={56} /><div><p className="text-lg font-semibold">{q.data.full_name}</p><p className="text-sm text-muted">{q.data.email}</p><div className="mt-1 flex gap-1">{q.data.roles.map((r: string) => <Badge key={r} tone={roleTone(r)} className="capitalize">{r}</Badge>)}{!q.data.is_active && <Badge tone="danger">Suspended</Badge>}</div></div></div>
          {q.data.bio && <p className="text-sm text-muted">{q.data.bio}</p>}
          <div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-surface-2 p-3"><p className="text-muted">Joined</p><p className="font-semibold">{date(q.data.created_at)}</p></div><div className="rounded-xl bg-surface-2 p-3"><p className="text-muted">Last sign-in</p><p className="font-semibold">{q.data.last_login_at ? dateTime(q.data.last_login_at) : 'Never'}</p></div></div>
          {q.data.enrollments.length > 0 && <div><p className="mb-2 font-semibold">Enrollments</p><ul className="space-y-1">{q.data.enrollments.map((e: any) => <li key={e.id} className="flex justify-between text-sm"><span>{e.title}</span><span className="text-muted">{Math.round(e.progress_percent)}%</span></li>)}</ul></div>}
          {q.data.courses.length > 0 && <div><p className="mb-2 font-semibold">Courses taught</p><ul className="space-y-1">{q.data.courses.map((c: any) => <li key={c.id} className="flex justify-between text-sm"><span>{c.title}</span><Badge className="capitalize">{c.status}</Badge></li>)}</ul></div>}
          {q.data.activity.length > 0 && <div><p className="mb-2 font-semibold">Audit trail</p><ul className="space-y-1 text-xs text-muted">{q.data.activity.map((a: any, i: number) => <li key={i}>{dateTime(a.created_at)} — {a.action}</li>)}</ul></div>}
        </div>
      )}
    </Modal>
  );
}

export function AdminBroadcast() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: '', body: '', audience: 'all', email: false });
  const history = useQuery({ queryKey: ['broadcast-history'], queryFn: async () => (await api.get('/admin/notifications/history')).data.data as any[] });
  const send = useMutation({ mutationFn: async () => (await api.post('/admin/notifications', form)).data, onSuccess: (d) => { toast.success(`Sent to ${d.sent} user(s)`); setForm({ title: '', body: '', audience: 'all', email: false }); qc.invalidateQueries({ queryKey: ['broadcast-history'] }); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <div>
      <PageHeader title="Notifications" subtitle="Send an in-app notification (and optionally an email) to a group of users." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="p-6">
          <div className="space-y-4">
            <Field label="Audience"><Segmented value={form.audience} onChange={(v) => setForm({ ...form, audience: v })} options={[{ value: 'all', label: 'Everyone' }, { value: 'students', label: 'Students' }, { value: 'instructors', label: 'Instructors' }]} /></Field>
            <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Scheduled maintenance on Sunday" maxLength={150} /></Field>
            <Field label="Message"><Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="min-h-[140px]" maxLength={2000} /></Field>
            <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm"><span><b>Also send by email</b><br /><span className="text-muted">Emails are queued and sent by the background worker.</span></span><Toggle checked={form.email} onChange={(v) => setForm({ ...form, email: v })} label="Email" /></label>
            <Button onClick={() => send.mutate()} loading={send.isPending} disabled={form.title.trim().length < 3 || !form.body.trim()} icon={<Send className="h-4 w-4" />}>Send notification</Button>
          </div>
        </Card>
        <Card className="h-fit">
          <CardHeader title="Recent broadcasts" icon={<Megaphone className="h-5 w-5" />} />
          <div className="divide-y divide-border p-2">{!history.data?.length ? <p className="py-6 text-center text-sm text-muted">None yet.</p> : history.data.map((h, i) => (
            <div key={i} className="px-3 py-2.5 text-sm"><p className="font-medium capitalize">{h.metadata?.audience} · {h.metadata?.count} recipients</p><p className="text-xs text-muted">{h.actor} · {timeAgo(h.created_at)}</p></div>
          ))}</div>
        </Card>
      </div>
    </div>
  );
}

export function AdminAudit() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', page], queryFn: async () => (await api.get('/admin/audit-logs', { params: { page } })).data as any, placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Security-relevant actions: approvals, role changes, suspensions, deletions and moderation." />
      {q.isLoading ? <Skeleton className="h-96" /> : !q.data?.data.length ? <EmptyState icon={<FileClock className="h-6 w-6" />} title="No audit events yet" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-border bg-surface-2/50"><tr><th className="table-th">When</th><th className="table-th">Actor</th><th className="table-th">Action</th><th className="table-th">Details</th></tr></thead>
            <tbody className="divide-y divide-border">{q.data.data.map((a: any) => (
              <tr key={a.id}><td className="table-td whitespace-nowrap text-muted">{dateTime(a.created_at)}</td><td className="table-td">{a.actor_name ?? 'System'}</td><td className="table-td"><Badge tone="brand"><ShieldCheck className="h-3 w-3" />{a.action}</Badge></td><td className="table-td max-w-md truncate font-mono text-xs text-muted">{a.metadata && Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : a.entity}</td></tr>
            ))}</tbody>
          </table>
        </Card>
      )}
      <div className="mt-4 flex justify-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button><Button variant="outline" size="sm" disabled={(q.data?.data.length ?? 0) < 30} onClick={() => setPage(page + 1)}>Older</Button></div>
    </div>
  );
}
