import { useQuery } from '@tanstack/react-query';
import { BarChart3, ClipboardCheck, Layers, Plus, Star, Target, TrendingUp, Users, Wallet, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaTrend, Bars } from '@/components/common/charts';
import { CourseThumb } from '@/components/common/CourseVisuals';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, ProgressBar, Select, Skeleton, StatCard, statusTone } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import { useAuth } from '@/store/auth';
import { inr, timeAgo } from '@/utils/format';
import { CourseAnalyticsPanel } from './CourseEditor';

function useOverview() {
  return useQuery({ queryKey: ['instructor-overview'], queryFn: async () => (await api.get('/instructor/analytics/overview')).data as any });
}

export function InstructorDashboard() {
  const user = useAuth((s) => s.user)!;
  const q = useOverview();
  if (q.isError) return <ErrorState message={errMsg(q.error)} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <div className="space-y-6"><Skeleton className="h-24" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-72" /></div>;
  const { stats, enroll_trend, courses, recent_submissions, draft_quizzes } = q.data;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Instructor workspace" title={`Welcome back, ${user.full_name.split(' ')[0]}`} subtitle="Here's how your courses are doing."
        actions={<Link to="/instructor/courses/new"><Button icon={<Plus className="h-4 w-4" />}>Create course</Button></Link>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Students" value={stats.students} icon={<Users className="h-[18px] w-[18px]" />} hint={`${stats.enrollments} enrollments`} />
        <StatCard label="Live courses" value={stats.live_courses} icon={<Layers className="h-[18px] w-[18px]" />} hint={`${stats.pending_courses} awaiting approval`} tone="sky" />
        <StatCard label="Avg. quiz score" value={stats.avg_quiz != null ? `${Math.round(stats.avg_quiz)}%` : '—'} icon={<Target className="h-[18px] w-[18px]" />} hint={`Avg. progress ${Math.round(stats.avg_progress)}%`} tone="emerald" />
        <StatCard label="Revenue (demo)" value={inr(stats.revenue)} icon={<Wallet className="h-[18px] w-[18px]" />} hint={stats.avg_rating ? <span className="flex items-center gap-1"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{stats.avg_rating.toFixed(1)} avg rating</span> : 'No ratings yet'} tone="amber" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="New enrollments" subtitle="Last 30 days" icon={<TrendingUp className="h-5 w-5" />} />
          <div className="p-5 pt-3"><AreaTrend data={enroll_trend.map((d: any) => ({ ...d, label: new Date(d.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }))} x="label" series={[{ key: 'enrollments', name: 'Enrollments' }]} /></div>
        </Card>
        <Card>
          <CardHeader title="Needs your attention" />
          <div className="space-y-3 p-5">
            <Link to="/instructor/grading" className="flex items-center gap-3 rounded-xl border border-border p-3 transition hover:bg-surface-2">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/15"><ClipboardCheck className="h-5 w-5" /></div>
              <div className="flex-1"><p className="text-sm font-semibold">{stats.to_grade} submissions to grade</p><p className="text-xs text-muted">Open the grading queue</p></div>
            </Link>
            {draft_quizzes.map((d: any) => (
              <Link key={d.id} to={`/instructor/quizzes/${d.id}`} className="flex items-center gap-3 rounded-xl border border-border p-3 transition hover:bg-surface-2">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15"><Wand2 className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">Review AI quiz: {d.title}</p><p className="truncate text-xs text-muted">{d.course_title}</p></div>
              </Link>
            ))}
            {!stats.to_grade && !draft_quizzes.length && <p className="py-4 text-center text-sm text-muted">All caught up 🎉</p>}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Your courses" action={<Link to="/instructor/courses" className="text-sm font-medium text-brand-600 hover:underline">Manage</Link>} />
          <div className="overflow-x-auto p-2">
            {!courses.length ? <div className="p-3"><EmptyState title="No courses yet" action={<Link to="/instructor/courses/new"><Button>Create your first course</Button></Link>} /></div> : (
              <table className="w-full min-w-[560px]">
                <thead><tr><th className="table-th">Course</th><th className="table-th">Students</th><th className="table-th">Avg. progress</th><th className="table-th">Quiz avg.</th><th className="table-th">Status</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {courses.map((c: any) => (
                    <tr key={c.id} className="hover:bg-surface-2/50">
                      <td className="table-td"><Link to={`/instructor/courses/${c.id}`} className="flex items-center gap-3 font-medium hover:text-brand-600"><div className="w-16 overflow-hidden rounded-lg"><CourseThumb minimal course={{ ...c, category: null }} /></div><span className="line-clamp-2">{c.title}</span></Link></td>
                      <td className="table-td">{c.students}</td>
                      <td className="table-td"><div className="flex items-center gap-2"><ProgressBar value={c.avg_progress} size="sm" className="w-20" /><span className="text-xs">{Math.round(c.avg_progress)}%</span></div></td>
                      <td className="table-td">{c.avg_quiz != null ? `${Math.round(c.avg_quiz)}%` : '—'}</td>
                      <td className="table-td"><Badge tone={statusTone(c.status)} className="capitalize">{c.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent submissions" />
          <div className="divide-y divide-border p-2">
            {!recent_submissions.length ? <p className="py-8 text-center text-sm text-muted">No submissions yet.</p> : recent_submissions.map((s: any) => (
              <Link key={s.id} to={`/instructor/grading?assignment=${s.assignment_id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{s.full_name}</p><p className="truncate text-xs text-muted">{s.assignment_title} · {timeAgo(s.submitted_at)}</p></div>
                {s.grade != null ? <Badge tone="success">{s.grade}</Badge> : <Badge tone="warning">To grade</Badge>}
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Instructor analytics (FR-I5): pick a course to see drop-off, quiz scores, time-on-task and topic struggle. */
export function InstructorAnalytics() {
  const q = useOverview();
  const [courseId, setCourseId] = useState('');
  const courses = q.data?.courses ?? [];
  const cid = courseId || courses[0]?.id;
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Per-lecture drop-off, quiz performance, time-on-task and where students struggle."
        actions={courses.length > 0 && <Select value={cid} onChange={(e) => setCourseId(e.target.value)} className="sm:w-80" aria-label="Course">{courses.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>} />
      {q.isLoading ? <Skeleton className="h-80" /> : !courses.length ? <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No courses yet" /> : (
        <>
          <Card>
            <CardHeader title="Course comparison" subtitle="Students and completions per course" />
            <div className="p-5 pt-3"><Bars data={courses.map((c: any) => ({ name: c.title.length > 22 ? `${c.title.slice(0, 22)}…` : c.title, students: c.students, completions: c.completions }))} x="name" series={[{ key: 'students', name: 'Students' }, { key: 'completions', name: 'Completions' }]} /></div>
          </Card>
          {cid && <CourseAnalyticsPanel courseId={cid} />}
        </>
      )}
    </div>
  );
}
