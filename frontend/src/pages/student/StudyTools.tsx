import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { BookMarked, CalendarCheck2, ChevronLeft, ChevronRight, Clock, Layers, MessageCircleQuestion, NotebookPen, PlayCircle, RefreshCw, Search, Shuffle, Sparkles, Target, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Markdown } from '@/components/common/Markdown';
import { Badge, Button, Card, CardHeader, DemoBadge, EmptyState, Field, Input, PageHeader, Segmented, Select, Skeleton, Textarea } from '@/components/common/ui';
import { useDebounce } from '@/hooks/useDebounce';
import { api, errMsg } from '@/services/api';
import type { CourseDetail, Enrollment } from '@/types';
import { clock, date, timeAgo } from '@/utils/format';

function useEnrollments() {
  return useQuery({ queryKey: ['enrollments'], queryFn: async () => (await api.get<{ data: Enrollment[] }>('/enrollments/me')).data.data });
}

// ---------------------------------------------------------------------------
// Flashcards (FR-A7)
// ---------------------------------------------------------------------------
export function Flashcards() {
  const [params, setParams] = useSearchParams();
  const enrollments = useEnrollments();
  const courseId = params.get('course') ?? enrollments.data?.[0]?.course_id ?? '';
  const course = useQuery({ queryKey: ['course', courseId, true], enabled: !!courseId, queryFn: async () => (await api.get<CourseDetail>(`/courses/${courseId}`)).data });
  const moduleId = params.get('module') ?? course.data?.modules[0]?.id ?? '';
  const qc = useQueryClient();
  const cards = useQuery({ queryKey: ['flashcards', moduleId], enabled: !!moduleId, queryFn: async () => (await api.get(`/ai/modules/${moduleId}/flashcards`)).data.data as { id: string; question: string; answer: string; is_demo: boolean }[] });
  const generate = useMutation({
    mutationFn: () => api.post(`/ai/modules/${moduleId}/flashcards`, { count: 10 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['flashcards', moduleId] }); toast.success('Flashcards ready'); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const [order, setOrder] = useState<number[]>([]);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<string>>(new Set());
  useEffect(() => { setOrder((cards.data ?? []).map((_, k) => k)); setI(0); setFlipped(false); setKnown(new Set()); }, [cards.data]);

  const deck = cards.data ?? [];
  const card = deck[order[i]];
  const go = (d: number) => { setFlipped(false); setI((x) => (x + d + order.length) % order.length); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f); }
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const setP = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); if (k === 'course') p.delete('module'); setParams(p, { replace: true }); };

  return (
    <div>
      <PageHeader title="Flashcards" subtitle="Spaced revision, one idea per card. Generated from each module's lectures." />
      <Card className="mb-6 grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Course"><Select value={courseId} onChange={(e) => setP('course', e.target.value)}>{enrollments.data?.map((e) => <option key={e.course_id} value={e.course_id}>{e.title}</option>)}</Select></Field>
        <Field label="Module"><Select value={moduleId} onChange={(e) => setP('module', e.target.value)} disabled={!course.data}>{course.data?.modules.map((m, k) => <option key={m.id} value={m.id}>Module {k + 1}: {m.title}</option>)}</Select></Field>
      </Card>
      {!enrollments.isLoading && !enrollments.data?.length ? <EmptyState icon={<Layers className="h-6 w-6" />} title="Enroll in a course first" action={<Link to="/courses"><Button>Browse courses</Button></Link>} />
        : cards.isLoading || !moduleId ? <Skeleton className="mx-auto h-80 max-w-2xl" />
        : !deck.length ? (
          <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No flashcards for this module yet" description="Generate a deck from this module's lecture material."
            action={<Button onClick={() => generate.mutate()} loading={generate.isPending} icon={<Sparkles className="h-4 w-4" />}>Generate flashcards</Button>} />
        ) : (
          <div className="mx-auto max-w-2xl">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-muted">Card {i + 1} of {deck.length} · {known.size} known</span>
              <div className="flex items-center gap-2">
                {deck[0]?.is_demo && <DemoBadge />}
                <Button variant="ghost" size="sm" icon={<Shuffle className="h-4 w-4" />} onClick={() => { setOrder([...order].sort(() => Math.random() - 0.5)); setI(0); setFlipped(false); }}>Shuffle</Button>
              </div>
            </div>
            <button onClick={() => setFlipped((f) => !f)} className="group block w-full [perspective:1200px]" aria-label={flipped ? 'Show question' : 'Show answer'}>
              <div className={clsx('relative h-80 w-full transition-transform duration-500 [transform-style:preserve-3d]', flipped && '[transform:rotateY(180deg)]')}>
                <div className="card absolute inset-0 flex flex-col items-center justify-center p-8 text-center [backface-visibility:hidden]">
                  <Badge tone="brand" className="mb-4">Question</Badge>
                  <p className="text-xl font-semibold leading-relaxed">{card?.question}</p>
                  <p className="absolute bottom-4 text-xs text-muted">Click or press Space to flip</p>
                </div>
                <div className="card absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-brand-600 to-navy-800 p-8 text-center text-white [backface-visibility:hidden] [transform:rotateY(180deg)]">
                  <Badge className="mb-4 bg-white/15 text-white">Answer</Badge>
                  <p className="text-lg leading-relaxed">{card?.answer}</p>
                </div>
              </div>
            </button>
            <div className="mt-5 flex items-center justify-between gap-2">
              <Button variant="outline" onClick={() => go(-1)} icon={<ChevronLeft className="h-4 w-4" />}>Prev</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { const s = new Set(known); s.delete(card.id); setKnown(s); go(1); }}>Still learning</Button>
                <Button variant="secondary" onClick={() => { setKnown(new Set(known).add(card.id)); go(1); }}>I know this</Button>
              </div>
              <Button variant="outline" onClick={() => go(1)} className="flex-row-reverse" icon={<ChevronRight className="h-4 w-4" />}>Next</Button>
            </div>
          </div>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Study plan (FR-A4)
// ---------------------------------------------------------------------------
interface Plan { overview: string; weekly_hours: number; weeks: { week: number; focus: string; goals: string[]; tasks: { title: string; type: string; lecture_id: string; minutes: number }[] }[]; tips: string[]; is_demo: boolean }
const taskIcon: Record<string, JSX.Element> = { watch: <PlayCircle className="h-4 w-4" />, review: <BookMarked className="h-4 w-4" />, quiz: <Target className="h-4 w-4" />, practice: <NotebookPen className="h-4 w-4" />, ask_tutor: <MessageCircleQuestion className="h-4 w-4" /> };

export function StudyPlan() {
  const enrollments = useEnrollments();
  const qc = useQueryClient();
  const [courseId, setCourseId] = useState('');
  const [weeks, setWeeks] = useState('2');
  const [hours, setHours] = useState('5');
  const [goal, setGoal] = useState('');
  const cid = courseId || enrollments.data?.find((e) => !e.completed_at)?.course_id || enrollments.data?.[0]?.course_id || '';
  const plans = useQuery({ queryKey: ['study-plans', cid], enabled: !!cid, queryFn: async () => (await api.get(`/ai/study-plan?course_id=${cid}`)).data.data as { id: string; plan_json: Plan; generated_at: string; is_demo: boolean }[] });
  const gen = useMutation({
    mutationFn: () => api.post('/ai/study-plan', { course_id: cid, weeks: Number(weeks), hours_per_week: Number(hours), goal: goal || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['study-plans', cid] }); toast.success('Your study plan is ready'); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const [done, setDone] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('vl-plan-done') ?? '{}'); } catch { return {}; } });
  const toggle = (k: string) => { const n = { ...done, [k]: !done[k] }; setDone(n); try { localStorage.setItem('vl-plan-done', JSON.stringify(n)); } catch { /* ignore */ } };
  const latest = plans.data?.[0];

  return (
    <div>
      <PageHeader title="Personalized study plan" subtitle="Built from your quiz history, topic mastery and unfinished lectures." />
      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <Card className="h-fit p-5">
          <h2 className="mb-4 font-semibold">Plan settings</h2>
          <div className="space-y-4">
            <Field label="Course"><Select value={cid} onChange={(e) => setCourseId(e.target.value)}>{enrollments.data?.map((e) => <option key={e.course_id} value={e.course_id}>{e.title}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Weeks"><Select value={weeks} onChange={(e) => setWeeks(e.target.value)}>{[1, 2, 3, 4, 6, 8].map((w) => <option key={w}>{w}</option>)}</Select></Field>
              <Field label="Hours / week"><Select value={hours} onChange={(e) => setHours(e.target.value)}>{[2, 3, 5, 8, 10, 15].map((h) => <option key={h}>{h}</option>)}</Select></Field>
            </div>
            <Field label="Goal (optional)"><Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Prepare for my exam on 20 Nov" className="min-h-[70px]" maxLength={500} /></Field>
            <Button className="w-full" onClick={() => gen.mutate()} loading={gen.isPending} disabled={!cid} icon={<Sparkles className="h-4 w-4" />}>{latest ? 'Regenerate plan' : 'Generate my plan'}</Button>
          </div>
        </Card>
        <div>
          {plans.isLoading ? <Skeleton className="h-96" /> : !latest ? (
            <EmptyState icon={<CalendarCheck2 className="h-6 w-6" />} title="No plan yet" description="Choose a course and your available time, and the tutor will plan your weeks around your weakest topics." />
          ) : (
            <div className="space-y-5 animate-fade-in">
              <Card className="p-6">
                <div className="mb-2 flex flex-wrap items-center gap-2"><Badge tone="brand"><Clock className="h-3 w-3" />{latest.plan_json.weekly_hours} h / week</Badge>{latest.is_demo && <DemoBadge />}<span className="text-xs text-muted">Generated {timeAgo(latest.generated_at)}</span></div>
                <Markdown>{latest.plan_json.overview}</Markdown>
              </Card>
              {latest.plan_json.weeks.map((w) => {
                const total = w.tasks.reduce((s, t) => s + t.minutes, 0);
                return (
                  <Card key={w.week}>
                    <CardHeader title={`Week ${w.week}: ${w.focus}`} subtitle={`${w.tasks.length} tasks · ${Math.round(total / 6) / 10} h`} />
                    <div className="p-5 pt-3">
                      {w.goals.length > 0 && <ul className="mb-3 flex flex-wrap gap-2">{w.goals.map((g) => <li key={g} className="chip bg-surface-2 text-muted">🎯 {g}</li>)}</ul>}
                      <ul className="space-y-2">
                        {w.tasks.map((t, k) => {
                          const key = `${latest.id}-${w.week}-${k}`;
                          return (
                            <li key={key} className={clsx('flex items-center gap-3 rounded-xl border border-border p-3', done[key] && 'opacity-60')}>
                              <input type="checkbox" checked={!!done[key]} onChange={() => toggle(key)} className="h-4 w-4 accent-brand-600" aria-label={`Mark "${t.title}" done`} />
                              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">{taskIcon[t.type] ?? taskIcon.practice}</span>
                              <span className={clsx('flex-1 text-sm', done[key] && 'line-through')}>{t.title}</span>
                              <span className="text-xs text-muted">{t.minutes} min</span>
                              {t.lecture_id ? <Link to={`/app/learn/${cid}/${t.lecture_id}`}><Button size="sm" variant="ghost">Open</Button></Link> : t.type === 'ask_tutor' ? <Link to={`/app/tutor?course=${cid}`}><Button size="sm" variant="ghost">Ask</Button></Link> : t.type === 'quiz' ? <Link to="/app/quizzes"><Button size="sm" variant="ghost">Quizzes</Button></Link> : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </Card>
                );
              })}
              {latest.plan_json.tips.length > 0 && <Card className="p-5"><h3 className="mb-2 font-semibold">Tips</h3><ul className="list-disc space-y-1 pl-5 text-sm text-muted">{latest.plan_json.tips.map((t) => <li key={t}>{t}</li>)}</ul></Card>}
              {plans.data!.length > 1 && <p className="text-center text-xs text-muted">{plans.data!.length - 1} earlier plan(s) · last on {date(plans.data![1].generated_at)}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes & bookmarks across all courses
// ---------------------------------------------------------------------------
export function Notes() {
  const [tab, setTab] = useState<'notes' | 'bookmarks'>('notes');
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const qc = useQueryClient();
  const notes = useQuery({ queryKey: ['notes', dq], queryFn: async () => (await api.get('/notes/me', { params: { q: dq || undefined } })).data.data as any[] });
  const bookmarks = useQuery({ queryKey: ['bookmarks'], queryFn: async () => (await api.get('/bookmarks/me')).data.data as any[] });
  const delNote = useMutation({ mutationFn: (id: string) => api.delete(`/notes/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }) });
  const delBm = useMutation({ mutationFn: (id: string) => api.delete(`/bookmarks/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['bookmarks'] }) });
  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const n of (tab === 'notes' ? notes.data : bookmarks.data) ?? []) (g[n.course_title] ??= []).push(n);
    return g;
  }, [tab, notes.data, bookmarks.data]);
  const loading = tab === 'notes' ? notes.isLoading : bookmarks.isLoading;

  return (
    <div>
      <PageHeader title="Notes & bookmarks" subtitle="Everything you've saved while watching, with links back to the exact moment." />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'notes', label: `Notes (${notes.data?.length ?? 0})` }, { value: 'bookmarks', label: `Bookmarks (${bookmarks.data?.length ?? 0})` }]} />
        {tab === 'notes' && <div className="relative sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" className="pl-9" /></div>}
      </div>
      {loading ? <Skeleton className="h-60" /> : !Object.keys(grouped).length ? (
        <EmptyState icon={tab === 'notes' ? <NotebookPen className="h-6 w-6" /> : <BookMarked className="h-6 w-6" />} title={tab === 'notes' ? 'No notes yet' : 'No bookmarks yet'} description="Add them from the course player while you watch." />
      ) : Object.entries(grouped).map(([course, items]) => (
        <Card key={course} className="mb-5">
          <CardHeader title={course} />
          <div className="divide-y divide-border p-2">
            {items.map((n) => (
              <div key={n.id} className="flex items-start gap-3 rounded-xl px-3 py-3 hover:bg-surface-2">
                <Link to={`/app/learn/${n.course_id}/${n.lecture_id}${n.timestamp_seconds != null ? `?t=${n.timestamp_seconds}` : ''}`} className="min-w-0 flex-1">
                  <p className="text-xs text-muted">{n.lecture_title}{n.timestamp_seconds != null && <span className="ml-1 font-mono font-semibold text-brand-600">@ {clock(n.timestamp_seconds)}</span>}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm">{tab === 'notes' ? n.content : n.label ?? 'Bookmark'}</p>
                  <p className="mt-1 text-[11px] text-muted">{timeAgo(n.created_at)}</p>
                </Link>
                <button onClick={() => (tab === 'notes' ? delNote : delBm).mutate(n.id)} className="rounded-lg p-1.5 text-muted hover:text-rose-600" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </Card>
      ))}
      {tab === 'notes' && notes.isFetching && !notes.isLoading && <p className="flex items-center justify-center gap-1 text-xs text-muted"><RefreshCw className="h-3 w-3 animate-spin" />Searching…</p>}
    </div>
  );
}
