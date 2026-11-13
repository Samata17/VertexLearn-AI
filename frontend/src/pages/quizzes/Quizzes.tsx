import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Clock, History, RotateCcw, Sparkles, Target, Timer, Trophy, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { LineTrend } from '@/components/common/charts';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Input, PageHeader, PageLoader, ProgressBar, ProgressRing, Skeleton } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import type { QuizQuestion } from '@/types';
import { date, dateTime } from '@/utils/format';

export function QuizList() {
  const quizzes = useQuery({ queryKey: ['my-quizzes'], queryFn: async () => (await api.get('/quizzes/me')).data.data as any[] });
  const history = useQuery({ queryKey: ['attempts'], queryFn: async () => (await api.get('/attempts/me')).data.data as any[] });
  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const q of quizzes.data ?? []) (g[q.course_title] ??= []).push(q);
    return g;
  }, [quizzes.data]);
  const trend = [...(history.data ?? [])].reverse().slice(-15).map((a, i) => ({ n: i + 1, score: Math.round(a.score), label: a.quiz_title }));

  return (
    <div>
      <PageHeader title="Quizzes" subtitle="Practice quizzes are auto-graded instantly. Your results update your topic mastery." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {quizzes.isLoading ? <Skeleton className="h-60" /> : quizzes.isError ? <ErrorState message={errMsg(quizzes.error)} /> : !quizzes.data?.length ? (
            <EmptyState icon={<BookOpen className="h-6 w-6" />} title="No quizzes yet" description="Quizzes from your enrolled courses will appear here." />
          ) : Object.entries(grouped).map(([course, list]) => (
            <Card key={course}>
              <CardHeader title={course} subtitle={`${list.length} quiz${list.length > 1 ? 'zes' : ''}`} />
              <div className="divide-y divide-border p-2">
                {list.map((q) => (
                  <Link key={q.id} to={`/app/quizzes/${q.id}`} className="flex items-center gap-4 rounded-xl px-3 py-3 hover:bg-surface-2">
                    <div className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', q.best_score >= 80 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15')}>{q.best_score >= 80 ? <CheckCircle2 className="h-5 w-5" /> : <Target className="h-5 w-5" />}</div>
                    <div className="min-w-0 flex-1"><p className="font-medium">{q.title}</p><p className="text-xs text-muted">{q.module_title} · {q.question_count} questions{q.time_limit_minutes ? ` · ${q.time_limit_minutes} min` : ''}</p></div>
                    <div className="text-right">{q.best_score != null ? <><p className="font-semibold">{Math.round(q.best_score)}%</p><p className="text-xs text-muted">best · {q.my_attempts} tries</p></> : <Badge tone="brand">Not attempted</Badge>}</div>
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Score history" icon={<History className="h-5 w-5" />} />
            <div className="p-5 pt-2">{trend.length ? <LineTrend data={trend} x="n" series={[{ key: 'score', name: 'Score %' }]} domain={[0, 100]} height={200} /> : <p className="py-10 text-center text-sm text-muted">No attempts yet.</p>}</div>
          </Card>
          <Card>
            <CardHeader title="Recent attempts" />
            <div className="divide-y divide-border p-2">
              {history.data?.slice(0, 8).map((a) => (
                <Link key={a.id} to={`/app/quizzes/results/${a.id}`} className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-surface-2">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{a.quiz_title}</p><p className="text-xs text-muted">{date(a.submitted_at)}</p></div>
                  <span className={clsx('text-sm font-bold', a.score >= 80 ? 'text-emerald-600' : a.score < 50 ? 'text-rose-600' : '')}>{Math.round(a.score)}%</span>
                </Link>
              ))}
              {!history.data?.length && <p className="py-6 text-center text-sm text-muted">Your attempts will show here.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

type Answers = Record<string, { selected?: string[]; text?: string }>;

export function QuizTake() {
  const { id } = useParams();
  const nav = useNavigate();
  const info = useQuery({ queryKey: ['quiz', id], queryFn: async () => (await api.get(`/quizzes/${id}`)).data as any });
  const [attempt, setAttempt] = useState<{ id: string; started_at: string } | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [confirm, setConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());

  const start = useMutation({
    mutationFn: async () => (await api.post(`/quizzes/${id}/attempt`)).data,
    onSuccess: (d) => { setAttempt(d.attempt); setQuestions(d.quiz.questions); setIdx(0); setAnswers({}); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const submit = useMutation({
    mutationFn: async () => (await api.post(`/attempts/${attempt!.id}/submit`, {
      answers: questions.map((q) => ({ question_id: q.id, selected_option_ids: answers[q.id]?.selected, text_answer: answers[q.id]?.text })),
    })).data,
    onSuccess: (d) => nav(`/app/quizzes/results/${d.attempt.id}`, { replace: true }),
    onError: (e) => toast.error(errMsg(e)),
  });

  const limit = info.data?.time_limit_minutes;
  const remaining = attempt && limit ? Math.max(0, new Date(attempt.started_at).getTime() + limit * 60000 - now) : null;
  useEffect(() => { if (!attempt || !limit) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [attempt, limit]);
  useEffect(() => { if (remaining === 0 && !submit.isPending && !submit.isSuccess) { toast.message('Time is up — submitting your answers.'); submit.mutate(); } }, [remaining]); // eslint-disable-line react-hooks/exhaustive-deps

  if (info.isLoading) return <PageLoader />;
  if (info.isError) return <ErrorState message={errMsg(info.error)} />;
  const quiz = info.data;
  if (quiz.is_manager) {
    return <EmptyState title="You manage this quiz" description="Instructors edit quizzes in the quiz editor; students take them here." action={<Link to={`/instructor/quizzes/${quiz.id}`}><Button>Open quiz editor</Button></Link>} />;
  }

  if (!attempt) {
    const best = quiz.attempts?.filter((a: any) => a.submitted_at).reduce((m: number | null, a: any) => (m == null || a.score > m ? a.score : m), null);
    return (
      <div className="mx-auto max-w-2xl">
        <Link to="/app/quizzes" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />All quizzes</Link>
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><Target className="h-7 w-7" /></div>
          <p className="text-sm text-muted">{quiz.module_title}</p>
          <h1 className="mt-1 text-2xl font-bold">{quiz.title}</h1>
          <div className="mt-5 flex justify-center gap-6 text-sm">
            <div><p className="text-xl font-bold">{quiz.question_count}</p><p className="text-muted">questions</p></div>
            <div><p className="text-xl font-bold">{limit ? `${limit} min` : 'None'}</p><p className="text-muted">time limit</p></div>
            <div><p className="text-xl font-bold">{best != null ? `${Math.round(best)}%` : '—'}</p><p className="text-muted">best score</p></div>
          </div>
          <p className="mx-auto mt-5 max-w-md text-sm text-muted">Multiple-choice, multi-select and short-answer questions are graded automatically. You can retake the quiz as many times as you like.</p>
          <Button size="lg" className="mt-6" onClick={() => start.mutate()} loading={start.isPending}>{quiz.attempts?.length ? 'Retake quiz' : 'Start quiz'}</Button>
          {quiz.attempts?.length > 0 && (
            <div className="mt-8 border-t border-border pt-5 text-left">
              <p className="mb-2 text-sm font-semibold">Previous attempts</p>
              {quiz.attempts.filter((a: any) => a.submitted_at).slice(0, 5).map((a: any) => (
                <Link key={a.id} to={`/app/quizzes/results/${a.id}`} className="flex justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2"><span className="text-muted">{dateTime(a.submitted_at)}</span><span className="font-semibold">{Math.round(a.score)}%</span></Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  }

  const q = questions[idx];
  const a = answers[q.id] ?? {};
  const answered = questions.filter((qq) => (answers[qq.id]?.selected?.length ?? 0) > 0 || (answers[qq.id]?.text ?? '').trim()).length;
  const toggle = (optId: string) => {
    if (q.question_type === 'mcq') setAnswers({ ...answers, [q.id]: { selected: [optId] } });
    else {
      const sel = new Set(a.selected ?? []);
      sel.has(optId) ? sel.delete(optId) : sel.add(optId);
      setAnswers({ ...answers, [q.id]: { selected: [...sel] } });
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="min-w-0"><p className="truncate text-sm text-muted">{quiz.title}</p><p className="font-semibold">Question {idx + 1} of {questions.length}</p></div>
        {remaining != null && <Badge tone={remaining < 60000 ? 'danger' : 'neutral'} className="px-3 py-1 text-sm"><Timer className="h-4 w-4" />{Math.floor(remaining / 60000)}:{String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}</Badge>}
      </div>
      <ProgressBar value={((idx + 1) / questions.length) * 100} className="mb-6" />
      <Card className="p-6 sm:p-8 animate-fade-in" key={q.id}>
        <Badge tone="brand" className="mb-3">{q.question_type === 'mcq' ? 'Single choice' : q.question_type === 'multi_select' ? 'Select all that apply' : 'Short answer'}</Badge>
        <h2 className="text-lg font-semibold leading-relaxed">{q.question_text}</h2>
        <div className="mt-6 space-y-3">
          {q.question_type === 'short_answer' ? (
            <Input autoFocus value={a.text ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: { text: e.target.value } })} placeholder="Type your answer" className="h-12 text-base" maxLength={300} />
          ) : q.options.map((o, i) => {
            const sel = a.selected?.includes(o.id);
            return (
              <button key={o.id} onClick={() => toggle(o.id)} role={q.question_type === 'mcq' ? 'radio' : 'checkbox'} aria-checked={!!sel}
                className={clsx('flex w-full items-center gap-4 rounded-xl border-2 px-4 py-3.5 text-left text-sm transition', sel ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-border hover:border-brand-200 hover:bg-surface-2')}>
                <span className={clsx('grid h-7 w-7 shrink-0 place-items-center text-xs font-bold', q.question_type === 'mcq' ? 'rounded-full' : 'rounded-lg', sel ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted')}>{String.fromCharCode(65 + i)}</span>
                <span className="font-medium">{o.option_text}</span>
              </button>
            );
          })}
        </div>
      </Card>
      <div className="mt-6 flex items-center justify-between">
        <Button variant="outline" disabled={idx === 0} onClick={() => setIdx(idx - 1)} icon={<ChevronLeft className="h-4 w-4" />}>Previous</Button>
        <div className="hidden gap-1.5 sm:flex">{questions.map((qq, i) => <button key={qq.id} onClick={() => setIdx(i)} aria-label={`Question ${i + 1}`} className={clsx('h-2.5 w-2.5 rounded-full transition', i === idx ? 'w-6 bg-brand-600' : (answers[qq.id]?.selected?.length || answers[qq.id]?.text?.trim()) ? 'bg-brand-300' : 'bg-border')} />)}</div>
        {idx < questions.length - 1
          ? <Button onClick={() => setIdx(idx + 1)} className="flex-row-reverse" icon={<ChevronRight className="h-4 w-4" />}>Next</Button>
          : <Button onClick={() => (answered < questions.length ? setConfirm(true) : submit.mutate())} loading={submit.isPending}>Submit quiz</Button>}
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); submit.mutate(); }} title="Submit with unanswered questions?"
        message={`You've answered ${answered} of ${questions.length} questions. Unanswered questions are marked incorrect.`} confirmLabel="Submit anyway" />
    </div>
  );
}

export function QuizResult() {
  const { attemptId } = useParams();
  const q = useQuery({ queryKey: ['attempt', attemptId], queryFn: async () => (await api.get(`/attempts/${attemptId}`)).data as any });
  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} />;
  const r = q.data;
  const score = Math.round(r.attempt.score);
  const msg = score === 100 ? 'Perfect score! 🎉' : score >= 80 ? 'Great job!' : score >= 50 ? 'Good effort — review the misses below.' : 'Keep going — review this module and try again.';
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/app/quizzes" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />All quizzes</Link>
      <Card className="flex flex-col items-center gap-6 p-8 sm:flex-row">
        <ProgressRing value={score} size={120} stroke={10}><div className="text-center"><p className="text-2xl font-bold">{score}%</p><p className="text-[11px] text-muted">score</p></div></ProgressRing>
        <div className="flex-1 text-center sm:text-left">
          <p className="text-sm text-muted">{r.quiz.course_title}</p>
          <h1 className="text-xl font-bold">{r.quiz.title}</h1>
          <p className="mt-1 font-medium">{msg}</p>
          <p className="mt-1 text-sm text-muted">{r.correct_count} of {r.total} correct · {dateTime(r.attempt.submitted_at)}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Link to={`/app/quizzes/${r.quiz.id}`}><Button icon={<RotateCcw className="h-4 w-4" />}>Retake</Button></Link>
            <Link to={`/app/tutor?course=${r.quiz.course_id}`}><Button variant="secondary" icon={<Sparkles className="h-4 w-4" />}>Ask the tutor</Button></Link>
            {score === 100 && <Badge tone="success" className="self-center"><Trophy className="h-3.5 w-3.5" />Perfectionist badge</Badge>}
          </div>
        </div>
      </Card>
      <div className="space-y-4">
        {r.questions.map((qq: any, i: number) => {
          const ans = qq.answer;
          const ok = ans?.is_correct;
          return (
            <Card key={qq.id} className={clsx('p-5', ok ? 'border-emerald-200 dark:border-emerald-500/30' : 'border-rose-200 dark:border-rose-500/30')}>
              <div className="flex gap-3">
                {ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium"><span className="text-muted">Q{i + 1}.</span> {qq.question_text}</p>
                  {qq.question_type === 'short_answer' ? (
                    <div className="mt-3 space-y-1 text-sm">
                      <p>Your answer: <b className={ok ? 'text-emerald-600' : 'text-rose-600'}>{ans?.text_answer || '(blank)'}</b></p>
                      {!ok && <p className="text-muted">Accepted: {qq.options.filter((o: any) => o.is_correct).map((o: any) => o.option_text).join(', ')}</p>}
                    </div>
                  ) : (
                    <ul className="mt-3 space-y-1.5">
                      {qq.options.map((o: any) => {
                        const picked = ans?.selected_option_ids?.includes(o.id);
                        return (
                          <li key={o.id} className={clsx('flex items-center gap-2 rounded-lg px-3 py-2 text-sm', o.is_correct ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200' : picked ? 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200' : 'text-muted')}>
                            {o.is_correct ? <CheckCircle2 className="h-4 w-4" /> : picked ? <XCircle className="h-4 w-4" /> : <span className="h-4 w-4" />}
                            {o.option_text}{picked && <span className="ml-auto text-xs font-medium">your answer</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {qq.explanation && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm"><b>Why:</b> {qq.explanation}</p>}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="flex items-center justify-center gap-1 text-xs text-muted"><Clock className="h-3 w-3" />Started {dateTime(r.attempt.started_at)}</p>
    </div>
  );
}
