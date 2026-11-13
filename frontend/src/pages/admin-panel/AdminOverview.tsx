import { useQuery } from '@tanstack/react-query';
import { Activity, Award, BookOpen, GraduationCap, MessagesSquare, Presentation, ShieldAlert, ShoppingCart, Sparkles, TrendingUp, Undo2, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AreaTrend, Bars, Donut } from '@/components/common/charts';
import { Avatar, Badge, Card, CardHeader, ErrorState, PageHeader, Skeleton, StatCard, statusTone } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import { compact, dateTime, inr, timeAgo } from '@/utils/format';

const DemoNote = () => <Badge tone="warning">Demo payments — no real gateway (out of scope)</Badge>;

export function AdminOverview() {
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: async () => (await api.get('/admin/analytics/overview')).data as any });
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <div className="space-y-6"><Skeleton className="h-20" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-80" /></div>;
  const { totals: t, daily, categories, top_courses, recent_users } = q.data;
  const chart = daily.map((d: any) => ({ ...d, label: new Date(d.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin panel" title="Platform overview" subtitle="Health, growth and governance across VertexLearn." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total users" value={compact(t.users)} icon={<Users className="h-[18px] w-[18px]" />} hint={`${t.suspended} suspended`} />
        <StatCard label="Students" value={compact(t.students)} icon={<GraduationCap className="h-[18px] w-[18px]" />} tone="sky" hint={`DAU ${t.dau} · MAU ${t.mau}`} />
        <StatCard label="Instructors" value={t.instructors} icon={<Presentation className="h-[18px] w-[18px]" />} tone="emerald" hint={`${t.admins} admin(s)`} />
        <StatCard label="Courses" value={t.courses} icon={<BookOpen className="h-[18px] w-[18px]" />} tone="amber" hint={`${t.approved_courses} live · ${t.pending_courses} pending`} />
        <StatCard label="Enrollments" value={compact(t.enrollments)} icon={<TrendingUp className="h-[18px] w-[18px]" />} hint={`${t.completion_rate}% completion rate`} />
        <StatCard label="Revenue" value={inr(t.revenue)} icon={<Wallet className="h-[18px] w-[18px]" />} tone="emerald" hint={`${inr(t.revenue_this_month)} this month (demo)`} />
        <StatCard label="AI tutor questions" value={compact(t.ai_questions)} icon={<Sparkles className="h-[18px] w-[18px]" />} tone="sky" hint={`${t.certificates} certificates issued`} />
        <StatCard label="Reported posts" value={t.flagged_posts} icon={<ShieldAlert className="h-[18px] w-[18px]" />} tone="rose" hint={<Link to="/admin/moderation" className="text-brand-600 hover:underline">Open moderation</Link>} />
      </div>

      <Card>
        <CardHeader title="Daily activity" subtitle="Daily active users, signups and enrollments — last 30 days" icon={<Activity className="h-5 w-5" />} />
        <div className="p-5 pt-3"><AreaTrend data={chart} x="label" series={[{ key: 'dau', name: 'Active users' }, { key: 'enrollments', name: 'Enrollments' }, { key: 'signups', name: 'Signups' }]} height={280} /></div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Top courses" subtitle="By enrollments" />
          <div className="overflow-x-auto p-2">
            <table className="w-full min-w-[520px]">
              <thead><tr><th className="table-th">Course</th><th className="table-th">Enrollments</th><th className="table-th">Completion</th><th className="table-th text-right">Revenue</th></tr></thead>
              <tbody className="divide-y divide-border">{top_courses.map((c: any) => (
                <tr key={c.id}><td className="table-td"><Link to={`/courses/${c.id}`} className="font-medium hover:text-brand-600">{c.title}</Link><p className="text-xs text-muted">{c.instructor_name}</p></td><td className="table-td">{c.enrollments}</td><td className="table-td">{c.completion_rate}%</td><td className="table-td text-right font-medium">{inr(c.revenue)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Enrollments by category" />
          <div className="p-5"><Donut data={categories} nameKey="name" valueKey="enrollments" /></div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Newest users" action={<Link to="/admin/users" className="text-sm font-medium text-brand-600 hover:underline">Manage users</Link>} />
          <div className="divide-y divide-border p-2">{recent_users.map((u: any) => (
            <div key={u.id} className="flex items-center gap-3 px-3 py-2.5"><Avatar name={u.full_name} size={32} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{u.full_name}</p><p className="truncate text-xs text-muted">{u.email}</p></div><Badge tone={u.role === 'admin' ? 'danger' : u.role === 'instructor' ? 'brand' : 'neutral'} className="capitalize">{u.role}</Badge><span className="hidden text-xs text-muted sm:block">{timeAgo(u.created_at)}</span></div>
          ))}</div>
        </Card>
        <Card>
          <CardHeader title="Governance" />
          <div className="grid grid-cols-2 gap-3 p-5">
            <Link to="/admin/courses" className="rounded-2xl border border-border p-4 transition hover:bg-surface-2"><BookOpen className="mb-2 h-5 w-5 text-amber-500" /><p className="text-2xl font-bold">{t.pending_courses}</p><p className="text-sm text-muted">Courses to review</p></Link>
            <Link to="/admin/moderation" className="rounded-2xl border border-border p-4 transition hover:bg-surface-2"><MessagesSquare className="mb-2 h-5 w-5 text-rose-500" /><p className="text-2xl font-bold">{t.flagged_posts}</p><p className="text-sm text-muted">Reported posts</p></Link>
            <Link to="/admin/users?status=suspended" className="rounded-2xl border border-border p-4 transition hover:bg-surface-2"><ShieldAlert className="mb-2 h-5 w-5 text-muted" /><p className="text-2xl font-bold">{t.suspended}</p><p className="text-sm text-muted">Suspended accounts</p></Link>
            <Link to="/admin/revenue" className="rounded-2xl border border-border p-4 transition hover:bg-surface-2"><Award className="mb-2 h-5 w-5 text-emerald-500" /><p className="text-2xl font-bold">{t.certificates}</p><p className="text-sm text-muted">Certificates issued</p></Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function AdminRevenue() {
  const q = useQuery({ queryKey: ['admin-revenue'], queryFn: async () => (await api.get('/admin/analytics/revenue')).data as any });
  if (q.isError) return <ErrorState message={errMsg(q.error)} />;
  if (q.isLoading) return <Skeleton className="h-96" />;
  const { totals, monthly, by_course, recent } = q.data;
  return (
    <div className="space-y-6">
      <PageHeader title="Revenue overview" subtitle="Course sales over the last 12 months." actions={<DemoNote />} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Gross revenue" value={inr(totals.gross)} icon={<Wallet className="h-[18px] w-[18px]" />} tone="emerald" />
        <StatCard label="Orders" value={totals.orders} icon={<ShoppingCart className="h-[18px] w-[18px]" />} />
        <StatCard label="Average order" value={inr(totals.avg_order)} icon={<TrendingUp className="h-[18px] w-[18px]" />} tone="sky" />
        <StatCard label="Refunds" value={inr(totals.refunds)} icon={<Undo2 className="h-[18px] w-[18px]" />} tone="rose" />
      </div>
      <Card>
        <CardHeader title="Monthly revenue" />
        <div className="p-5 pt-3"><Bars data={monthly} x="month" series={[{ key: 'revenue', name: 'Revenue' }]} format={(v) => `₹${compact(v)}`} height={280} /></div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Revenue by course" />
          <div className="overflow-x-auto p-2"><table className="w-full"><thead><tr><th className="table-th">Course</th><th className="table-th">Orders</th><th className="table-th text-right">Revenue</th></tr></thead>
            <tbody className="divide-y divide-border">{by_course.map((c: any) => <tr key={c.id}><td className="table-td"><p className="font-medium">{c.title}</p><p className="text-xs text-muted">{c.instructor_name}</p></td><td className="table-td">{c.orders}</td><td className="table-td text-right font-semibold">{inr(c.revenue)}</td></tr>)}</tbody></table></div>
        </Card>
        <Card>
          <CardHeader title="Recent transactions" />
          <div className="divide-y divide-border p-2">{recent.map((p: any) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.student_name ?? 'Deleted user'}</p><p className="truncate text-xs text-muted">{p.course_title} · {dateTime(p.created_at)}</p></div><Badge tone={statusTone(p.status)} className="capitalize">{p.status}</Badge><span className="w-20 text-right text-sm font-semibold">{inr(p.amount)}</span></div>
          ))}</div>
        </Card>
      </div>
    </div>
  );
}
