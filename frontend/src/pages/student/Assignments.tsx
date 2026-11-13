import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, CheckCircle2, ClipboardList, Clock, Download, FileUp, MessageSquareText, UploadCloud, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, Segmented, Skeleton, Textarea } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import { dateTime, dueLabel } from '@/utils/format';

interface Submission { id: string; file_url: string | null; file_name: string | null; comment: string | null; submitted_at: string; grade: number | null; feedback: string | null; graded_at: string | null }
interface Assignment { id: string; course_id: string; course_title: string; title: string; instructions: string | null; rubric: { criterion: string; points: number }[]; due_date: string | null; max_score: number; my_submission: Submission | null; is_manager?: boolean }

function statusOf(a: Assignment) {
  if (a.my_submission?.grade != null) return { label: `Graded ${a.my_submission.grade}/${a.max_score}`, tone: 'success' as const };
  if (a.my_submission) return { label: 'Submitted', tone: 'info' as const };
  if (a.due_date && new Date(a.due_date) < new Date()) return { label: 'Missed', tone: 'danger' as const };
  return { label: 'To do', tone: 'warning' as const };
}

export function AssignmentList() {
  const [filter, setFilter] = useState<'upcoming' | 'submitted' | 'all'>('upcoming');
  const q = useQuery({ queryKey: ['my-assignments'], queryFn: async () => (await api.get<{ data: Assignment[] }>('/assignments/me')).data.data });
  const list = (q.data ?? []).filter((a) => filter === 'all' || (filter === 'submitted' ? !!a.my_submission : !a.my_submission && (!a.due_date || new Date(a.due_date) > new Date())));
  return (
    <div>
      <PageHeader title="Assignments" subtitle="Submit before the deadline — your instructor grades with the rubric shown." />
      <div className="mb-5"><Segmented value={filter} onChange={setFilter} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'submitted', label: 'Submitted' }, { value: 'all', label: 'All' }]} /></div>
      {q.isLoading ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div> : q.isError ? <ErrorState message={errMsg(q.error)} /> : !list.length ? (
        <EmptyState icon={<ClipboardList className="h-6 w-6" />} title={filter === 'upcoming' ? 'Nothing due' : 'No assignments here'} description="Assignments from your enrolled courses show up here." />
      ) : (
        <div className="space-y-3">
          {list.map((a) => {
            const due = dueLabel(a.due_date);
            const st = statusOf(a);
            return (
              <Link key={a.id} to={`/app/assignments/${a.id}`} className="card flex flex-col gap-3 p-5 transition hover:shadow-lift sm:flex-row sm:items-center">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><ClipboardList className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><p className="font-semibold">{a.title}</p><p className="text-sm text-muted">{a.course_title} · {a.max_score} points</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx('flex items-center gap-1 text-sm', due.tone === 'danger' ? 'text-rose-600' : due.tone === 'warning' ? 'text-amber-600' : 'text-muted')}><Clock className="h-4 w-4" />{due.text}</span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AssignmentDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [comment, setComment] = useState('');
  const [drag, setDrag] = useState(false);
  const q = useQuery({ queryKey: ['assignment', id], queryFn: async () => (await api.get<Assignment>(`/assignments/${id}`)).data });

  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      if (comment) form.append('comment', comment);
      return api.post(`/assignments/${id}/submit`, form);
    },
    onSuccess: () => { toast.success('Submitted! Your instructor has been notified.'); setFile(null); setComment(''); qc.invalidateQueries({ queryKey: ['assignment', id] }); qc.invalidateQueries({ queryKey: ['my-assignments'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} />;
  const a = q.data!;
  const due = dueLabel(a.due_date);
  const closed = !!a.due_date && new Date(a.due_date) < new Date();
  const s = a.my_submission;
  const pick = (f?: File | null) => { if (f) { if (f.size > 50 * 1024 * 1024) return toast.error('Files must be under 50 MB'); setFile(f); } };

  return (
    <div className="mx-auto max-w-4xl">
      <Link to={a.is_manager ? `/instructor/courses/${a.course_id}?tab=assignments` : '/app/assignments'} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Back</Link>
      <PageHeader eyebrow={a.course_title} title={a.title} actions={a.is_manager && <Link to={`/instructor/grading?assignment=${a.id}`}><Button icon={<Users className="h-4 w-4" />}>View submissions</Button></Link>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <Card className="p-6"><h2 className="mb-3 font-semibold">Instructions</h2><p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{a.instructions || 'No instructions provided.'}</p></Card>

          {!a.is_manager && (
            s?.grade != null ? (
              <Card className="border-emerald-200 p-6 dark:border-emerald-500/30">
                <div className="flex items-center justify-between"><h2 className="font-semibold">Your grade</h2><span className="text-3xl font-bold text-emerald-600">{s.grade}<span className="text-base text-muted">/{a.max_score}</span></span></div>
                {s.feedback && <div className="mt-4 rounded-xl bg-surface-2 p-4"><p className="mb-1 flex items-center gap-1.5 text-sm font-medium"><MessageSquareText className="h-4 w-4" />Instructor feedback</p><p className="whitespace-pre-wrap text-sm text-muted">{s.feedback}</p></div>}
                <p className="mt-3 text-xs text-muted">Graded {dateTime(s.graded_at)}</p>
              </Card>
            ) : null
          )}

          {!a.is_manager && (
            <Card className="p-6">
              <h2 className="mb-1 font-semibold">{s ? 'Your submission' : 'Submit your work'}</h2>
              {s && (
                <div className="mb-4 mt-3 flex items-center gap-3 rounded-xl border border-border p-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{s.file_name}</p><p className="text-xs text-muted">Submitted {dateTime(s.submitted_at)}</p></div>
                  {s.file_url && <a href={`${s.file_url}&download=1`}><Button variant="ghost" size="sm" icon={<Download className="h-4 w-4" />}>Download</Button></a>}
                </div>
              )}
              {closed ? (
                <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">The deadline has passed — submissions are closed.</p>
              ) : (
                <>
                  <p className="mb-4 text-sm text-muted">{s ? 'You can resubmit until the deadline. A new submission replaces the old one and clears any grade.' : 'Accepted: PDF, ZIP, code files, notebooks, DOCX — up to 50 MB.'}</p>
                  <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
                    onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
                    className={clsx('flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition', drag ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-border hover:border-brand-300 hover:bg-surface-2')}>
                    {file ? <><FileUp className="mb-2 h-8 w-8 text-brand-600" /><p className="text-sm font-medium">{file.name}</p><p className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB · click to change</p></> : <><UploadCloud className="mb-2 h-8 w-8 text-muted" /><p className="text-sm font-medium">Drag a file here or click to browse</p></>}
                    <input ref={fileRef} type="file" className="hidden" accept=".pdf,.zip,.txt,.md,.py,.js,.ts,.java,.c,.cpp,.ipynb,.docx" onChange={(e) => pick(e.target.files?.[0])} />
                  </div>
                  <Textarea className="mt-4 min-h-[72px]" placeholder="Add a note for your instructor (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
                  <Button className="mt-4" disabled={!file} loading={submit.isPending} onClick={() => submit.mutate()} icon={<UploadCloud className="h-4 w-4" />}>{s ? 'Resubmit' : 'Submit assignment'}</Button>
                </>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card className="p-5">
            <p className="text-sm text-muted">Deadline</p>
            <p className="mt-1 font-semibold">{a.due_date ? dateTime(a.due_date) : 'No deadline'}</p>
            <Badge tone={due.tone === 'neutral' ? 'neutral' : due.tone} className="mt-2">{due.text}</Badge>
            <p className="mt-4 text-sm text-muted">Points</p><p className="mt-1 font-semibold">{a.max_score}</p>
          </Card>
          {a.rubric?.length > 0 && (
            <Card className="p-5">
              <p className="mb-3 font-semibold">Rubric</p>
              <ul className="space-y-2">{a.rubric.map((r) => <li key={r.criterion} className="flex justify-between gap-3 text-sm"><span className="text-muted">{r.criterion}</span><span className="font-semibold">{r.points}</span></li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
