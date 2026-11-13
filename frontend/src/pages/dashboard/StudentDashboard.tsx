import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Award, BookOpen, CalendarClock, CheckCircle2, ClipboardList, Clock, Flame, GraduationCap, Megaphone, PlayCircle, Sparkles, Target, TrendingUp, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AreaTrend, LineTrend } from '@/components/common/charts';
import { CourseThumb } from '@/components/common/CourseVisuals';
import { BadgeIcon } from '@/pages/student/Achievements';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, ProgressBar, Skeleton, StatCard } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import { useAuth } from '@/store/auth';
import type { Enrollment } from '@/types';
import { date, dueLabel, money, timeAgo } from '@/utils/format';
import { useT } from '@/utils/i18n';

interface Dash {
  stats: { enrolled: number; completed: number; avg_progress: number; total_minutes: number; week_minutes: number; badges: number; total_badges: number; certificates: number; avg_quiz: number | null; lectures_completed: number };
  streak: { current_streak: number; longest_streak: number; last_active_date: string | null };
  activity: { day: string; minutes: number }[];
  continue_learning: Enrollment[];
  enrollments: Enrollment[];
  upcoming_assignments: { id: string; title: string; due_date: string; course_title: string; submitted: boolean }[];
  quiz_trend: { score: number; submitted_at: string; quiz_title: string }[];
  recent_activity: { kind: string; title: string; context: string; at: string; link: string }[];
  announcements: { id: string; title: string; content: string; created_at: string; course_title: string; course_id: string; author: string }[];
  mastery: { module_title: string; course_title: string; score: number }[];
  badges: { code: string; name: string; description: string; icon_url: string; earned_at: string }[];
}

const kindIcon: Record<string, JSX.Element> = {
  lecture: <PlayCircle className="h-4 w-4" />, quiz: <Target className="h-4 w-4" />, submission: <ClipboardList className="h-4 w-4" />,
  badge: <Award className="h-4 w-4" />, enroll: <GraduationCap className="h-4 w-4" />,
};

