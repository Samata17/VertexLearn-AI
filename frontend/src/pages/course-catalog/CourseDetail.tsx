import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, BookOpen, Check, ChevronDown, Clock, FileText, Layers, Lock, PlayCircle, Settings2, Sparkles, Star, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CourseThumb, difficultyTone, Stars } from '@/components/common/CourseVisuals';
import { Avatar, Badge, Button, Card, ErrorState, Modal, PageLoader, ProgressBar, Textarea } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import { useAuth } from '@/store/auth';
import type { CourseDetail as Detail } from '@/types';
import { compact, date, duration, money } from '@/utils/format';

export function CourseDetail() {
  const { id } = useParams();
  const user = useAuth((s) => s.user);
  const nav = useNavigate();
  const qc = useQueryClient();
  const [checkout, setCheckout] = useState(false);
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({});
  const [review, setReview] = useState({ rating: 5, comment: '' });

  const course = useQuery({ queryKey: ['course', id, !!user], queryFn: async () => (await api.get<Detail>(`/courses/${id}`)).data });
  const reviews = useQuery({ queryKey: ['reviews', id], queryFn: async () => (await api.get(`/courses/${id}/reviews`)).data.data as any[] });

  const enroll = useMutation({
    mutationFn: (confirm: boolean) => api.post(`/courses/${id}/enroll`, { confirm_demo_payment: confirm }),
    onSuccess: () => {
      toast.success("You're enrolled! Let's start learning.");
      setCheckout(false);
      qc.invalidateQueries();
      nav(`/app/learn/${id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const submitReview = useMutation({
    mutationFn: () => api.post(`/courses/${id}/reviews`, review),
    onSuccess: () => { toast.success('Thanks for your review!'); qc.invalidateQueries({ queryKey: ['reviews', id] }); qc.invalidateQueries({ queryKey: ['course', id] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (course.isLoading) return <PageLoader />;
  if (course.isError) return <div className="mx-auto max-w-3xl px-4 py-16"><ErrorState message={errMsg(course.error)} onRetry={() => course.refetch()} /></div>;
  const c = course.data!;
  const lectureCount = c.modules.reduce((s, m) => s + m.lectures.length, 0);
  const isStudent = user?.roles.includes('student');
  const firstLecture = c.modules[0]?.lectures[0]?.id;

  const onEnroll = () => {
    if (!user) return nav(`/login?next=/courses/${id}`);
    if (c.price > 0) setCheckout(true);
    else enroll.mutate(false);
  };

  const cta = c.enrollment ? (
    <Link to={`/app/learn/${c.id}/${c.enrollment.last_lecture_id ?? firstLecture ?? ''}`}><Button size="lg" className="w-full" icon={<PlayCircle className="h-5 w-5" />}>{Number(c.enrollment.progress_percent) > 0 ? 'Continue learning' : 'Start course'}</Button></Link>
  ) : c.is_manager ? (
    <Link to={`/instructor/courses/${c.id}`}><Button size="lg" className="w-full" icon={<Settings2 className="h-5 w-5" />}>Manage course</Button></Link>
  ) : user && !isStudent ? (
    <p className="rounded-xl bg-surface-2 p-3 text-center text-sm text-muted">Enrollment is available to student accounts.</p>
  ) : (
    <Button size="lg" className="w-full" onClick={onEnroll} loading={enroll.isPending}>{c.price > 0 ? `Enroll for ${money(c.price)}` : 'Enroll for free'}</Button>
  );

  return (
    <div>
      <section className="border-b border-border bg-gradient-to-br from-navy-900 via-navy-800 to-brand-900 text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_380px]">
          <div>
            {c.status !== 'approved' && <Badge tone="warning" className="mb-3 capitalize">Status: {c.status} — not visible in the catalog</Badge>}
            <div className="mb-3 flex flex-wrap gap-2"><span className="chip bg-white/10 text-white">{c.category}</span><span className="chip bg-white/10 capitalize text-white">{c.difficulty}</span></div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{c.title}</h1>
            <p className="mt-3 max-w-3xl text-white/75">{c.description}</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/80">
              <span className="flex items-center gap-1.5"><b className="text-amber-300">{c.rating ? c.rating.toFixed(1) : 'New'}</b><Stars value={c.rating} />({c.review_count} reviews)</span>
              <span className="flex items-center gap-1.5"><Users className="h-4 w-4" />{compact(c.enrollment_count)} learners</span>
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />{duration(c.total_seconds)}</span>
            </div>
            {c.instructor && <div className="mt-5 flex items-center gap-2.5 text-sm"><Avatar name={c.instructor.full_name} src={c.instructor.avatar_url} size={32} />Created by <b>{c.instructor.full_name}</b></div>}
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8 lg:order-1">
          {c.learning_outcomes.length > 0 && (
            <Card className="p-6">
              <h2 className="mb-4 text-lg font-semibold">What you'll learn</h2>
              <ul className="grid gap-3 sm:grid-cols-2">{c.learning_outcomes.map((o) => <li key={o} className="flex gap-2.5 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />{o}</li>)}</ul>
            </Card>
          )}

          <div>
            <div className="mb-3 flex items-end justify-between">
              <h2 className="text-lg font-semibold">Course content</h2>
              <p className="text-sm text-muted">{c.modules.length} modules · {lectureCount} lectures · {duration(c.total_seconds)}</p>
            </div>
            <div className="card divide-y divide-border overflow-hidden">
              {c.modules.map((m, i) => {
                const open = openModules[m.id] ?? i === 0;
                return (
                  <div key={m.id}>
                    <button onClick={() => setOpenModules({ ...openModules, [m.id]: !open })} className="flex w-full items-center justify-between gap-3 bg-surface-2/50 px-5 py-4 text-left hover:bg-surface-2" aria-expanded={open}>
                      <span className="font-medium">Module {i + 1}: {m.title}</span>
                      <span className="flex items-center gap-3 text-sm text-muted">{m.lectures.length} lectures<ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} /></span>
                    </button>
                    {open && (
                      <ul className="divide-y divide-border/60">
                        {m.lectures.map((l) => {
                          const canOpen = !!c.enrollment || c.is_manager;
                          const inner = (
                            <>
                              {l.completed ? <Check className="h-4 w-4 text-emerald-500" /> : canOpen ? <PlayCircle className="h-4 w-4 text-brand-600" /> : <Lock className="h-4 w-4 text-muted" />}
                              <span className="flex-1 text-sm">{l.title}</span>
                              {l.resource_count > 0 && <FileText className="h-3.5 w-3.5 text-muted" aria-label="Has resources" />}
                              <span className="text-xs text-muted">{duration(l.duration_seconds)}</span>
                            </>
                          );
                          return <li key={l.id}>{canOpen ? <Link to={`/app/learn/${c.id}/${l.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">{inner}</Link> : <div className="flex items-center gap-3 px-5 py-3">{inner}</div>}</li>;
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {c.instructor && (
            <Card className="p-6">
              <h2 className="mb-4 text-lg font-semibold">Your instructor</h2>
              <div className="flex gap-4">
                <Avatar name={c.instructor.full_name} src={c.instructor.avatar_url} size={56} />
                <div>
                  <p className="font-semibold">{c.instructor.full_name}</p>
                  <p className="text-sm text-muted">{c.instructor.course_count} course{c.instructor.course_count === 1 ? '' : 's'} on VertexLearn</p>
                  {c.instructor.bio && <p className="mt-2 text-sm">{c.instructor.bio}</p>}
                </div>
              </div>
            </Card>
          )}

          <div>
            <h2 className="mb-4 text-lg font-semibold">Student reviews</h2>
            {c.enrollment && isStudent && (
              <Card className="mb-4 p-5">
                <p className="mb-2 text-sm font-medium">Rate this course</p>
                <div className="mb-3 flex gap-1">{[1, 2, 3, 4, 5].map((r) => <button key={r} onClick={() => setReview({ ...review, rating: r })} aria-label={`${r} stars`}><Star className={`h-6 w-6 ${r <= review.rating ? 'fill-amber-400 text-amber-400' : 'text-border'}`} /></button>)}</div>
                <Textarea value={review.comment} onChange={(e) => setReview({ ...review, comment: e.target.value })} placeholder="What did you think? (optional)" className="min-h-[72px]" />
                <Button className="mt-3" size="sm" onClick={() => submitReview.mutate()} loading={submitReview.isPending}>Submit review</Button>
              </Card>
            )}
            {!reviews.data?.length ? <p className="text-sm text-muted">No reviews yet.</p> : (
              <div className="grid gap-4 sm:grid-cols-2">
                {reviews.data.slice(0, 6).map((r) => (
                  <Card key={r.id} className="p-5">
                    <div className="flex items-center gap-3"><Avatar name={r.full_name} src={r.avatar_url} size={36} /><div><p className="text-sm font-semibold">{r.full_name}</p><div className="flex items-center gap-2"><Stars value={r.rating} size={12} /><span className="text-xs text-muted">{date(r.created_at)}</span></div></div></div>
                    {r.comment && <p className="mt-3 text-sm text-muted">{r.comment}</p>}
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="lg:order-2 lg:-mt-64">
          <Card className="overflow-hidden lg:sticky lg:top-24">
            <CourseThumb course={c} showPlay />
            <div className="space-y-4 p-6">
              {!c.enrollment && <p className="text-3xl font-bold">{money(c.price)}</p>}
              {c.enrollment && (
                <div>
                  <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium">Your progress</span><span>{Math.round(c.enrollment.progress_percent)}%</span></div>
                  <ProgressBar value={c.enrollment.progress_percent} />
                </div>
              )}
              {cta}
              <ul className="space-y-2.5 border-t border-border pt-4 text-sm">
                <li className="flex items-center gap-2.5"><Layers className="h-4 w-4 text-muted" />{c.modules.length} modules, {lectureCount} lectures</li>
                <li className="flex items-center gap-2.5"><Sparkles className="h-4 w-4 text-brand-600" />AI tutor trained on this course</li>
                <li className="flex items-center gap-2.5"><BookOpen className="h-4 w-4 text-muted" />Quizzes, assignments & flashcards</li>
                <li className="flex items-center gap-2.5"><Award className="h-4 w-4 text-muted" />Certificate of completion</li>
              </ul>
              <Badge tone={difficultyTone(c.difficulty)} className="capitalize">{c.difficulty} level</Badge>
            </div>
          </Card>
        </aside>
      </div>

      <Modal open={checkout} onClose={() => setCheckout(false)} title="Checkout" size="sm"
        footer={<><Button variant="outline" onClick={() => setCheckout(false)}>Cancel</Button><Button onClick={() => enroll.mutate(true)} loading={enroll.isPending}>Confirm demo purchase</Button></>}>
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <b>Demo checkout.</b> Payment processing is not part of this build, so no card is charged. Confirming records a demo payment and enrolls you.
          </div>
          <div className="flex items-center gap-3"><div className="w-24 overflow-hidden rounded-lg"><CourseThumb minimal course={c} /></div><div><p className="text-sm font-semibold">{c.title}</p><p className="text-sm text-muted">{c.instructor?.full_name}</p></div></div>
          <div className="flex justify-between border-t border-border pt-3 font-semibold"><span>Total</span><span>{money(c.price)}</span></div>
        </div>
      </Modal>
    </div>
  );
}
