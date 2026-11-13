import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarCheck2, Layers, MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChatPanel } from '@/components/ai-tutor/ChatPanel';
import { Button, Card, EmptyState, PageHeader, Select, Skeleton } from '@/components/common/ui';
import { api } from '@/services/api';
import { useAuth } from '@/store/auth';
import { timeAgo } from '@/utils/format';

interface SessionRow { id: string; course_id: string; course_title: string; title: string | null; mode: string; created_at: string; last_message_at: string | null; message_count: number }

export function TutorPage() {
  const { sessionId } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user)!;
  const isStudent = user.roles.includes('student');

  // Courses this user can chat about: enrolled courses (students) or own courses (instructors, "as reviewer").
  const courses = useQuery({
    queryKey: ['tutor-courses', isStudent],
    queryFn: async () => isStudent
      ? (await api.get('/enrollments/me')).data.data.map((e: any) => ({ id: e.course_id, title: e.title }))
      : (await api.get('/instructor/courses')).data.data.map((c: any) => ({ id: c.id, title: c.title })),
  });
  const sessions = useQuery({ queryKey: ['chat-sessions'], queryFn: async () => (await api.get<{ data: SessionRow[] }>('/ai/chat/sessions')).data.data });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/ai/chat/sessions/${id}`),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['chat-sessions'] }); if (id === sessionId) nav('/app/tutor'); },
  });

  const active = sessions.data?.find((s) => s.id === sessionId);
  const [picked, setPicked] = useState<string>(params.get('course') ?? '');
  const courseId = active?.course_id ?? picked ?? courses.data?.[0]?.id;
  const effectiveCourse = courseId || courses.data?.[0]?.id || '';
  const courseTitle = useMemo(() => courses.data?.find((c: any) => c.id === effectiveCourse)?.title, [courses.data, effectiveCourse]);

  if (courses.isSuccess && !courses.data.length) {
    return (
      <div>
        <PageHeader title="AI Tutor" subtitle="Course-grounded answers, summaries, quizzes and study plans." />
        <EmptyState icon={<Sparkles className="h-6 w-6" />} title={isStudent ? 'Enroll in a course to use the tutor' : 'Create a course to review the tutor'} description="The tutor answers from a specific course's material, so it needs a course to work with."
          action={<Link to={isStudent ? '/courses' : '/instructor/courses/new'}><Button>{isStudent ? 'Browse courses' : 'Create a course'}</Button></Link>} />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[560px] flex-col">
      <PageHeader title="AI Tutor" subtitle={isStudent ? 'Course-grounded answers with sources — at any hour.' : 'Review how the tutor answers questions about your course material.'}
        actions={isStudent && (
          <>
            <Link to="/app/flashcards"><Button variant="outline" size="sm" icon={<Layers className="h-4 w-4" />}>Flashcards</Button></Link>
            <Link to="/app/study-plan"><Button variant="outline" size="sm" icon={<CalendarCheck2 className="h-4 w-4" />}>Study plan</Button></Link>
          </>
        )} />
      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[280px_1fr]">
        <Card className="hidden min-h-0 flex-col lg:flex">
          <div className="space-y-3 border-b border-border p-4">
            <label className="label text-xs" htmlFor="course-pick">Course</label>
            {courses.isLoading ? <Skeleton className="h-10" /> : (
              <Select id="course-pick" value={effectiveCourse} onChange={(e) => { setPicked(e.target.value); nav('/app/tutor'); }}>
                {courses.data?.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </Select>
            )}
            <Button className="w-full" variant="secondary" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => { setPicked(effectiveCourse); nav('/app/tutor'); }}>New conversation</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
            <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">History</p>
            {sessions.isLoading ? <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : !sessions.data?.length ? <p className="px-2 py-4 text-sm text-muted">No conversations yet.</p> : sessions.data.filter((s) => s.message_count > 0).map((s) => (
              <div key={s.id} className={clsx('group flex items-center rounded-xl', s.id === sessionId ? 'bg-brand-50 dark:bg-brand-500/15' : 'hover:bg-surface-2')}>
                <Link to={`/app/tutor/${s.id}`} className="min-w-0 flex-1 px-3 py-2">
                  <p className={clsx('truncate text-sm', s.id === sessionId ? 'font-semibold text-brand-700 dark:text-brand-300' : 'font-medium')}>{s.title ?? 'New conversation'}</p>
                  <p className="truncate text-xs text-muted">{s.course_title} · {timeAgo(s.last_message_at ?? s.created_at)}</p>
                </Link>
                <button onClick={() => del.mutate(s.id)} className="mr-1 rounded-lg p-1.5 text-muted opacity-0 transition hover:text-rose-600 group-hover:opacity-100" aria-label="Delete conversation"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </Card>
        <div className="min-h-0">
          <div className="mb-3 lg:hidden">
            <Select value={effectiveCourse} onChange={(e) => { setPicked(e.target.value); nav('/app/tutor'); }} aria-label="Course">
              {courses.data?.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          </div>
          {effectiveCourse ? (
            <ChatPanel key={effectiveCourse} courseId={effectiveCourse} courseTitle={courseTitle} sessionId={sessionId}
              onSessionCreated={(id) => id ? nav(`/app/tutor/${id}`, { replace: true }) : nav('/app/tutor')} />
          ) : <Skeleton className="h-full" />}
        </div>
      </div>
    </div>
  );
}