export function StudentDashboard() {
  const user = useAuth((s) => s.user)!;
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['dashboard', 'student'], queryFn: async () => (await api.get<Dash>('/dashboard/student')).data });
  const recs = useQuery({ queryKey: ['recommendations'], queryFn: async () => (await api.get('/recommendations/me')).data as { courses: any[]; topics: any[] } });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('greeting.morning') : hour < 17 ? t('greeting.afternoon') : t('greeting.evening');

  if (isError) return <ErrorState message={errMsg(error)} onRetry={() => refetch()} />;
  if (isLoading || !data) {
    return <div className="space-y-6"><Skeleton className="h-40" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-72" /></div>;
  }
  const { stats, streak } = data;
  const active = data.activity.some((a) => a.day === new Date().toISOString().slice(0, 10) && a.minutes > 0);
  const activityChart = data.activity.map((a) => ({ day: new Date(a.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), minutes: a.minutes }));

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-navy-800 p-6 text-white shadow-lift sm:p-8">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-white/70">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{greeting}, {user.full_name.split(' ')[0]} 👋</h1>
            <p className="mt-2 max-w-xl text-white/80">
              {data.continue_learning[0] ? <>Pick up where you left off in <b>{data.continue_learning[0].title}</b>{data.upcoming_assignments.filter((a) => !a.submitted).length > 0 && <> — and you have {data.upcoming_assignments.filter((a) => !a.submitted).length} assignment(s) coming up</>}.</> : 'Find a course you love and start your learning streak today.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {data.continue_learning[0] ? (
                <Link to={`/app/learn/${data.continue_learning[0].course_id}/${data.continue_learning[0].last_lecture_id ?? data.continue_learning[0].next_lecture?.id ?? ''}`}><Button variant="white" icon={<PlayCircle className="h-4 w-4" />}>Resume learning</Button></Link>
              ) : <Link to="/courses"><Button variant="white">Browse courses</Button></Link>}
              <Link to="/app/tutor"><Button variant="glass" icon={<Sparkles className="h-4 w-4" />}>Ask AI tutor</Button></Link>
            </div>
          </div>
          <div className="flex items-center gap-4 rounded-2xl bg-white/10 p-5 backdrop-blur">
            <div className={`grid h-14 w-14 place-items-center rounded-2xl ${streak.current_streak > 0 ? 'bg-amber-400 text-amber-950' : 'bg-white/15'}`}><Flame className="h-7 w-7" /></div>
            <div>
              <p className="text-3xl font-bold leading-none">{streak.current_streak}<span className="ml-1 text-base font-medium text-white/70">day streak</span></p>
              <p className="mt-1 text-sm text-white/70">{active ? 'You learned today — nice!' : streak.current_streak > 0 ? 'Learn today to keep it going' : 'Start a streak today'} · best {streak.longest_streak}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Courses in progress" value={stats.enrolled - stats.completed} icon={<BookOpen className="h-[18px] w-[18px]" />} hint={`${stats.completed} completed`} />
        <StatCard label="Average progress" value={`${Math.round(stats.avg_progress)}%`} icon={<TrendingUp className="h-[18px] w-[18px]" />} hint={`${stats.lectures_completed} lectures done`} tone="sky" />
        <StatCard label="Learning this week" value={`${Math.round(stats.week_minutes / 6) / 10}h`} icon={<Clock className="h-[18px] w-[18px]" />} hint={`${Math.round(stats.total_minutes / 60)}h total`} tone="emerald" />
        <StatCard label="Quiz average" value={stats.avg_quiz != null ? `${Math.round(stats.avg_quiz)}%` : '—'} icon={<Target className="h-[18px] w-[18px]" />} hint={`${stats.badges}/${stats.total_badges} badges · ${stats.certificates} certificates`} tone="amber" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Continue learning */}
        <Card className="xl:col-span-2">
          <CardHeader title="Continue learning" subtitle="Your courses in progress" action={<Link to="/app/learning" className="text-sm font-medium text-brand-600 hover:underline">View all</Link>} />
          <div className="space-y-3 p-5">
            {!data.continue_learning.length ? <EmptyState icon={<GraduationCap className="h-6 w-6" />} title="No courses in progress" description="Enroll in a course to see it here." action={<Link to="/courses"><Button>Browse courses</Button></Link>} /> : data.continue_learning.map((e) => (
              <Link key={e.id} to={`/app/learn/${e.course_id}/${e.last_lecture_id ?? e.next_lecture?.id ?? ''}`} className="group flex items-center gap-4 rounded-2xl border border-border p-3 transition hover:border-brand-300 hover:bg-surface-2/60">
                <div className="w-28 shrink-0 overflow-hidden rounded-xl sm:w-36"><CourseThumb minimal course={{ title: e.title, category: e.category, thumbnail_url: e.thumbnail_url }} /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-300">{e.title}</p>
                  <p className="truncate text-sm text-muted">Next: {e.next_lecture?.title ?? 'Review & certificate'}</p>
                  <div className="mt-2.5 flex items-center gap-3"><ProgressBar value={e.progress_percent} className="flex-1" /><span className="text-xs font-semibold">{Math.round(e.progress_percent)}%</span></div>
                  <p className="mt-1 text-xs text-muted">{e.completed_count} of {e.lecture_count} lectures</p>
                </div>
                <ArrowRight className="hidden h-5 w-5 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand-600 sm:block" />
              </Link>
            ))}
          </div>
        </Card>

        {/* Upcoming assignments */}
        <Card>
          <CardHeader title="Upcoming assignments" icon={<CalendarClock className="h-5 w-5" />} action={<Link to="/app/assignments" className="text-sm font-medium text-brand-600 hover:underline">All</Link>} />
          <div className="space-y-2 p-5">
            {!data.upcoming_assignments.length ? <p className="py-6 text-center text-sm text-muted">Nothing due — enjoy the breathing room.</p> : data.upcoming_assignments.map((a) => {
              const due = dueLabel(a.due_date);
              return (
                <Link key={a.id} to={`/app/assignments/${a.id}`} className="block rounded-xl border border-border p-3 transition hover:bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{a.title}</p>
                    {a.submitted ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" />Submitted</Badge> : <Badge tone={due.tone === 'neutral' ? 'neutral' : due.tone}>{due.text}</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{a.course_title}</p>
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Analytics */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Learning activity" subtitle="Minutes per day, last 14 days" />
          <div className="p-5 pt-3"><AreaTrend data={activityChart} x="day" series={[{ key: 'minutes', name: 'Minutes' }]} height={220} /></div>
        </Card>
        <Card>
          <CardHeader title="Quiz scores" subtitle="Your last 10 attempts" />
          <div className="p-5 pt-3">
            {data.quiz_trend.length ? <LineTrend data={data.quiz_trend.map((q, i) => ({ n: `#${i + 1}`, score: Math.round(q.score), quiz: q.quiz_title }))} x="n" series={[{ key: 'score', name: 'Score %' }]} domain={[0, 100]} height={220} /> : <p className="py-16 text-center text-sm text-muted">Take a quiz to see your trend.</p>}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Topic mastery */}
        <Card>
          <CardHeader title="Topic mastery" subtitle="From your quiz results" icon={<Target className="h-5 w-5" />} />
          <div className="space-y-3.5 p-5">
            {!data.mastery.length ? <p className="py-6 text-center text-sm text-muted">Mastery appears after your first quiz.</p> : data.mastery.map((m) => (
              <div key={m.module_title + m.course_title}>
                <div className="mb-1 flex justify-between text-sm"><span className="truncate pr-2 font-medium">{m.module_title}</span><span className={m.score < 60 ? 'font-semibold text-rose-600' : 'font-semibold'}>{Math.round(m.score)}%</span></div>
                <ProgressBar value={m.score} size="sm" />
                <p className="mt-0.5 truncate text-xs text-muted">{m.course_title}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Recommendations */}
        <Card>
          <CardHeader title="Recommended for you" icon={<Sparkles className="h-5 w-5" />} subtitle="Based on your quizzes and interests" />
          <div className="space-y-3 p-5">
            {recs.data?.topics.slice(0, 2).map((t) => (
              <Link key={t.module_id} to={`/app/learn/${t.course_id}/${t.first_lecture_id ?? ''}`} className="block rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-sm transition hover:bg-rose-50 dark:border-rose-500/25 dark:bg-rose-500/5">
                <p className="font-medium">Revisit: {t.module_title}</p><p className="text-xs text-muted">{t.reason}</p>
              </Link>
            ))}
            {recs.data?.courses.slice(0, 3).map((c) => (
              <Link key={c.id} to={`/courses/${c.id}`} className="flex items-center gap-3 rounded-xl border border-border p-2.5 transition hover:bg-surface-2">
                <div className="w-20 shrink-0 overflow-hidden rounded-lg"><CourseThumb minimal course={c} /></div>
                <div className="min-w-0"><p className="truncate text-sm font-medium">{c.title}</p><p className="line-clamp-2 text-xs text-muted">{c.reason}</p><p className="text-xs font-semibold">{money(c.price)}</p></div>
              </Link>
            ))}
            {recs.isLoading && <Skeleton className="h-20" />}
            {recs.data && !recs.data.courses.length && !recs.data.topics.length && <p className="py-6 text-center text-sm text-muted">You're enrolled in everything — impressive!</p>}
          </div>
        </Card>

        {/* Badges + announcements */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Recent badges" icon={<Trophy className="h-5 w-5" />} action={<Link to="/app/achievements" className="text-sm font-medium text-brand-600 hover:underline">All</Link>} />
            <div className="grid grid-cols-4 gap-2 p-5">
              {data.badges.length ? data.badges.map((b) => (
                <div key={b.code} className="flex flex-col items-center gap-1.5 text-center" title={b.description}><BadgeIcon icon={b.icon_url} earned size="sm" /><span className="text-[11px] font-medium leading-tight">{b.name}</span></div>
              )) : <p className="col-span-4 py-3 text-center text-sm text-muted">Complete a lecture to earn your first badge.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Announcements" icon={<Megaphone className="h-5 w-5" />} />
            <div className="space-y-3 p-5">
              {!data.announcements.length ? <p className="text-center text-sm text-muted">No announcements.</p> : data.announcements.map((a) => (
                <Link key={a.id} to={`/app/learn/${a.course_id}?tab=announcements`} className="block border-l-2 border-brand-400 pl-3">
                  <p className="text-sm font-medium">{a.title}</p><p className="line-clamp-2 text-xs text-muted">{a.content}</p><p className="mt-0.5 text-[11px] text-muted">{a.course_title} · {timeAgo(a.created_at)}</p>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader title="Recent activity" />
        <ul className="divide-y divide-border p-2">
          {data.recent_activity.map((r, i) => (
            <li key={i}>
              <Link to={r.link} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-surface-2">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">{kindIcon[r.kind]}</div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{r.title}</p><p className="truncate text-xs text-muted">{r.kind === 'lecture' ? `Completed · ${r.context}` : r.context}</p></div>
                <span className="text-xs text-muted">{timeAgo(r.at)}</span>
              </Link>
            </li>
          ))}
          {!data.recent_activity.length && <li className="py-8 text-center text-sm text-muted">Your activity will show up here.</li>}
        </ul>
      </Card>
      <p className="text-center text-xs text-muted">Member since {date(user.created_at)}</p>
    </div>
  );
}
