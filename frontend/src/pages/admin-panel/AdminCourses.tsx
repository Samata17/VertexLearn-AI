import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, EyeOff, MessagesSquare, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CourseThumb } from '@/components/common/CourseVisuals';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Segmented, Skeleton, Textarea, statusTone } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import { date, money, timeAgo } from '@/utils/format';

export function AdminCourses() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'archived' | 'all'>('pending');
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['admin-courses', status, q], queryFn: async () => (await api.get('/admin/courses', { params: { status: status === 'all' ? undefined : status, q: q || undefined } })).data.data as any[] });
  const [review, setReview] = useState<{ course: any; decision: 'approved' | 'rejected'; comment: string } | null>(null);
  const decide = useMutation({
    mutationFn: () => api.post(`/courses/${review!.course.id}/approve`, { decision: review!.decision, comment: review!.comment || undefined }),
    onSuccess: () => { toast.success(review!.decision === 'approved' ? 'Course approved and published' : 'Course rejected — the instructor was notified'); setReview(null); qc.invalidateQueries({ queryKey: ['admin-courses'] }); qc.invalidateQueries({ queryKey: ['admin-overview'] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div>
      <PageHeader title="Course approvals" subtitle="New courses must be approved before they appear in the public catalog." />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented value={status} onChange={setStatus} options={[{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }]} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles" className="sm:w-64" />
      </div>
      {list.isLoading ? <Skeleton className="h-80" /> : list.isError ? <ErrorState message={errMsg(list.error)} /> : !list.data?.length ? (
        <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title={status === 'pending' ? 'The approval queue is empty' : 'No courses here'} description={status === 'pending' ? 'New course submissions will appear here.' : undefined} />
      ) : (
        <div className="space-y-4">
          {list.data.map((c) => (
            <Card key={c.id} className="flex flex-col gap-4 p-5 md:flex-row">
              <div className="w-full shrink-0 overflow-hidden rounded-xl md:w-52"><CourseThumb course={c} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(c.status)} className="capitalize">{c.status}</Badge><span className="text-xs text-muted">{c.category} · <span className="capitalize">{c.difficulty}</span> · {money(c.price)}</span></div>
                <h3 className="mt-1.5 text-lg font-semibold">{c.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{c.description}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span className="flex items-center gap-2"><Avatar name={c.instructor.full_name} size={22} />{c.instructor.full_name}</span>
                  <span>{c.module_count} modules · {c.lecture_count} lectures</span>
                  <span>Submitted {date(c.created_at)}</span>
                  {c.enrollment_count > 0 && <span>{c.enrollment_count} students</span>}
                </div>
                {c.last_review?.comment && <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">Last review ({c.last_review.decision}, {timeAgo(c.last_review.reviewed_at)}): “{c.last_review.comment}”</p>}
                {c.status === 'pending' && c.lecture_count === 0 && <p className="mt-2 text-xs font-medium text-amber-600">⚠ No lectures yet — consider requesting content before approving.</p>}
              </div>
              <div className="flex shrink-0 flex-row flex-wrap gap-2 md:flex-col">
                <Link to={`/courses/${c.id}`} target="_blank"><Button variant="outline" size="sm" className="w-full" icon={<ExternalLink className="h-4 w-4" />}>Preview</Button></Link>
                {c.status !== 'approved' && <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setReview({ course: c, decision: 'approved', comment: '' })}>Approve</Button>}
                {c.status !== 'rejected' && <Button variant="danger" size="sm" icon={<XCircle className="h-4 w-4" />} onClick={() => setReview({ course: c, decision: 'rejected', comment: '' })}>Reject</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {review && (
        <Modal open onClose={() => setReview(null)} title={review.decision === 'approved' ? 'Approve course' : 'Reject course'} size="sm"
          footer={<><Button variant="outline" onClick={() => setReview(null)}>Cancel</Button><Button variant={review.decision === 'approved' ? 'primary' : 'danger'} onClick={() => decide.mutate()} loading={decide.isPending} disabled={review.decision === 'rejected' && review.comment.trim().length < 5}>{review.decision === 'approved' ? 'Approve & publish' : 'Reject'}</Button></>}>
          <p className="mb-4 text-sm"><b>{review.course.title}</b> by {review.course.instructor.full_name}</p>
          <Field label={review.decision === 'approved' ? 'Comment (optional)' : 'What should the instructor change?'} hint={review.decision === 'rejected' ? 'Required — the instructor receives this by email.' : undefined}>
            <Textarea value={review.comment} onChange={(e) => setReview({ ...review, comment: e.target.value })} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

export function AdminModeration() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin-flagged'], queryFn: async () => (await api.get('/admin/moderation/flagged-posts')).data.data as any[] });
  const act = useMutation({ mutationFn: ({ id, action }: { id: string; action: string }) => api.put(`/admin/moderation/posts/${id}`, { action }), onSuccess: (_d, v) => { toast.success({ dismiss: 'Report dismissed', hide: 'Post hidden', delete: 'Post deleted' }[v.action] ?? 'Done'); qc.invalidateQueries({ queryKey: ['admin-flagged'] }); qc.invalidateQueries({ queryKey: ['admin-overview'] }); }, onError: (e) => toast.error(errMsg(e)) });
  return (
    <div>
      <PageHeader title="Discussion moderation" subtitle="Posts reported by learners across all course forums." />
      {list.isLoading ? <Skeleton className="h-60" /> : !list.data?.length ? <EmptyState icon={<MessagesSquare className="h-6 w-6" />} title="No reported posts" description="Reports from learners will appear here for review." /> : (
        <div className="space-y-4">
          {list.data.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="danger">Reported: {p.flag_reason}</Badge><span className="text-muted">by {p.reported_by ?? 'a learner'} · {timeAgo(p.created_at)}</span>{p.is_hidden && <Badge>Hidden</Badge>}</div>
              <blockquote className="mt-3 rounded-xl border-l-4 border-rose-300 bg-surface-2 px-4 py-3 text-sm">{p.content}</blockquote>
              <p className="mt-2 text-xs text-muted">Posted by <b>{p.author_name}</b> ({p.author_email}) in “{p.thread_title}” · {p.course_title}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to={`/app/discussions/${p.course_id}/${p.thread_id}`}><Button variant="outline" size="sm" icon={<ExternalLink className="h-4 w-4" />}>Open thread</Button></Link>
                <Button variant="outline" size="sm" onClick={() => act.mutate({ id: p.id, action: 'dismiss' })}>Dismiss report</Button>
                <Button variant="secondary" size="sm" icon={<EyeOff className="h-4 w-4" />} onClick={() => act.mutate({ id: p.id, action: 'hide' })}>Hide post</Button>
                <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => act.mutate({ id: p.id, action: 'delete' })}>Delete post</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
