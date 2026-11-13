/**
 * Course player (FR-S4, FR-S5).
 *  - Resumes from the last saved position (or ?t=seconds from a tutor citation)
 *  - Playback speed control (remembered per browser)
 *  - Saves progress every ~10 s, on pause and on end; auto-completes at 90% watched
 *  - Timestamped notes & bookmarks, clickable transcript, AI summary, AI tutor side panel
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  ArrowLeft, Bookmark, BookmarkPlus, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, Download, FileText, Gauge,
  ListVideo, Megaphone, MessagesSquare, NotebookPen, PanelRightClose, Pencil, PlayCircle, ScrollText, Sparkles, Trash2, Wand2, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ChatPanel } from '@/components/ai-tutor/ChatPanel';
import { Markdown } from '@/components/common/Markdown';
import { Badge, Button, Card, DemoBadge, EmptyState, ErrorState, Input, PageLoader, ProgressBar, Spinner, Tabs, Textarea } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import type { CourseDetail } from '@/types';
import { clock, duration, timeAgo } from '@/utils/format';

interface PlayerData {
  lecture: { id: string; title: string; video_url: string | null; transcript: string | null; duration_seconds: number | null; module_id: string; module_title: string; resources: { key: string; name: string; url: string }[] };
  course: { id: string; title: string };
  prev_lecture_id: string | null;
  next_lecture_id: string | null;
  progress: { watched_seconds: number; completed: boolean };
  notes: { id: string; content: string; timestamp_seconds: number | null; created_at: string }[];
  bookmarks: { id: string; label: string | null; timestamp_seconds: number; created_at: string }[];
  is_preview: boolean;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
type Tab = 'overview' | 'transcript' | 'notes' | 'bookmarks' | 'summary' | 'announcements';

export function CoursePlayer() {
  const { courseId, lectureId } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'overview');
  const [side, setSide] = useState<'curriculum' | 'tutor' | null>(() => (window.innerWidth >= 1024 ? 'curriculum' : null));
  const [speed, setSpeed] = useState(() => { try { return Number(localStorage.getItem('vl-speed')) || 1; } catch { return 1; } });
  const [currentTime, setCurrentTime] = useState(0);

  const course = useQuery({ queryKey: ['course', courseId, true], queryFn: async () => (await api.get<CourseDetail>(`/courses/${courseId}`)).data });

  // No lecture in the URL → open the last watched lecture, else the first one.
  useEffect(() => {
    if (!lectureId && course.data) {
      const first = course.data.modules.flatMap((m) => m.lectures)[0]?.id;
      const target = course.data.enrollment?.last_lecture_id ?? first;
      if (target) nav(`/app/learn/${courseId}/${target}${params.toString() ? `?${params}` : ''}`, { replace: true });
    }
  }, [lectureId, course.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const player = useQuery({ queryKey: ['lecture', lectureId], enabled: !!lectureId, queryFn: async () => (await api.get<PlayerData>(`/lectures/${lectureId}`)).data });
  const d = player.data;

  // ---- progress tracking ----
  const lastSent = useRef({ at: 0, pos: 0 });
  const watchedSinceSend = useRef(0);
  const lastTick = useRef<number | null>(null);
  const completedRef = useRef(false);
  useEffect(() => { completedRef.current = !!d?.progress.completed; lastSent.current = { at: Date.now(), pos: d?.progress.watched_seconds ?? 0 }; watchedSinceSend.current = 0; }, [d?.lecture.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = useMutation({
    mutationFn: (body: { position_seconds: number; delta_seconds: number; completed?: boolean }) => api.post(`/lectures/${lectureId}/progress`, body).then((r) => r.data),
    onSuccess: (r) => {
      if (r.just_completed) {
        completedRef.current = true;
        toast.success('Lecture complete!', { description: r.progress_percent >= 100 ? '🎉 You finished the course — your certificate is being generated.' : `Course progress: ${Math.round(r.progress_percent)}%` });
        qc.invalidateQueries({ queryKey: ['course', courseId] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
        qc.invalidateQueries({ queryKey: ['lecture', lectureId] });
      }
    },
  });
  const send = useCallback((force = false, completed?: boolean) => {
    const v = videoRef.current;
    if (!d || d.is_preview) return;
    const pos = v ? v.currentTime : 0;
    if (!force && Date.now() - lastSent.current.at < 10_000) return;
    const delta = Math.min(60, Math.round(watchedSinceSend.current));
    watchedSinceSend.current = 0;
    lastSent.current = { at: Date.now(), pos };
    progress.mutate({ position_seconds: Math.round(pos), delta_seconds: delta, completed });
  }, [d, progress]);

  const onTimeUpdate = () => {
    const v = videoRef.current!;
    setCurrentTime(v.currentTime);
    const now = performance.now();
    if (lastTick.current != null && !v.paused) watchedSinceSend.current += Math.min(2, (now - lastTick.current) / 1000) * 1; // wall-clock watch time
    lastTick.current = now;
    if (!completedRef.current && v.duration && v.currentTime >= v.duration * 0.9) {
      completedRef.current = true;
      send(true, true);
    } else send();
  };
  // Save the position when leaving the lecture (uses a ref so the latest `send` is called).
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => () => { sendRef.current(true); }, [lectureId]);
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && send(true);
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [send]);

  const onLoaded = () => {
    const v = videoRef.current!;
    v.playbackRate = speed;
    const t = Number(params.get('t'));
    const resume = !isNaN(t) && params.get('t') ? t : d?.progress.completed ? 0 : d?.progress.watched_seconds ?? 0;
    if (resume > 0 && resume < (v.duration || Infinity) - 2) {
      v.currentTime = resume;
      if (!params.get('t')) toast.message(`Resumed at ${clock(resume)}`, { duration: 2500 });
    }
  };
  const seek = (s: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = s;
    v.play().catch(() => undefined);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const changeSpeed = (s: number) => {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
    try { localStorage.setItem('vl-speed', String(s)); } catch { /* ignore */ }
  };
  useEffect(() => { const t = params.get('t'); if (t && videoRef.current && videoRef.current.readyState > 0) seek(Number(t)); }, [params.get('t')]); // eslint-disable-line react-hooks/exhaustive-deps

  const markComplete = () => { completedRef.current = true; send(true, true); };

  const allLectures = useMemo(() => course.data?.modules.flatMap((m) => m.lectures.map((l) => ({ ...l, module: m.title }))) ?? [], [course.data]);
  const changeTab = (t: Tab) => { setTab(t); const p = new URLSearchParams(params); p.set('tab', t); p.delete('t'); setParams(p, { replace: true }); };

  if (course.isError) return <ErrorState message={errMsg(course.error)} onRetry={() => course.refetch()} />;
  if (player.isError) {
    return <EmptyState title="You don't have access to this lecture" description={errMsg(player.error)} action={<Link to={`/courses/${courseId}`}><Button>View course</Button></Link>} />;
  }
  if (!d || !course.data) return <PageLoader label="Loading lecture…" />;
  const c = course.data;

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8 lg:-my-8">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <Link to={d.is_preview ? `/instructor/courses/${c.id}` : '/app/learning'} className="rounded-lg p-1.5 text-muted hover:bg-surface-2" aria-label="Back"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted">{c.title}</p>
          <p className="truncate font-semibold">{d.lecture.title}</p>
        </div>
        {d.is_preview ? <Badge tone="info">Preview mode — progress isn't tracked</Badge> : c.enrollment && (
          <div className="hidden w-48 items-center gap-2 md:flex"><ProgressBar value={c.enrollment.progress_percent} size="sm" /><span className="text-xs font-semibold">{Math.round(c.enrollment.progress_percent)}%</span></div>
        )}
        <div className="flex gap-1">
          <Button variant={side === 'curriculum' ? 'secondary' : 'ghost'} size="sm" icon={<ListVideo className="h-4 w-4" />} onClick={() => setSide(side === 'curriculum' ? null : 'curriculum')}>Content</Button>
          <Button variant={side === 'tutor' ? 'secondary' : 'ghost'} size="sm" icon={<Sparkles className="h-4 w-4" />} onClick={() => setSide(side === 'tutor' ? null : 'tutor')}>AI Tutor</Button>
        </div>
      </div>

      <div className="flex">
        {/* Main column */}
        <div className="min-w-0 flex-1">
          <div className="bg-black">
            {d.lecture.video_url ? (
              <video key={d.lecture.id} ref={videoRef} src={d.lecture.video_url} controls playsInline preload="metadata" className="mx-auto aspect-video max-h-[70vh] w-full bg-black"
                onLoadedMetadata={onLoaded} onTimeUpdate={onTimeUpdate} onPause={() => { lastTick.current = null; send(true); }} onPlay={() => { lastTick.current = performance.now(); }}
                onEnded={() => { if (!completedRef.current) { completedRef.current = true; send(true, true); } else send(true); }}>
                Your browser does not support HTML5 video.
              </video>
            ) : (
              <div className="grid aspect-video max-h-[50vh] w-full place-items-center bg-gradient-to-br from-navy-900 to-brand-900 text-white">
                <div className="text-center"><ScrollText className="mx-auto mb-3 h-10 w-10 text-brand-300" /><p className="font-semibold">Reading lecture</p><p className="text-sm text-white/70">This lecture has no video — read the transcript and resources below.</p></div>
              </div>
            )}
          </div>

          <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted">{d.lecture.module_title}</p>
                <h1 className="text-xl font-bold sm:text-2xl">{d.lecture.title}</h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {d.lecture.video_url && (
                  <label className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-sm">
                    <Gauge className="h-4 w-4 text-muted" /><span className="sr-only">Playback speed</span>
                    <select value={speed} onChange={(e) => changeSpeed(Number(e.target.value))} className="bg-transparent font-medium outline-none" aria-label="Playback speed">
                      {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
                    </select>
                  </label>
                )}
                {!d.is_preview && (completedRef.current || d.progress.completed
                  ? <Badge tone="success" className="h-8 px-3"><CheckCircle2 className="h-4 w-4" />Completed</Badge>
                  : <Button variant="outline" size="sm" icon={<Check className="h-4 w-4" />} onClick={markComplete} loading={progress.isPending}>Mark complete</Button>)}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" disabled={!d.prev_lecture_id} onClick={() => nav(`/app/learn/${courseId}/${d.prev_lecture_id}`)} icon={<ChevronLeft className="h-4 w-4" />}>Previous</Button>
              <Button size="sm" disabled={!d.next_lecture_id} onClick={() => nav(`/app/learn/${courseId}/${d.next_lecture_id}`)} className="flex-row-reverse" icon={<ChevronRight className="h-4 w-4" />}>Next lecture</Button>
            </div>

            <Tabs className="mt-6" value={tab} onChange={changeTab} tabs={[
              { value: 'overview', label: 'Overview' },
              { value: 'transcript', label: 'Transcript' },
              { value: 'notes', label: 'Notes', count: d.notes.length },
              { value: 'bookmarks', label: 'Bookmarks', count: d.bookmarks.length },
              { value: 'summary', label: <span className="flex items-center gap-1"><Wand2 className="h-3.5 w-3.5" />AI summary</span> },
              { value: 'announcements', label: 'Announcements' },
            ]} />
            <div className="py-6">
              {tab === 'overview' && <Overview d={d} courseId={c.id} />}
              {tab === 'transcript' && <Transcript text={d.lecture.transcript} onSeek={seek} hasVideo={!!d.lecture.video_url} />}
              {tab === 'notes' && <Notes d={d} lectureId={lectureId!} currentTime={currentTime} onSeek={seek} />}
              {tab === 'bookmarks' && <Bookmarks d={d} lectureId={lectureId!} currentTime={currentTime} onSeek={seek} />}
              {tab === 'summary' && <Summary lectureId={lectureId!} />}
              {tab === 'announcements' && <Announcements courseId={c.id} />}
            </div>
          </div>
        </div>

        {/* Side panel */}
        {side && (
          <aside className="fixed inset-0 top-16 z-20 flex w-full flex-col border-l border-border bg-surface lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:w-[380px] lg:shrink-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-2 lg:hidden">
              <span className="text-sm font-semibold">{side === 'tutor' ? 'AI Tutor' : 'Course content'}</span>
              <button onClick={() => setSide(null)} className="rounded-lg p-1.5" aria-label="Close panel"><X className="h-5 w-5" /></button>
            </div>
            {side === 'tutor' ? (
              <ChatPanel courseId={c.id} courseTitle={c.title} lectureId={lectureId} compact onSeek={seek} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="hidden items-center justify-between border-b border-border px-4 py-3 lg:flex">
                  <p className="text-sm font-semibold">Course content</p>
                  <button onClick={() => setSide(null)} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Hide"><PanelRightClose className="h-4 w-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-thin">
                  {c.modules.map((m, mi) => (
                    <div key={m.id}>
                      <p className="sticky top-0 z-10 border-b border-border bg-surface-2 px-4 py-2.5 text-xs font-semibold">Module {mi + 1}: {m.title}<span className="ml-1 font-normal text-muted">· {m.lectures.filter((l) => l.completed).length}/{m.lectures.length}</span></p>
                      {m.lectures.map((l) => {
                        const isActive = l.id === lectureId;
                        return (
                          <Link key={l.id} to={`/app/learn/${c.id}/${l.id}`} onClick={() => window.innerWidth < 1024 && setSide(null)}
                            className={clsx('flex items-start gap-3 border-b border-border/60 px-4 py-3 text-sm transition', isActive ? 'bg-brand-50 dark:bg-brand-500/10' : 'hover:bg-surface-2')}>
                            {l.completed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : isActive ? <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                            <div className="min-w-0"><p className={clsx('leading-snug', isActive && 'font-semibold text-brand-700 dark:text-brand-300')}>{l.title}</p><p className="mt-0.5 text-xs text-muted">{duration(l.duration_seconds)}{l.resource_count > 0 && ` · ${l.resource_count} resource${l.resource_count > 1 ? 's' : ''}`}</p></div>
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="border-t border-border p-3 text-xs text-muted">{allLectures.filter((l) => l.completed).length} of {allLectures.length} lectures complete</div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function Overview({ d, courseId }: { d: PlayerData; courseId: string }) {
  const quizzes = useQuery({ queryKey: ['course-quizzes', courseId], queryFn: async () => (await api.get(`/courses/${courseId}/quizzes`)).data.data as any[] });
  const moduleQuizzes = quizzes.data?.filter((q) => q.module_id === d.lecture.module_id) ?? [];
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-brand-600" />Resources</h3>
        {!d.lecture.resources.length ? <p className="text-sm text-muted">No downloadable resources for this lecture.</p> : (
          <ul className="space-y-2">{d.lecture.resources.map((r) => (
            <li key={r.key}><a href={`${r.url}&download=1`} className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm transition hover:bg-surface-2"><FileText className="h-5 w-5 text-rose-500" /><span className="flex-1 truncate font-medium">{r.name}</span><Download className="h-4 w-4 text-muted" /></a></li>
          ))}</ul>
        )}
      </Card>
      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4 text-brand-600" />Practice this module</h3>
        {quizzes.isLoading ? <Spinner /> : !moduleQuizzes.length ? <p className="text-sm text-muted">No quizzes for this module yet.</p> : (
          <ul className="space-y-2">{moduleQuizzes.map((q) => (
            <li key={q.id}><Link to={`/app/quizzes/${q.id}`} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm transition hover:bg-surface-2"><span className="font-medium">{q.title}</span><span className="text-xs text-muted">{q.best_score != null ? `Best ${Math.round(q.best_score)}%` : `${q.question_count} questions`}</span></Link></li>
          ))}</ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to={`/app/flashcards?module=${d.lecture.module_id}&course=${courseId}`}><Button variant="secondary" size="sm">Module flashcards</Button></Link>
          <Link to={`/app/discussions/${courseId}`}><Button variant="outline" size="sm" icon={<MessagesSquare className="h-4 w-4" />}>Discussion</Button></Link>
        </div>
      </Card>
    </div>
  );
}

/** Transcript with clickable [mm:ss] markers that seek the video. */
function Transcript({ text, onSeek, hasVideo }: { text: string | null; onSeek: (s: number) => void; hasVideo: boolean }) {
  if (!text) return <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No transcript" description="The instructor hasn't added a transcript for this lecture." />;
  const lines = text.split(/\n+/).filter(Boolean);
  return (
    <Card className="divide-y divide-border">
      {lines.map((line, i) => {
        const m = line.match(/^\s*\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]\s*/);
        const secs = m ? (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : null;
        return (
          <div key={i} className="flex gap-4 px-5 py-3 text-sm leading-relaxed">
            {secs != null ? (
              <button disabled={!hasVideo} onClick={() => onSeek(secs)} className="h-fit shrink-0 rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-default dark:bg-brand-500/15 dark:text-brand-300">{clock(secs)}</button>
            ) : <span className="w-12 shrink-0" />}
            <p>{m ? line.slice(m[0].length) : line}</p>
          </div>
        );
      })}
    </Card>
  );
}

function Notes({ d, lectureId, currentTime, onSeek }: { d: PlayerData; lectureId: string; currentTime: number; onSeek: (s: number) => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['lecture', lectureId] });
  const add = useMutation({ mutationFn: () => api.post(`/lectures/${lectureId}/notes`, { content: text, timestamp_seconds: Math.floor(currentTime) }), onSuccess: () => { setText(''); refresh(); toast.success('Note saved'); }, onError: (e) => toast.error(errMsg(e)) });
  const update = useMutation({ mutationFn: (n: { id: string; content: string }) => api.put(`/notes/${n.id}`, { content: n.content }), onSuccess: () => { setEditing(null); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/notes/${id}`), onSuccess: refresh });
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`Write a note at ${clock(currentTime)}…`} className="min-h-[80px]" maxLength={5000} />
        <div className="mt-3 flex items-center justify-between"><span className="text-xs text-muted">Timestamp: {clock(currentTime)}</span><Button size="sm" disabled={!text.trim()} loading={add.isPending} onClick={() => add.mutate()} icon={<NotebookPen className="h-4 w-4" />}>Save note</Button></div>
      </Card>
      {!d.notes.length ? <p className="py-6 text-center text-sm text-muted">No notes yet. Notes are saved with the video timestamp so you can jump back later.</p> : d.notes.map((n) => (
        <Card key={n.id} className="flex gap-3 p-4">
          {n.timestamp_seconds != null && <button onClick={() => onSeek(n.timestamp_seconds!)} className="h-fit shrink-0 rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{clock(n.timestamp_seconds)}</button>}
          <div className="min-w-0 flex-1">
            {editing?.id === n.id ? (
              <div><Textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} className="min-h-[70px]" /><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => update.mutate(editing)} loading={update.isPending}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div></div>
            ) : <p className="whitespace-pre-wrap text-sm">{n.content}</p>}
            <p className="mt-1 text-xs text-muted">{timeAgo(n.created_at)}</p>
          </div>
          {editing?.id !== n.id && (
            <div className="flex gap-1">
              <button onClick={() => setEditing({ id: n.id, content: n.content })} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Edit note"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => del.mutate(n.id)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-rose-600" aria-label="Delete note"><Trash2 className="h-4 w-4" /></button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Bookmarks({ d, lectureId, currentTime, onSeek }: { d: PlayerData; lectureId: string; currentTime: number; onSeek: (s: number) => void }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['lecture', lectureId] });
  const add = useMutation({ mutationFn: () => api.post(`/lectures/${lectureId}/bookmarks`, { timestamp_seconds: Math.floor(currentTime), label: label || undefined }), onSuccess: () => { setLabel(''); refresh(); toast.success('Bookmarked'); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/bookmarks/${id}`), onSuccess: refresh });
  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-2 p-4 sm:flex-row">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional) — e.g. “Worst-case example”" maxLength={200} />
        <Button onClick={() => add.mutate()} loading={add.isPending} icon={<BookmarkPlus className="h-4 w-4" />}>Bookmark {clock(currentTime)}</Button>
      </Card>
      {!d.bookmarks.length ? <p className="py-6 text-center text-sm text-muted">No bookmarks yet.</p> : (
        <Card className="divide-y divide-border">
          {d.bookmarks.map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-3">
              <Bookmark className="h-4 w-4 text-brand-600" />
              <button onClick={() => onSeek(b.timestamp_seconds)} className="flex-1 text-left text-sm"><span className="mr-2 font-mono font-semibold text-brand-700 dark:text-brand-300">{clock(b.timestamp_seconds)}</span>{b.label ?? 'Bookmark'}</button>
              <button onClick={() => del.mutate(b.id)} className="rounded-lg p-1.5 text-muted hover:text-rose-600" aria-label="Delete bookmark"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Summary({ lectureId }: { lectureId: string }) {
  const m = useMutation({ mutationFn: async () => (await api.post(`/ai/lectures/${lectureId}/summarize`)).data as { summary: string; key_points: string[]; key_terms: { term: string; definition: string }[]; is_demo: boolean }, onError: (e) => toast.error(errMsg(e)) });
  useEffect(() => { m.reset(); }, [lectureId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m.data) {
    return (
      <EmptyState icon={<Wand2 className="h-6 w-6" />} title="Summarize this lecture" description="Get the key points and terms from this lecture's transcript and documents in seconds."
        action={<Button onClick={() => m.mutate()} loading={m.isPending} icon={<Sparkles className="h-4 w-4" />}>Generate summary</Button>} />
    );
  }
  const s = m.data;
  return (
    <div className="space-y-5 animate-fade-in">
      {s.is_demo && <DemoBadge />}
      <Card className="p-5"><h3 className="mb-2 font-semibold">Summary</h3><Markdown>{s.summary}</Markdown></Card>
      <Card className="p-5">
        <h3 className="mb-3 font-semibold">Key points</h3>
        <ul className="space-y-2.5">{s.key_points.map((p, i) => <li key={i} className="flex gap-3 text-sm"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{i + 1}</span>{p}</li>)}</ul>
      </Card>
      {s.key_terms.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 font-semibold">Key terms</h3>
          <dl className="grid gap-3 sm:grid-cols-2">{s.key_terms.map((t) => <div key={t.term} className="rounded-xl bg-surface-2 p-3"><dt className="text-sm font-semibold">{t.term}</dt><dd className="mt-1 text-sm text-muted">{t.definition}</dd></div>)}</dl>
        </Card>
      )}
    </div>
  );
}

function Announcements({ courseId }: { courseId: string }) {
  const q = useQuery({ queryKey: ['announcements', courseId], queryFn: async () => (await api.get(`/courses/${courseId}/announcements`)).data.data as any[] });
  if (q.isLoading) return <Spinner />;
  if (!q.data?.length) return <EmptyState icon={<Megaphone className="h-6 w-6" />} title="No announcements" description="Your instructor's announcements for this course will appear here." />;
  return (
    <div className="space-y-3">{q.data.map((a) => (
      <Card key={a.id} className="p-5"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{a.title}</h3><span className="shrink-0 text-xs text-muted">{timeAgo(a.created_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-muted">{a.content}</p><p className="mt-3 text-xs text-muted">— {a.author}</p></Card>
    ))}</div>
  );
}
