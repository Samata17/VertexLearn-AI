/**
 * Quiz builder (FR-I4). Used for new quizzes and for reviewing AI-generated drafts before publishing.
 * For short-answer questions, each "option" is an accepted answer.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Circle, Plus, Save, Send, Sparkles, Square, SquareCheck, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, Input, PageHeader, PageLoader, Select, Textarea, statusTone } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import type { CourseDetail } from '@/types';

type QType = 'mcq' | 'multi_select' | 'short_answer';
interface Q { question_text: string; question_type: QType; explanation: string; options: { option_text: string; is_correct: boolean }[] }
const blank = (type: QType = 'mcq'): Q => ({
  question_text: '', question_type: type, explanation: '',
  options: type === 'short_answer' ? [{ option_text: '', is_correct: true }] : [0, 1, 2, 3].map((i) => ({ option_text: '', is_correct: i === 0 })),
});

function problems(qs: Q[]) {
  const out: string[] = [];
  qs.forEach((q, i) => {
    const n = i + 1;
    if (q.question_text.trim().length < 3) out.push(`Question ${n} needs text`);
    const filled = q.options.filter((o) => o.option_text.trim());
    const correct = filled.filter((o) => o.is_correct).length;
    if (q.question_type === 'short_answer') { if (!correct) out.push(`Question ${n} needs an accepted answer`); }
    else {
      if (filled.length < 2) out.push(`Question ${n} needs at least 2 options`);
      if (q.question_type === 'mcq' && correct !== 1) out.push(`Question ${n} needs exactly 1 correct option`);
      if (q.question_type === 'multi_select' && correct < 1) out.push(`Question ${n} needs a correct option`);
    }
  });
  return out;
}

export function QuizEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['quiz-edit', id], enabled: !isNew, queryFn: async () => (await api.get(`/quizzes/${id}`)).data as any });
  const courseId = isNew ? params.get('course') : existing.data?.course_id;
  const course = useQuery({ queryKey: ['course', courseId, true], enabled: !!courseId, queryFn: async () => (await api.get<CourseDetail>(`/courses/${courseId}`)).data });

  const [title, setTitle] = useState('');
  const [moduleId, setModuleId] = useState(params.get('module') ?? '');
  const [limit, setLimit] = useState('');
  const [questions, setQuestions] = useState<Q[]>([blank()]);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (existing.data) {
      setTitle(existing.data.title);
      setModuleId(existing.data.module_id);
      setLimit(existing.data.time_limit_minutes ? String(existing.data.time_limit_minutes) : '');
      setQuestions(existing.data.questions.map((q: any) => ({ question_text: q.question_text, question_type: q.question_type, explanation: q.explanation ?? '', options: q.options.map((o: any) => ({ option_text: o.option_text, is_correct: o.is_correct })) })));
    }
  }, [existing.data]);
  useEffect(() => { if (!moduleId && course.data?.modules[0]) setModuleId(course.data.modules[0].id); }, [course.data, moduleId]);

  const errs = problems(questions);
  const save = useMutation({
    mutationFn: async (status?: 'draft' | 'published') => {
      const body = {
        title, time_limit_minutes: limit ? Number(limit) : null,
        questions: questions.map((q) => ({ ...q, explanation: q.explanation || undefined, options: q.options.filter((o) => o.option_text.trim()) })),
        ...(status ? { status } : {}),
      };
      return isNew ? (await api.post('/quizzes', { ...body, module_id: moduleId, status: status ?? 'published' })).data : (await api.put(`/quizzes/${id}`, body)).data;
    },
    onSuccess: (q, status) => {
      toast.success(status === 'published' ? 'Quiz published — students have been notified' : 'Quiz saved');
      qc.invalidateQueries({ queryKey: ['course-quizzes'] });
      qc.invalidateQueries({ queryKey: ['instructor-overview'] });
      if (isNew) nav(`/instructor/quizzes/${q.id}`, { replace: true }); else qc.invalidateQueries({ queryKey: ['quiz-edit', id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({ mutationFn: () => api.delete(`/quizzes/${id}`), onSuccess: () => { toast.success('Quiz deleted'); nav(`/instructor/courses/${courseId}?tab=quizzes`); } });
  const attempt = (status?: 'draft' | 'published') => { setShowErrors(true); if (errs.length || title.trim().length < 3) return toast.error(errs[0] ?? 'Add a quiz title'); save.mutate(status); };

  const updateQ = (i: number, patch: Partial<Q>) => setQuestions(questions.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  const setType = (i: number, t: QType) => {
    const q = questions[i];
    let options = q.options;
    if (t === 'short_answer') options = q.options.filter((o) => o.is_correct).slice(0, 3).map((o) => ({ ...o, is_correct: true }));
    else if (q.question_type === 'short_answer') options = [...q.options.map((o) => ({ ...o, is_correct: false })), ...[0, 1, 2].map(() => ({ option_text: '', is_correct: false }))].slice(0, 4);
    if (t === 'mcq') { const first = options.findIndex((o) => o.is_correct); options = options.map((o, k) => ({ ...o, is_correct: k === (first >= 0 ? first : 0) })); }
    if (!options.length) options = [{ option_text: '', is_correct: t === 'short_answer' }];
    updateQ(i, { question_type: t, options });
  };
  const toggleCorrect = (qi: number, oi: number) => {
    const q = questions[qi];
    updateQ(qi, { options: q.options.map((o, k) => (q.question_type === 'mcq' ? { ...o, is_correct: k === oi } : k === oi ? { ...o, is_correct: !o.is_correct } : o)) });
  };
  const moveQ = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= questions.length) return; const n = [...questions]; [n[i], n[j]] = [n[j], n[i]]; setQuestions(n); };

  if (!isNew && existing.isLoading) return <PageLoader />;
  if (existing.isError) return <ErrorState message={errMsg(existing.error)} />;
  const status = existing.data?.status ?? 'new';

  return (
    <div className="mx-auto max-w-4xl pb-24">
      {courseId && <Link to={`/instructor/courses/${courseId}?tab=quizzes`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Back to course</Link>}
      <PageHeader eyebrow={course.data?.title} title={isNew ? 'New quiz' : 'Edit quiz'}
        actions={!isNew && <><Badge tone={statusTone(status)} className="capitalize">{status}</Badge>{existing.data?.is_ai_generated && <Badge tone="brand"><Sparkles className="h-3 w-3" />AI-generated</Badge>}</>} />
      {existing.data?.is_ai_generated && status === 'draft' && (
        <div className="mb-5 rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm dark:border-brand-500/30 dark:bg-brand-500/10">
          <p className="font-semibold">Review this AI draft before publishing</p>
          <p className="mt-0.5 text-muted">Check every question and answer against your lecture. Edit anything that's unclear, then click <b>Publish</b> — students only see published quizzes.</p>
        </div>
      )}
      <Card className="mb-5 grid gap-4 p-5 sm:grid-cols-3">
        <div className="sm:col-span-3"><Field label="Quiz title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sorting Algorithms Quiz" maxLength={200} /></Field></div>
        <div className="sm:col-span-2"><Field label="Module"><Select value={moduleId} onChange={(e) => setModuleId(e.target.value)} disabled={!isNew}>{course.data?.modules.map((m, i) => <option key={m.id} value={m.id}>Module {i + 1}: {m.title}</option>)}</Select></Field></div>
        <Field label="Time limit (minutes)" hint="Leave empty for none"><Input type="number" min={1} max={300} value={limit} onChange={(e) => setLimit(e.target.value)} /></Field>
      </Card>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <Card key={i} className={clsx('p-5', showErrors && problems([q]).length && 'border-rose-300 dark:border-rose-500/40')}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{i + 1}</span>
              <Select value={q.question_type} onChange={(e) => setType(i, e.target.value as QType)} className="h-9 w-48" aria-label="Question type">
                <option value="mcq">Multiple choice</option><option value="multi_select">Multiple select</option><option value="short_answer">Short answer</option>
              </Select>
              <div className="ml-auto flex gap-1">
                <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2" onClick={() => moveQ(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2" onClick={() => moveQ(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
                <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-rose-600 disabled:opacity-30" disabled={questions.length === 1} onClick={() => setQuestions(questions.filter((_, k) => k !== i))} aria-label="Delete question"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            <Textarea value={q.question_text} onChange={(e) => updateQ(i, { question_text: e.target.value })} placeholder="Question text" className="min-h-[64px]" />
            <p className="mb-2 mt-4 text-xs font-medium text-muted">{q.question_type === 'short_answer' ? 'Accepted answers (case and punctuation are ignored)' : q.question_type === 'mcq' ? 'Options — click the circle to mark the correct one' : 'Options — mark every correct one'}</p>
            <div className="space-y-2">
              {q.options.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  {q.question_type !== 'short_answer' && (
                    <button onClick={() => toggleCorrect(i, oi)} aria-label={o.is_correct ? 'Correct' : 'Mark correct'} className={o.is_correct ? 'text-emerald-600' : 'text-muted hover:text-ink'}>
                      {q.question_type === 'mcq' ? (o.is_correct ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />) : o.is_correct ? <SquareCheck className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                    </button>
                  )}
                  <Input value={o.option_text} onChange={(e) => updateQ(i, { options: q.options.map((x, k) => (k === oi ? { ...x, option_text: e.target.value } : x)) })} placeholder={q.question_type === 'short_answer' ? 'Accepted answer' : `Option ${String.fromCharCode(65 + oi)}`} className={clsx('h-9', o.is_correct && q.question_type !== 'short_answer' && 'border-emerald-300 dark:border-emerald-500/40')} />
                  <button disabled={q.options.length <= 1} onClick={() => updateQ(i, { options: q.options.filter((_, k) => k !== oi) })} className="rounded-lg p-1.5 text-muted hover:text-rose-600 disabled:opacity-30" aria-label="Remove option"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            {q.options.length < 8 && <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => updateQ(i, { options: [...q.options, { option_text: '', is_correct: q.question_type === 'short_answer' }] })}>{q.question_type === 'short_answer' ? 'Add accepted answer' : 'Add option'}</Button>}
            <Input className="mt-3 h-9" value={q.explanation} onChange={(e) => updateQ(i, { explanation: e.target.value })} placeholder="Explanation shown after submission (optional)" />
            {showErrors && problems([q]).map((p) => <p key={p} className="mt-2 text-xs text-rose-600">{p.replace('Question 1', 'This question')}</p>)}
          </Card>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        {(['mcq', 'multi_select', 'short_answer'] as QType[]).map((t) => <Button key={t} variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setQuestions([...questions, blank(t)])}>{t === 'mcq' ? 'Multiple choice' : t === 'multi_select' ? 'Multiple select' : 'Short answer'}</Button>)}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/90 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="text-sm text-muted">{questions.length} question{questions.length > 1 ? 's' : ''}{showErrors && errs.length > 0 && <span className="ml-2 text-rose-600">· {errs.length} issue(s)</span>}</span>
          <div className="flex gap-2">
            {!isNew && <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDel(true)}>Delete</Button>}
            {(isNew || status === 'draft') && <Button variant="outline" icon={<Save className="h-4 w-4" />} onClick={() => attempt('draft')} loading={save.isPending && save.variables === 'draft'}>Save draft</Button>}
            {status === 'published' ? <Button icon={<Save className="h-4 w-4" />} onClick={() => attempt()} loading={save.isPending}>Save changes</Button>
              : <Button icon={<Send className="h-4 w-4" />} onClick={() => attempt('published')} loading={save.isPending && save.variables === 'published'}>Publish</Button>}
          </div>
        </div>
      </div>
      <ConfirmDialog open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={() => del.mutate()} danger title="Delete quiz?" message="Students' attempts and scores for this quiz will be deleted too." confirmLabel="Delete" loading={del.isPending} />
    </div>
  );
}
