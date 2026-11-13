import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckCircle2, ClipboardCheck, Download, FileText, MessageSquareText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Segmented, Skeleton, Textarea } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import { dateTime, timeAgo } from '@/utils/format';

interface Sub { id: string; full_name: string; email: string; assignment_id: string; assignment_title: string; course_title: string; max_score: number; rubric: { criterion: string; points: number }[]; due_date: string | null; file_url: string | null; file_name: string | null; comment: string | null; submitted_at: string; grade: number | null; feedback: string | null }

export function Grading() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as 'pending' | 'graded' | 'all') || 'pending';
  const assignment = params.get('assignment') ?? undefined;
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['grading', status, assignment], queryFn: async () => (await api.get<{ data: Sub[] }>('/instructor/submissions', { params: { status, assignment } })).data.data });
  const [selected, setSelected] = useState<string | null>(null);
  const sub = list.data?.find((s) => s.id === selected) ?? list.data?.[0];
  const [scores, setScores] = useState<Record<number, string>>({});
  const [grade, setGrade] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (sub) { setGrade(sub.grade != null ? String(sub.grade) : ''); setFeedback(sub.feedback ?? ''); setScores({}); }
  }, [sub?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rubricTotal = sub?.rubric?.length ? Object.values(scores).reduce((s, v) => s + (Number(v) || 0), 0) : null;
  const save = useMutation({
    mutationFn: () => api.put(`/submissions/${sub!.id}/grade`, { grade: Number(grade), feedback: feedback || undefined }),
    onSuccess: () => { toast.success('Grade saved — the student was notified'); qc.invalidateQueries({ queryKey: ['grading'] }); qc.invalidateQueries({ queryKey: ['instructor-overview'] }); setSelected(null); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const setP = (k: string, v?: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); setSelected(null); };

  return (
    <div>
      <PageHeader title="Grading" subtitle="Review submissions, score them with the rubric and leave feedback."
        actions={<Segmented value={status} onChange={(v) => setP('status', v)} options={[{ value: 'pending', label: 'To grade' }, { value: 'graded', label: 'Graded' }, { value: 'all', label: 'All' }]} />} />
      {assignment && <div className="mb-4 flex items-center gap-2 text-sm"><Badge tone="brand">Filtered to one assignment</Badge><button onClick={() => setP('assignment')} className="text-brand-600 hover:underline">Show all assignments</button></div>}
      {list.isLoading ? <Skeleton className="h-96" /> : !list.data?.length ? (
        <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title={status === 'pending' ? 'Nothing to grade' : 'No submissions here'} description="New submissions appear here as students turn in work." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <Card className="max-h-[70vh] overflow-y-auto p-2 scrollbar-thin">
            {list.data.map((s) => (
              <button key={s.id} onClick={() => setSelected(s.id)} className={clsx('flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition', sub?.id === s.id ? 'bg-brand-50 dark:bg-brand-500/15' : 'hover:bg-surface-2')}>
                <Avatar name={s.full_name} size={34} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{s.full_name}</p><p className="truncate text-xs text-muted">{s.assignment_title}</p><p className="text-[11px] text-muted">{timeAgo(s.submitted_at)}</p></div>
                {s.grade != null ? <Badge tone="success">{s.grade}/{s.max_score}</Badge> : <Badge tone="warning">New</Badge>}
              </button>
            ))}
          </Card>
          {sub && (
            <Card className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3"><Avatar name={sub.full_name} size={44} /><div><p className="font-semibold">{sub.full_name}</p><p className="text-sm text-muted">{sub.email}</p></div></div>
                <div className="text-right text-sm"><p className="font-medium">{sub.assignment_title}</p><p className="text-muted">{sub.course_title}</p></div>
              </div>
              <div className="mt-5 flex items-center gap-3 rounded-xl border border-border p-3">
                <FileText className="h-5 w-5 text-brand-600" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{sub.file_name ?? 'Submission file'}</p><p className="text-xs text-muted">Submitted {dateTime(sub.submitted_at)}{sub.due_date && new Date(sub.submitted_at) > new Date(sub.due_date) && ' · late'}</p></div>
                {sub.file_url ? <a href={`${sub.file_url}&download=1`}><Button variant="outline" size="sm" icon={<Download className="h-4 w-4" />}>Download</Button></a> : <span className="text-xs text-muted">Seeded demo — no file</span>}
              </div>
              {sub.comment && <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm"><p className="mb-1 flex items-center gap-1.5 font-medium"><MessageSquareText className="h-4 w-4" />Student's note</p><p className="text-muted">{sub.comment}</p></div>}

              {sub.rubric?.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 font-semibold">Rubric</p>
                  <div className="space-y-2">{sub.rubric.map((r, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="flex-1 text-sm">{r.criterion}</span>
                      <Input type="number" min={0} max={r.points} value={scores[i] ?? ''} onChange={(e) => { const n = { ...scores, [i]: e.target.value }; setScores(n); setGrade(String(Object.values(n).reduce((s, v) => s + (Number(v) || 0), 0))); }} className="h-9 w-20" aria-label={`${r.criterion} score`} />
                      <span className="w-12 text-sm text-muted">/ {r.points}</span>
                    </div>
                  ))}</div>
                  {rubricTotal != null && Object.keys(scores).length > 0 && <p className="mt-2 text-xs text-muted">Rubric total fills in the grade below — you can still adjust it.</p>}
                </div>
              )}
              <div className="mt-6 grid gap-4 sm:grid-cols-[160px_1fr]">
                <Field label={`Grade (out of ${sub.max_score})`}><Input type="number" min={0} max={sub.max_score} value={grade} onChange={(e) => setGrade(e.target.value)} /></Field>
                <Field label="Feedback"><Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What went well, and what to improve" className="min-h-[100px]" /></Field>
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                {sub.grade != null && <span className="mr-auto flex items-center gap-1 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" />Graded {sub.grade}/{sub.max_score}</span>}
                <Button onClick={() => save.mutate()} loading={save.isPending} disabled={grade === '' || Number(grade) < 0 || Number(grade) > sub.max_score}>{sub.grade != null ? 'Update grade' : 'Save grade'}</Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
