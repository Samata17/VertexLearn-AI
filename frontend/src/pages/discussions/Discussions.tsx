import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, EyeOff, Flag, MessageSquare, MessagesSquare, Plus, Reply, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Avatar, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Skeleton, Textarea } from '@/components/common/ui';
import { useDebounce } from '@/hooks/useDebounce';
import { api, errMsg } from '@/services/api';
import { useAuth } from '@/store/auth';
import { timeAgo } from '@/utils/format';

/** Students: pick one of your courses. Instructors land in their course editor's discussion tab instead. */
export function DiscussionHome() {
  const user = useAuth((s) => s.user)!;
  const isStudent = user.roles.includes('student');
  const courses = useQuery({
    queryKey: ['discussion-courses', isStudent],
    queryFn: async () => isStudent
      ? (await api.get('/enrollments/me')).data.data.map((e: any) => ({ id: e.course_id, title: e.title, sub: e.instructor_name }))
      : (await api.get('/instructor/courses')).data.data.map((c: any) => ({ id: c.id, title: c.title, sub: `${c.enrollment_count} students` })),
  });
  return (
    <div>
      <PageHeader title="Discussions" subtitle="Ask questions, help classmates and learn together — one forum per course." />
      {courses.isLoading ? <Skeleton className="h-40" /> : !courses.data?.length ? <EmptyState icon={<MessagesSquare className="h-6 w-6" />} title="No course forums yet" description="Enroll in a course to join its discussion." /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {courses.data.map((c: any) => (
            <Link key={c.id} to={`/app/discussions/${c.id}`} className="card flex items-center gap-4 p-5 transition hover:shadow-lift">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><MessagesSquare className="h-5 w-5" /></div>
              <div className="min-w-0"><p className="truncate font-semibold">{c.title}</p><p className="text-sm text-muted">{c.sub}</p></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function ThreadList({ courseId, basePath }: { courseId: string; basePath: string }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', content: '' });
  const threads = useQuery({ queryKey: ['threads', courseId, dq], queryFn: async () => (await api.get(`/courses/${courseId}/threads`, { params: { q: dq || undefined } })).data.data as any[] });
  const create = useMutation({
    mutationFn: async () => (await api.post(`/courses/${courseId}/threads`, form)).data,
    onSuccess: (t) => { setOpen(false); setForm({ title: '', content: '' }); qc.invalidateQueries({ queryKey: ['threads', courseId] }); nav(`${basePath}/${t.id}`); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search threads" className="pl-9" /></div>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New thread</Button>
      </div>
      {threads.isLoading ? <Skeleton className="h-48" /> : threads.isError ? <ErrorState message={errMsg(threads.error)} /> : !threads.data?.length ? (
        <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="No threads yet" description="Start the conversation — ask a question or share a tip." action={<Button onClick={() => setOpen(true)}>Start a thread</Button>} />
      ) : (
        <Card className="divide-y divide-border">
          {threads.data.map((t) => (
            <Link key={t.id} to={`${basePath}/${t.id}`} className="flex gap-4 px-5 py-4 transition hover:bg-surface-2">
              <Avatar name={t.author_name} src={t.author_avatar} size={38} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.title}{t.by_instructor && <Badge tone="brand" className="ml-2">Instructor</Badge>}</p>
                <p className="mt-0.5 line-clamp-1 text-sm text-muted">{t.preview}</p>
                <p className="mt-1 text-xs text-muted">{t.author_name} · {timeAgo(t.created_at)} · last activity {timeAgo(t.last_activity_at)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-sm text-muted"><MessageSquare className="h-4 w-4" />{t.reply_count}</div>
            </Link>
          ))}
        </Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Start a new thread" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={form.title.trim().length < 5 || !form.content.trim()}>Post thread</Button></>}>
        <div className="space-y-4">
          <Field label="Title" hint="At least 5 characters"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Why does median-of-three help?" maxLength={200} /></Field>
          <Field label="Details"><Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Describe your question or idea…" className="min-h-[140px]" maxLength={10000} /></Field>
        </div>
      </Modal>
    </div>
  );
}

export function CourseThreads() {
  const { courseId } = useParams();
  const course = useQuery({ queryKey: ['course', courseId, true], queryFn: async () => (await api.get(`/courses/${courseId}`)).data as any });
  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/app/discussions" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />All forums</Link>
      <PageHeader eyebrow="Course discussion" title={course.data?.title ?? 'Discussion'} />
      <ThreadList courseId={courseId!} basePath={`/app/discussions/${courseId}`} />
    </div>
  );
}

interface Post { id: string; parent_post_id: string | null; content: string; created_at: string; author_name: string; author_avatar: string | null; author_role: string; is_mine: boolean; is_flagged?: boolean; is_hidden: boolean; user_id: string }

export function ThreadPanel({ threadId, backTo }: { threadId: string; backTo: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['thread', threadId], queryFn: async () => (await api.get(`/threads/${threadId}`)).data as { thread: any; posts: Post[]; can_moderate: boolean } });
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [report, setReport] = useState<{ id: string; reason: string } | null>(null);
  const [delThread, setDelThread] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['thread', threadId] });
  const post = useMutation({ mutationFn: (body: { content: string; parent_post_id?: string }) => api.post(`/threads/${threadId}/posts`, body), onSuccess: () => { setText(''); setReplyTo(null); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/posts/${id}`), onSuccess: refresh, onError: (e) => toast.error(errMsg(e)) });
  const moderate = useMutation({ mutationFn: ({ id, action }: { id: string; action: string }) => api.put(`/posts/${id}/moderate`, { action }), onSuccess: () => { refresh(); toast.success('Moderation applied'); }, onError: (e) => toast.error(errMsg(e)) });
  const sendReport = useMutation({ mutationFn: () => api.post(`/posts/${report!.id}/report`, { reason: report!.reason }), onSuccess: (r) => { setReport(null); toast.success(r.data.message); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const removeThread = useMutation({ mutationFn: () => api.delete(`/threads/${threadId}`), onSuccess: () => { toast.success('Thread deleted'); nav(backTo); } });

  const tree = useMemo(() => {
    const byParent: Record<string, Post[]> = {};
    for (const p of q.data?.posts ?? []) (byParent[p.parent_post_id ?? 'root'] ??= []).push(p);
    return byParent;
  }, [q.data]);

  if (q.isLoading) return <PageLoader />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} />;
  const { thread, can_moderate } = q.data!;
  const [first, ...topReplies] = tree.root ?? [];
  const me = useAuth.getState().user;

  // A render function (not a component) so the reply textarea keeps focus while typing.
  const renderPost = (p: Post, depth: number): JSX.Element => (
    <div key={p.id} className={clsx(depth > 0 && 'border-l-2 border-border pl-4 sm:pl-6')}>
      <div className={clsx('rounded-2xl p-4', p.is_flagged && can_moderate && 'bg-rose-50/60 ring-1 ring-rose-200 dark:bg-rose-500/5 dark:ring-rose-500/30')}>
        <div className="flex items-center gap-2.5">
          <Avatar name={p.author_name} src={p.author_avatar} size={30} />
          <span className="text-sm font-semibold">{p.author_name}</span>
          {p.author_role !== 'student' && <Badge tone="brand" className="capitalize">{p.author_role}</Badge>}
          <span className="text-xs text-muted">{timeAgo(p.created_at)}</span>
          {p.is_flagged && can_moderate && <Badge tone="danger"><ShieldAlert className="h-3 w-3" />Reported</Badge>}
          {p.is_hidden && <Badge tone="neutral"><EyeOff className="h-3 w-3" />Hidden</Badge>}
        </div>
        <p className={clsx('mt-2 whitespace-pre-wrap text-sm leading-relaxed', p.is_hidden && 'italic text-muted')}>{p.content}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" icon={<Reply className="h-3.5 w-3.5" />} onClick={() => { setReplyTo(p.id); setText(''); }}>Reply</Button>
          {!p.is_mine && <Button variant="ghost" size="sm" icon={<Flag className="h-3.5 w-3.5" />} onClick={() => setReport({ id: p.id, reason: '' })}>Report</Button>}
          {(p.is_mine || can_moderate) && <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => del.mutate(p.id)}>Delete</Button>}
          {can_moderate && !p.is_mine && (p.is_hidden
            ? <Button variant="ghost" size="sm" onClick={() => moderate.mutate({ id: p.id, action: 'unhide' })}>Unhide</Button>
            : <Button variant="ghost" size="sm" icon={<EyeOff className="h-3.5 w-3.5" />} onClick={() => moderate.mutate({ id: p.id, action: 'hide' })}>Hide</Button>)}
          {can_moderate && p.is_flagged && <Button variant="ghost" size="sm" onClick={() => moderate.mutate({ id: p.id, action: 'dismiss' })}>Dismiss report</Button>}
        </div>
        {replyTo === p.id && (
          <div className="mt-2 rounded-xl border border-border p-3">
            <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply to ${p.author_name}…`} className="min-h-[80px]" />
            <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => post.mutate({ content: text, parent_post_id: p.id })} loading={post.isPending} disabled={!text.trim()}>Post reply</Button><Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>Cancel</Button></div>
          </div>
        )}
      </div>
      {(tree[p.id] ?? []).map((c) => renderPost(c, depth + 1))}
    </div>
  );

  return (
    <div>
      <Link to={backTo} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Back to threads</Link>
      <Card className="mb-6 p-6">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-sm text-muted">{thread.course_title}</p><h1 className="mt-1 text-xl font-bold">{thread.title}</h1></div>
          {(thread.created_by === me?.id || can_moderate) && <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDelThread(true)}>Delete thread</Button>}
        </div>
        {first && <div className="-mx-4 mt-2">{renderPost(first, 0)}</div>}
      </Card>
      <h2 className="mb-3 font-semibold">{(q.data!.posts.length || 1) - 1} replies</h2>
      <div className="space-y-2">{topReplies.map((p) => renderPost(p, 0))}</div>
      <Card className="mt-6 p-4">
        <Textarea value={replyTo ? '' : text} onChange={(e) => { setReplyTo(null); setText(e.target.value); }} placeholder="Write a reply…" className="min-h-[90px]" maxLength={10000} />
        <div className="mt-3 flex justify-end"><Button onClick={() => post.mutate({ content: text })} loading={post.isPending && !replyTo} disabled={!text.trim() || !!replyTo}>Post reply</Button></div>
      </Card>
      <Modal open={!!report} onClose={() => setReport(null)} title="Report this post" size="sm" footer={<><Button variant="outline" onClick={() => setReport(null)}>Cancel</Button><Button variant="danger" onClick={() => sendReport.mutate()} loading={sendReport.isPending} disabled={(report?.reason.trim().length ?? 0) < 3}>Report</Button></>}>
        <Field label="Why are you reporting it?"><Textarea value={report?.reason ?? ''} onChange={(e) => setReport(report && { ...report, reason: e.target.value })} placeholder="e.g. Spam, harassment, sharing answers" /></Field>
      </Modal>
      <ConfirmDialog open={delThread} onClose={() => setDelThread(false)} onConfirm={() => removeThread.mutate()} danger title="Delete this thread?" message="All replies will be deleted too. This can't be undone." confirmLabel="Delete" loading={removeThread.isPending} />
    </div>
  );
}

export function ThreadView() {
  const { courseId, threadId } = useParams();
  return <div className="mx-auto max-w-4xl"><ThreadPanel threadId={threadId!} backTo={`/app/discussions/${courseId}`} /></div>;
}
