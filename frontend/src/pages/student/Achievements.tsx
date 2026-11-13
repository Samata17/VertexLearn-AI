import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Award, Crown, Download, ExternalLink, Flame, Footprints, Loader2, Lock, Medal, MessageCircle, Sparkles, Target, Trophy, Upload, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ActivityHeatmap } from '@/components/common/charts';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select, Skeleton, StatCard } from '@/components/common/ui';
import { api, downloadFile, errMsg } from '@/services/api';
import { useAuth } from '@/store/auth';
import type { Enrollment } from '@/types';
import { date } from '@/utils/format';

const ICONS: Record<string, typeof Award> = { footprints: Footprints, trophy: Trophy, flame: Flame, zap: Zap, target: Target, sparkles: Sparkles, 'message-circle': MessageCircle, upload: Upload };
export function BadgeIcon({ icon, earned, size = 'md' }: { icon: string; earned: boolean; size?: 'sm' | 'md' }) {
  const Icon = ICONS[icon] ?? Award;
  return (
    <div className={clsx('grid place-items-center rounded-2xl', size === 'sm' ? 'h-11 w-11' : 'h-16 w-16', earned ? 'bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/20' : 'bg-surface-2 text-muted')}>
      {earned ? <Icon className={size === 'sm' ? 'h-5 w-5' : 'h-7 w-7'} /> : <Lock className={size === 'sm' ? 'h-4 w-4' : 'h-6 w-6'} />}
    </div>
  );
}

export function Achievements() {
  const qc = useQueryClient();
  const badges = useQuery({ queryKey: ['badges'], queryFn: async () => (await api.get('/users/me/badges')).data.data as any[] });
  const streak = useQuery({ queryKey: ['streak'], queryFn: async () => (await api.get('/users/me/streak')).data as any });
  const certs = useQuery({ queryKey: ['certificates'], queryFn: async () => (await api.get('/certificates/me')).data as { data: any[]; pending: any[] }, refetchInterval: (q) => (q.state.data?.pending.length ? 5000 : false) });
  const [downloading, setDownloading] = useState<string | null>(null);
  const generate = useMutation({ mutationFn: (courseId: string) => api.post(`/certificates/generate/${courseId}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['certificates'] }), onError: (e) => toast.error(errMsg(e)) });
  const download = async (c: any) => {
    setDownloading(c.id);
    try { await downloadFile(`/certificates/${c.id}/download`, `VertexLearn-Certificate-${c.certificate_code}.pdf`); toast.success('Certificate downloaded'); }
    catch (e) { toast.error(errMsg(e)); } finally { setDownloading(null); }
  };
  const earned = badges.data?.filter((b) => b.earned).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Achievements" subtitle="Your streaks, badges and certificates." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Current streak" value={`${streak.data?.current_streak ?? 0} days`} icon={<Flame className="h-[18px] w-[18px]" />} tone="amber" hint={`Longest: ${streak.data?.longest_streak ?? 0} days`} />
        <StatCard label="Badges earned" value={`${earned} / ${badges.data?.length ?? 0}`} icon={<Medal className="h-[18px] w-[18px]" />} />
        <StatCard label="Certificates" value={certs.data?.data.length ?? 0} icon={<Award className="h-[18px] w-[18px]" />} tone="emerald" />
      </div>

      <Card>
        <CardHeader title="Learning activity" subtitle="Last 12 weeks — each square is a day" icon={<Flame className="h-5 w-5" />} />
        <div className="p-5">{streak.isLoading ? <Skeleton className="h-32" /> : <ActivityHeatmap days={streak.data?.activity ?? []} />}</div>
      </Card>

      <Card>
        <CardHeader title="Certificates" subtitle="Earned by completing 100% of a course" icon={<Award className="h-5 w-5" />} />
        <div className="grid gap-4 p-5 md:grid-cols-2">
          {certs.isLoading ? <Skeleton className="h-36" /> : !certs.data?.data.length && !certs.data?.pending.length ? (
            <div className="md:col-span-2"><EmptyState icon={<Award className="h-6 w-6" />} title="No certificates yet" description="Finish every lecture in a course to earn its certificate." action={<Link to="/app/learning"><Button>Continue learning</Button></Link>} /></div>
          ) : (
            <>
              {certs.data!.data.map((c) => (
                <div key={c.id} className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-brand-50 via-surface to-amber-50/40 p-5 dark:from-brand-500/10 dark:via-surface dark:to-amber-500/5">
                  <Award className="absolute -right-4 -top-4 h-24 w-24 text-brand-200/60 dark:text-brand-500/10" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">Certificate of completion</p>
                  <p className="mt-1 pr-10 text-lg font-bold">{c.course_title}</p>
                  <p className="text-sm text-muted">Instructor: {c.instructor_name} · Issued {date(c.issued_at)}</p>
                  <p className="mt-1 font-mono text-xs text-muted">ID {c.certificate_code}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => download(c)} loading={downloading === c.id} icon={<Download className="h-4 w-4" />}>Download PDF</Button>
                    <Link to={`/verify/${c.certificate_code}`} target="_blank"><Button size="sm" variant="outline" icon={<ExternalLink className="h-4 w-4" />}>Verify link</Button></Link>
                  </div>
                </div>
              ))}
              {certs.data!.pending.map((p) => (
                <div key={p.course_id} className="flex flex-col justify-center rounded-2xl border border-dashed border-border p-5">
                  <p className="font-semibold">{p.course_title}</p>
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Generating your certificate…</p>
                  <Button size="sm" variant="ghost" className="mt-2 w-fit" onClick={() => generate.mutate(p.course_id)} loading={generate.isPending}>Generate now</Button>
                </div>
              ))}
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Badges" subtitle="Milestones you've reached" icon={<Medal className="h-5 w-5" />} />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {badges.isLoading ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />) : badges.data?.map((b) => (
            <div key={b.id} className={clsx('flex flex-col items-center rounded-2xl border p-5 text-center', b.earned ? 'border-amber-200 bg-amber-50/40 dark:border-amber-500/20 dark:bg-amber-500/5' : 'border-border opacity-70')}>
              <BadgeIcon icon={b.icon_url} earned={b.earned} />
              <p className="mt-3 font-semibold">{b.name}</p>
              <p className="mt-0.5 text-xs text-muted">{b.description}</p>
              {b.earned ? <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-300">Earned {date(b.earned_at)}</p> : <p className="mt-2 text-[11px] text-muted">Locked</p>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function Leaderboard() {
  const me = useAuth((s) => s.user)!;
  const enrollments = useQuery({ queryKey: ['enrollments'], queryFn: async () => (await api.get<{ data: Enrollment[] }>('/enrollments/me')).data.data });
  const [scope, setScope] = useState('global');
  const lb = useQuery({ queryKey: ['leaderboard', scope], queryFn: async () => (await api.get(scope === 'global' ? '/leaderboard' : `/leaderboard/${scope}`)).data as { data: any[]; me: any } });
  const rows = lb.data?.data ?? [];
  const top3 = rows.slice(0, 3);
  return (
    <div>
      <PageHeader title="Leaderboard" subtitle="Points: 10 per lecture completed + your best score on each quiz + 50 per course completed."
        actions={<Select value={scope} onChange={(e) => setScope(e.target.value)} className="sm:w-72" aria-label="Leaderboard scope"><option value="global">All courses</option>{enrollments.data?.map((e) => <option key={e.course_id} value={e.course_id}>{e.title}</option>)}</Select>} />
      {lb.isLoading ? <Skeleton className="h-96" /> : !rows.length ? <EmptyState icon={<Trophy className="h-6 w-6" />} title="No rankings yet" /> : (
        <>
          <div className="mb-6 grid grid-cols-3 items-end gap-3 sm:gap-6">
            {[top3[1], top3[0], top3[2]].map((r, i) => r && (
              <Card key={r.user_id} className={clsx('flex flex-col items-center p-4 text-center sm:p-6', i === 1 && 'border-amber-300 shadow-lift dark:border-amber-500/40')}>
                {i === 1 ? <Crown className="mb-2 h-6 w-6 text-amber-500" /> : <Medal className={clsx('mb-2 h-5 w-5', i === 0 ? 'text-slate-400' : 'text-orange-400')} />}
                <Avatar name={r.full_name} src={r.avatar_url} size={i === 1 ? 64 : 52} />
                <p className="mt-2 truncate text-sm font-semibold">{r.full_name}</p>
                <p className="text-lg font-bold text-brand-600">{r.points.toLocaleString()}</p>
                <p className="text-xs text-muted">#{r.rank}</p>
              </Card>
            ))}
          </div>
          <Card className="overflow-hidden">
            <table className="w-full">
              <thead className="border-b border-border bg-surface-2/50"><tr><th className="table-th w-16">Rank</th><th className="table-th">Learner</th><th className="table-th hidden sm:table-cell">Lectures</th><th className="table-th hidden sm:table-cell">Quiz avg</th><th className="table-th hidden md:table-cell">Streak</th><th className="table-th text-right">Points</th></tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.user_id} className={clsx(r.user_id === me.id && 'bg-brand-50/60 dark:bg-brand-500/10')}>
                    <td className="table-td font-semibold">#{r.rank}</td>
                    <td className="table-td"><div className="flex items-center gap-3"><Avatar name={r.full_name} src={r.avatar_url} size={30} /><span className="font-medium">{r.full_name}{r.user_id === me.id && <Badge tone="brand" className="ml-2">You</Badge>}</span></div></td>
                    <td className="table-td hidden sm:table-cell">{r.lectures_completed}</td>
                    <td className="table-td hidden sm:table-cell">{r.avg_quiz ? `${Math.round(r.avg_quiz)}%` : '—'}</td>
                    <td className="table-td hidden md:table-cell">{r.streak > 0 ? <span className="inline-flex items-center gap-1"><Flame className="h-3.5 w-3.5 text-amber-500" />{r.streak}</span> : '—'}</td>
                    <td className="table-td text-right font-bold">{r.points.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
