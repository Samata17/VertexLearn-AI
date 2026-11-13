/**
 * Instructor course editor (PRD 5.3): details, curriculum (modules/lectures with video + PDF uploads),
 * quizzes (manual + AI-generated drafts), assignments with rubrics, announcements, discussions, analytics.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Archive, BarChart3, CheckCircle2, ClipboardList, Eye, FileText, Film, ImagePlus, Loader2, Megaphone,
  MessagesSquare, Pencil, Plus, RefreshCw, RotateCcw, Send, Sparkles, Trash2, Upload, Users, Wand2, X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bars } from '@/components/common/charts';
import { CourseThumb } from '@/components/common/CourseVisuals';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoader, ProgressBar, Select, Skeleton, Tabs, Textarea, Toggle, statusTone,
} from '@/components/common/ui';
import { ThreadList, ThreadPanel } from '@/pages/discussions/Discussions';
import { api, errMsg } from '@/services/api';
import type { CourseDetail } from '@/types';
import { clock, date, dateTime, duration, timeAgo } from '@/utils/format';
import { CourseForm, type CourseFormValue } from './InstructorCourses';

type Tab = 'details' | 'curriculum' | 'quizzes' | 'assignments' | 'announcements' | 'discussions' | 'analytics';

export function CourseEditor() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'details';
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const course = useQuery({ queryKey: ['course', id, true], queryFn: async () => (await api.get<CourseDetail>(`/courses/${id}`)).data });

  if (course.isLoading) return <PageLoader />;
  if (course.isError) return <ErrorState message={errMsg(course.error)} />;
  const c = course.data!;
  const lectures = c.modules.reduce((s, m) => s + m.lectures.length, 0);

  return (
    <div>
      <Link to="/instructor/courses" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />My courses</Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="w-full overflow-hidden rounded-2xl sm:w-44"><CourseThumb minimal course={c} /></div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone={statusTone(c.status)} className="capitalize">{c.status}</Badge><span className="text-sm text-muted">{c.modules.length} modules · {lectures} lectures · {c.enrollment_count} students</span></div>
          <h1 className="text-2xl font-bold tracking-tight">{c.title}</h1>
        </div>
        <div className="flex gap-2">
          <Link to={`/courses/${c.id}`}><Button variant="outline" size="sm" icon={<Eye className="h-4 w-4" />}>Course page</Button></Link>
          {lectures > 0 && <Link to={`/app/learn/${c.id}`}><Button variant="secondary" size="sm" icon={<Film className="h-4 w-4" />}>Preview</Button></Link>}
        </div>
      </div>
      {c.status === 'rejected' && <ReviewBanner course={c} />}
      {c.status === 'pending' && <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">This course is <b>awaiting admin review</b>. Keep adding content — it will appear in the catalog once approved.</div>}

      <Tabs value={tab} onChange={setTab} className="mb-6" tabs={[
        { value: 'details', label: 'Details' },
        { value: 'curriculum', label: 'Curriculum', count: lectures },
        { value: 'quizzes', label: 'Quizzes' },
        { value: 'assignments', label: 'Assignments' },
        { value: 'announcements', label: 'Announcements' },
        { value: 'discussions', label: 'Discussions' },
        { value: 'analytics', label: 'Analytics' },
      ]} />
      {tab === 'details' && <DetailsTab course={c} />}
      {tab === 'curriculum' && <CurriculumTab course={c} />}
      {tab === 'quizzes' && <QuizzesTab course={c} />}
      {tab === 'assignments' && <AssignmentsTab course={c} />}
      {tab === 'announcements' && <AnnouncementsTab course={c} />}
      {tab === 'discussions' && <DiscussionsTab course={c} threadId={params.get('thread')} />}
      {tab === 'analytics' && <CourseAnalyticsPanel courseId={c.id} />}
    </div>
  );
}

function ReviewBanner({ course }: { course: CourseDetail }) {
  const qc = useQueryClient();
  const resubmit = useMutation({ mutationFn: () => api.put(`/courses/${course.id}`, { resubmit: true }), onSuccess: () => { toast.success('Resubmitted for review'); qc.invalidateQueries({ queryKey: ['course', course.id] }); } });
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/30 dark:bg-rose-500/10 sm:flex-row sm:items-center">
      <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
      <div className="flex-1 text-sm"><p className="font-semibold text-rose-800 dark:text-rose-200">Changes requested by an admin</p>{course.latest_review?.comment && <p className="text-rose-700 dark:text-rose-300">“{course.latest_review.comment}”</p>}</div>
      <Button size="sm" onClick={() => resubmit.mutate()} loading={resubmit.isPending} icon={<Send className="h-4 w-4" />}>Resubmit for review</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
function DetailsTab({ course }: { course: CourseDetail }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [v, setV] = useState<CourseFormValue>({ title: course.title, description: course.description ?? '', category: course.category ?? 'Computer Science', difficulty: course.difficulty, price: String(course.price ?? 0), learning_outcomes: course.learning_outcomes });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['course', course.id] }); qc.invalidateQueries({ queryKey: ['instructor-courses'] }); };
  const save = useMutation({ mutationFn: () => api.put(`/courses/${course.id}`, { ...v, price: Number(v.price) || 0 }), onSuccess: () => { toast.success('Course saved'); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const thumb = useMutation({ mutationFn: (f: File) => { const fd = new FormData(); fd.append('thumbnail', f); return api.post(`/courses/${course.id}/thumbnail`, fd); }, onSuccess: () => { toast.success('Thumbnail updated'); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const archive = useMutation({ mutationFn: (archived: boolean) => api.put(`/courses/${course.id}`, { archived }), onSuccess: (_d, a) => { toast.success(a ? 'Course archived' : 'Course restored and sent for review'); refresh(); } });
  const del = useMutation({ mutationFn: () => api.delete(`/courses/${course.id}`), onSuccess: () => { toast.success('Course deleted'); qc.invalidateQueries({ queryKey: ['instructor-courses'] }); nav('/instructor/courses'); }, onError: (e) => { setConfirmDelete(false); toast.error(errMsg(e)); } });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="p-6">
        <CourseForm value={v} onChange={setV} />
        <div className="mt-6 flex justify-end border-t border-border pt-5"><Button onClick={() => save.mutate()} loading={save.isPending}>Save changes</Button></div>
      </Card>
      <div className="space-y-5">
        <Card className="p-5">
          <p className="mb-3 font-semibold">Thumbnail</p>
          <div className="overflow-hidden rounded-xl"><CourseThumb course={course} /></div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && thumb.mutate(e.target.files[0])} />
          <Button variant="outline" size="sm" className="mt-3 w-full" icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileRef.current?.click()} loading={thumb.isPending}>Upload image</Button>
          <p className="mt-2 text-xs text-muted">PNG, JPG or WebP up to 5 MB. Without one, a generated cover is used.</p>
        </Card>
        <Card className="p-5">
          <p className="mb-1 font-semibold">Visibility</p>
          <p className="mb-3 text-sm text-muted">Archived courses are hidden from the catalog; enrolled students keep access.</p>
          {course.status === 'archived'
            ? <Button variant="outline" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => archive.mutate(false)} loading={archive.isPending}>Restore course</Button>
            : <Button variant="outline" size="sm" icon={<Archive className="h-4 w-4" />} onClick={() => archive.mutate(true)} loading={archive.isPending}>Archive course</Button>}
        </Card>
        <Card className="border-rose-200 p-5 dark:border-rose-500/30">
          <p className="mb-1 font-semibold text-rose-700 dark:text-rose-300">Delete course</p>
          <p className="mb-3 text-sm text-muted">Permanently deletes the course and all its content. Courses with enrolled students must be archived instead.</p>
          <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>Delete course</Button>
        </Card>
      </div>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} onConfirm={() => del.mutate()} danger loading={del.isPending} title="Delete this course?" message="All modules, lectures, quizzes and assignments will be permanently deleted." confirmLabel="Delete course" />
    </div>
  );
}

// ---------------------------------------------------------------------------
const ingestBadge = (s: string) => ({
  ready: <Badge tone="success"><CheckCircle2 className="h-3 w-3" />AI indexed</Badge>,
  queued: <Badge tone="info"><Loader2 className="h-3 w-3 animate-spin" />Queued for AI</Badge>,
  processing: <Badge tone="info"><Loader2 className="h-3 w-3 animate-spin" />Indexing</Badge>,
  failed: <Badge tone="danger">Indexing failed</Badge>,
  none: <Badge tone="neutral">No material for AI</Badge>,
} as Record<string, JSX.Element>)[s] ?? null;

function CurriculumTab({ course }: { course: CourseDetail }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['course', course.id] });
  const [newModule, setNewModule] = useState('');
  const [editModule, setEditModule] = useState<{ id: string; title: string } | null>(null);
  const [lectureModal, setLectureModal] = useState<{ moduleId: string; lectureId?: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'module' | 'lecture'; id: string; title: string } | null>(null);

  // Poll while any lecture is being indexed so status badges update by themselves.
  const indexing = course.modules.some((m) => m.lectures.some((l) => l.ingest_status === 'queued' || l.ingest_status === 'processing'));
  useEffect(() => { if (!indexing) return; const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [indexing]); // eslint-disable-line react-hooks/exhaustive-deps

  const addModule = useMutation({ mutationFn: () => api.post(`/courses/${course.id}/modules`, { title: newModule }), onSuccess: () => { setNewModule(''); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const renameModule = useMutation({ mutationFn: () => api.put(`/modules/${editModule!.id}`, { title: editModule!.title }), onSuccess: () => { setEditModule(null); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const remove = useMutation({ mutationFn: () => api.delete(confirm!.kind === 'module' ? `/modules/${confirm!.id}` : `/lectures/${confirm!.id}`), onSuccess: () => { setConfirm(null); refresh(); toast.success('Deleted'); }, onError: (e) => toast.error(errMsg(e)) });
  const reorderModules = useMutation({ mutationFn: (ids: string[]) => api.put(`/courses/${course.id}/modules/reorder`, { ids }), onSuccess: refresh });
  const reorderLectures = useMutation({ mutationFn: ({ moduleId, ids }: { moduleId: string; ids: string[] }) => api.put(`/modules/${moduleId}/lectures/reorder`, { ids }), onSuccess: refresh });
  const reindex = useMutation({ mutationFn: (id: string) => api.post(`/lectures/${id}/ingest`), onSuccess: () => { toast.success('Re-indexing started'); refresh(); } });

  const move = <T extends { id: string }>(list: T[], i: number, d: number) => { const ids = list.map((x) => x.id); const j = i + d; if (j < 0 || j >= ids.length) return null; [ids[i], ids[j]] = [ids[j], ids[i]]; return ids; };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-4 text-sm dark:border-brand-500/30 dark:bg-brand-500/5">
        <p className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-brand-600" />How the AI tutor learns your course</p>
        <p className="mt-1 text-muted">Transcripts and uploaded PDF/TXT/MD files are split into passages and embedded into a vector index. Students' questions are answered only from these passages, with citations. Add timestamps like <code className="rounded bg-surface px-1">[12:34]</code> in transcripts so citations jump to the right moment.</p>
      </div>
      {course.modules.map((m, mi) => (
        <Card key={m.id}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            <span className="text-xs font-semibold text-muted">MODULE {mi + 1}</span>
            {editModule?.id === m.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); renameModule.mutate(); }}><Input value={editModule.title} onChange={(e) => setEditModule({ ...editModule, title: e.target.value })} className="h-9" autoFocus /><Button size="sm" type="submit">Save</Button><Button size="sm" variant="ghost" onClick={() => setEditModule(null)}>Cancel</Button></form>
            ) : <p className="flex-1 font-semibold">{m.title}</p>}
            <div className="flex gap-1">
              <IconBtn label="Move up" onClick={() => { const ids = move(course.modules, mi, -1); if (ids) reorderModules.mutate(ids); }}><ArrowUp className="h-4 w-4" /></IconBtn>
              <IconBtn label="Move down" onClick={() => { const ids = move(course.modules, mi, 1); if (ids) reorderModules.mutate(ids); }}><ArrowDown className="h-4 w-4" /></IconBtn>
              <IconBtn label="Rename" onClick={() => setEditModule({ id: m.id, title: m.title })}><Pencil className="h-4 w-4" /></IconBtn>
              <IconBtn label="Delete module" danger onClick={() => setConfirm({ kind: 'module', id: m.id, title: m.title })}><Trash2 className="h-4 w-4" /></IconBtn>
            </div>
          </div>
          <ul className="divide-y divide-border">
            {m.lectures.map((l, li) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Film className="h-4 w-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{l.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{duration(l.duration_seconds)}</span>{!l.has_video && <Badge tone="warning">No video</Badge>}
                    {l.resource_count > 0 && <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{l.resource_count} file{l.resource_count > 1 ? 's' : ''}</span>}
                    {ingestBadge(l.ingest_status)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <IconBtn label="Move up" onClick={() => { const ids = move(m.lectures, li, -1); if (ids) reorderLectures.mutate({ moduleId: m.id, ids }); }}><ArrowUp className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Move down" onClick={() => { const ids = move(m.lectures, li, 1); if (ids) reorderLectures.mutate({ moduleId: m.id, ids }); }}><ArrowDown className="h-4 w-4" /></IconBtn>
                  {(l.has_transcript || l.resource_count > 0) && <IconBtn label="Re-index for AI" onClick={() => reindex.mutate(l.id)}><RefreshCw className="h-4 w-4" /></IconBtn>}
                  <Link to={`/app/learn/${course.id}/${l.id}`}><IconBtn label="Preview"><Eye className="h-4 w-4" /></IconBtn></Link>
                  <IconBtn label="Edit lecture" onClick={() => setLectureModal({ moduleId: m.id, lectureId: l.id })}><Pencil className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Delete lecture" danger onClick={() => setConfirm({ kind: 'lecture', id: l.id, title: l.title })}><Trash2 className="h-4 w-4" /></IconBtn>
                </div>
              </li>
            ))}
            {!m.lectures.length && <li className="px-5 py-4 text-sm text-muted">No lectures in this module yet.</li>}
          </ul>
          <div className="border-t border-border px-5 py-3"><Button variant="ghost" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setLectureModal({ moduleId: m.id })}>Add lecture</Button></div>
        </Card>
      ))}
      <Card className="flex flex-col gap-2 p-4 sm:flex-row">
        <Input value={newModule} onChange={(e) => setNewModule(e.target.value)} placeholder={course.modules.length ? 'New module title' : 'Start with your first module, e.g. “Foundations”'} onKeyDown={(e) => e.key === 'Enter' && newModule.trim().length >= 2 && addModule.mutate()} />
        <Button onClick={() => addModule.mutate()} loading={addModule.isPending} disabled={newModule.trim().length < 2} icon={<Plus className="h-4 w-4" />}>Add module</Button>
      </Card>
      {lectureModal && <LectureModal courseId={course.id} {...lectureModal} onClose={() => setLectureModal(null)} onSaved={() => { setLectureModal(null); refresh(); }} />}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => remove.mutate()} loading={remove.isPending} danger
        title={`Delete ${confirm?.kind}?`} message={`“${confirm?.title}” ${confirm?.kind === 'module' ? 'and all its lectures and quizzes' : ''} will be permanently deleted.`} confirmLabel="Delete" />
    </div>
  );
}

function IconBtn({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
  return <button type="button" onClick={onClick} title={label} aria-label={label} className={clsx('rounded-lg p-1.5 text-muted transition hover:bg-surface-2', danger ? 'hover:text-rose-600' : 'hover:text-ink')}>{children}</button>;
}

function LectureModal({ courseId, moduleId, lectureId, onClose, onSaved }: { courseId: string; moduleId: string; lectureId?: string; onClose: () => void; onSaved: () => void }) {
  const existing = useQuery({ queryKey: ['lecture', lectureId], enabled: !!lectureId, queryFn: async () => (await api.get(`/lectures/${lectureId}`)).data.lecture as any });
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [durationS, setDurationS] = useState('');
  const [videoMode, setVideoMode] = useState<'upload' | 'url'>('upload');
  const [videoUrl, setVideoUrl] = useState('');
  const [video, setVideo] = useState<File | null>(null);
  const [resources, setResources] = useState<File[]>([]);
  const [removeRes, setRemoveRes] = useState<string[]>([]);
  const [removeVideo, setRemoveVideo] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (existing.data) {
      setTitle(existing.data.title);
      setTranscript(existing.data.transcript ?? '');
      setDurationS(existing.data.duration_seconds ? String(existing.data.duration_seconds) : '');
      if (existing.data.video_url && !existing.data.video_url.startsWith('/api/')) { setVideoMode('url'); setVideoUrl(existing.data.video_url); }
    }
  }, [existing.data]);

  // Read the video's duration in the browser so the instructor doesn't have to type it.
  const pickVideo = (f: File | null) => {
    setVideo(f);
    if (!f) return;
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => { if (isFinite(el.duration)) setDurationS(String(Math.round(el.duration))); URL.revokeObjectURL(el.src); };
    el.src = URL.createObjectURL(f);
  };

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('transcript', transcript);
      if (durationS) fd.append('duration_seconds', durationS);
      if (videoMode === 'upload' && video) fd.append('video', video);
      if (videoMode === 'url') fd.append('video_url', videoUrl);
      if (removeVideo) fd.append('remove_video', 'true');
      resources.forEach((r) => fd.append('resources', r));
      if (removeRes.length) fd.append('remove_resources', JSON.stringify(removeRes));
      const cfg = { onUploadProgress: (e: any) => e.total && setProgress(Math.round((e.loaded / e.total) * 100)), timeout: 0 };
      return lectureId ? api.put(`/lectures/${lectureId}`, fd, cfg) : api.post(`/modules/${moduleId}/lectures`, fd, cfg);
    },
    onSuccess: () => { toast.success(lectureId ? 'Lecture updated' : 'Lecture added — indexing for the AI tutor'); onSaved(); },
    onError: (e) => { setProgress(0); toast.error(errMsg(e)); },
  });
  void courseId;

  return (
    <Modal open onClose={onClose} title={lectureId ? 'Edit lecture' : 'Add lecture'} size="lg"
      footer={<><Button variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={title.trim().length < 2}>{save.isPending && progress > 0 && progress < 100 ? `Uploading ${progress}%` : 'Save lecture'}</Button></>}>
      {lectureId && existing.isLoading ? <Skeleton className="h-60" /> : (
        <div className="space-y-5">
          <Field label="Lecture title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sorting Algorithms – Part 2: Quicksort" maxLength={200} /></Field>
          <div>
            <div className="mb-2 flex items-center justify-between"><span className="label mb-0">Video</span>
              <div className="flex gap-1 text-xs">{(['upload', 'url'] as const).map((m) => <button key={m} type="button" onClick={() => setVideoMode(m)} className={clsx('rounded-lg px-2.5 py-1 font-medium', videoMode === m ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-muted')}>{m === 'upload' ? 'Upload file' : 'Video URL'}</button>)}</div>
            </div>
            {videoMode === 'upload' ? (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-5 transition hover:border-brand-300">
                <Upload className="h-5 w-5 text-muted" />
                <span className="flex-1 text-sm">{video ? `${video.name} (${(video.size / 1048576).toFixed(1)} MB)` : existing.data?.video_url ? 'Replace the current video (MP4, WebM, MOV)' : 'Choose a video file (MP4, WebM, MOV — up to 500 MB)'}</span>
                <input type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" className="hidden" onChange={(e) => pickVideo(e.target.files?.[0] ?? null)} />
              </label>
            ) : <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://… .mp4" />}
            {existing.data?.video_url && <label className="mt-2 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={removeVideo} onChange={(e) => setRemoveVideo(e.target.checked)} className="accent-brand-600" />Remove the current video</label>}
          </div>
          <Field label="Duration (seconds)" hint="Filled in automatically when you choose a video file."><Input type="number" min={0} value={durationS} onChange={(e) => setDurationS(e.target.value)} className="sm:w-40" /></Field>
          <Field label="Transcript" hint="Used by the AI tutor, summaries and quiz generation. Optional [mm:ss] timestamps make citations clickable.">
            <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} className="min-h-[160px] font-mono text-xs" placeholder={'[00:00] Welcome to this lecture…\n[01:30] The key idea is…'} />
          </Field>
          <div>
            <p className="label">Resources (PDF, slides, notes)</p>
            {existing.data?.resources?.length > 0 && (
              <ul className="mb-2 space-y-1.5">{existing.data.resources.map((r: any) => (
                <li key={r.key} className={clsx('flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm', removeRes.includes(r.key) && 'opacity-50 line-through')}>
                  <FileText className="h-4 w-4 text-rose-500" /><span className="flex-1 truncate">{r.name}</span>
                  <button type="button" className="text-xs text-muted hover:text-rose-600" onClick={() => setRemoveRes(removeRes.includes(r.key) ? removeRes.filter((x) => x !== r.key) : [...removeRes, r.key])}>{removeRes.includes(r.key) ? 'Undo' : 'Remove'}</button>
                </li>
              ))}</ul>
            )}
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-4 transition hover:border-brand-300">
              <FileText className="h-5 w-5 text-muted" /><span className="text-sm">Add files — PDF, PPT(X), DOC(X), TXT, MD</span>
              <input type="file" multiple accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.md" className="hidden" onChange={(e) => setResources([...resources, ...Array.from(e.target.files ?? [])])} />
            </label>
            {resources.length > 0 && <ul className="mt-2 space-y-1">{resources.map((r, i) => <li key={i} className="flex items-center gap-2 text-sm"><FileText className="h-3.5 w-3.5" />{r.name}<button type="button" onClick={() => setResources(resources.filter((_, k) => k !== i))} aria-label="Remove"><X className="h-3.5 w-3.5 text-muted" /></button></li>)}</ul>}
            <p className="mt-1.5 text-xs text-muted">PDF, TXT and MD text is indexed for the AI tutor. Other formats are downloadable only.</p>
          </div>
          {save.isPending && progress > 0 && <ProgressBar value={progress} />}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function QuizzesTab({ course }: { course: CourseDetail }) {
  const nav = useNavigate();
  const quizzes = useQuery({ queryKey: ['course-quizzes', course.id], queryFn: async () => (await api.get(`/courses/${course.id}/quizzes`)).data.data as any[] });
  const lectures = course.modules.flatMap((m) => m.lectures.map((l) => ({ ...l, module: m.title })));
  const [gen, setGen] = useState({ lecture: lectures.find((l) => l.has_transcript)?.id ?? lectures[0]?.id ?? '', n: '6', difficulty: 'intermediate' });
  const generate = useMutation({
    mutationFn: async () => (await api.post(`/ai/lectures/${gen.lecture}/generate-quiz`, { num_questions: Number(gen.n), difficulty: gen.difficulty })).data,
    onSuccess: (q) => { toast.success(q.is_demo ? 'Demo quiz draft created (no API key)' : 'AI quiz draft created — review it before publishing'); nav(`/instructor/quizzes/${q.id}`); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div>
        <div className="mb-4 flex justify-end"><Link to={`/instructor/quizzes/new?course=${course.id}`}><Button icon={<Plus className="h-4 w-4" />} disabled={!course.modules.length}>New quiz</Button></Link></div>
        {quizzes.isLoading ? <Skeleton className="h-40" /> : !quizzes.data?.length ? <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No quizzes yet" description="Build one manually or let AI draft one from a lecture transcript." /> : (
          <Card className="divide-y divide-border">
            {quizzes.data.map((q) => (
              <Link key={q.id} to={`/instructor/quizzes/${q.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 transition hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{q.title}</p>
                  <p className="text-xs text-muted">{q.module_title} · {q.question_count} questions · {q.attempt_count} attempts{q.avg_score != null && ` · avg ${Math.round(q.avg_score)}%`}</p>
                </div>
                {q.is_ai_generated && <Badge tone="brand"><Sparkles className="h-3 w-3" />AI</Badge>}
                <Badge tone={statusTone(q.status)} className="capitalize">{q.status === 'draft' ? 'Draft — needs review' : q.status}</Badge>
              </Link>
            ))}
          </Card>
        )}
      </div>
      <Card className="h-fit p-5">
        <p className="flex items-center gap-2 font-semibold"><Wand2 className="h-4 w-4 text-brand-600" />Generate with AI</p>
        <p className="mt-1 text-sm text-muted">Creates a 3–10 question draft from a lecture's transcript. Nothing is shown to students until you review and publish it.</p>
        <div className="mt-4 space-y-3">
          <Field label="Lecture"><Select value={gen.lecture} onChange={(e) => setGen({ ...gen, lecture: e.target.value })}>{lectures.map((l) => <option key={l.id} value={l.id}>{l.title}{!l.has_transcript ? ' (no transcript)' : ''}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Questions"><Select value={gen.n} onChange={(e) => setGen({ ...gen, n: e.target.value })}>{[3, 5, 6, 8, 10].map((n) => <option key={n}>{n}</option>)}</Select></Field>
            <Field label="Difficulty"><Select value={gen.difficulty} onChange={(e) => setGen({ ...gen, difficulty: e.target.value })}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></Select></Field>
          </div>
          <Button className="w-full" onClick={() => generate.mutate()} loading={generate.isPending} disabled={!gen.lecture} icon={<Sparkles className="h-4 w-4" />}>{generate.isPending ? 'Generating…' : 'Generate draft'}</Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
interface AssignmentForm { id?: string; title: string; instructions: string; due: string; rubric: { criterion: string; points: string }[] }
const emptyAssignment = (): AssignmentForm => ({ title: '', instructions: '', due: '', rubric: [{ criterion: 'Correctness', points: '60' }, { criterion: 'Code quality', points: '25' }, { criterion: 'Write-up', points: '15' }] });
const toLocalInput = (d?: string | null) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

function AssignmentsTab({ course }: { course: CourseDetail }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['course-assignments', course.id], queryFn: async () => (await api.get(`/courses/${course.id}/assignments`)).data.data as any[] });
  const [form, setForm] = useState<AssignmentForm | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['course-assignments', course.id] });
  const save = useMutation({
    mutationFn: async (): Promise<unknown> => {
      const body = { title: form!.title, instructions: form!.instructions, due_date: form!.due ? new Date(form!.due).toISOString() : null, rubric: form!.rubric.filter((r) => r.criterion.trim()).map((r) => ({ criterion: r.criterion, points: Number(r.points) || 0 })), max_score: form!.rubric.reduce((s, r) => s + (Number(r.points) || 0), 0) || 100 };
      return form!.id ? api.put(`/assignments/${form!.id}`, body) : api.post('/assignments', { ...body, course_id: course.id });
    },
    onSuccess: () => { toast.success(form?.id ? 'Assignment updated' : 'Assignment created — students were notified'); setForm(null); refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const remove = useMutation({ mutationFn: () => api.delete(`/assignments/${del}`), onSuccess: () => { setDel(null); refresh(); } });
  const total = form?.rubric.reduce((s, r) => s + (Number(r.points) || 0), 0) ?? 0;

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm(emptyAssignment())}>New assignment</Button></div>
      {list.isLoading ? <Skeleton className="h-40" /> : !list.data?.length ? <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No assignments yet" description="Create an assignment with a rubric and a deadline." /> : (
        <Card className="divide-y divide-border">
          {list.data.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1"><p className="font-medium">{a.title}</p><p className="text-xs text-muted">Due {a.due_date ? dateTime(a.due_date) : 'never'} · {a.max_score} pts · {a.submission_count} submissions</p></div>
              {a.ungraded_count > 0 && <Link to={`/instructor/grading?assignment=${a.id}`}><Badge tone="warning">{a.ungraded_count} to grade</Badge></Link>}
              <Link to={`/instructor/grading?assignment=${a.id}&status=all`}><Button variant="ghost" size="sm" icon={<Users className="h-4 w-4" />}>Submissions</Button></Link>
              <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setForm({ id: a.id, title: a.title, instructions: a.instructions ?? '', due: toLocalInput(a.due_date), rubric: (a.rubric ?? []).map((r: any) => ({ criterion: r.criterion, points: String(r.points) })) })}>Edit</Button>
              <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDel(a.id)}>Delete</Button>
            </div>
          ))}
        </Card>
      )}
      {form && (
        <Modal open onClose={() => setForm(null)} title={form.id ? 'Edit assignment' : 'New assignment'} size="lg" footer={<><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={form.title.trim().length < 3}>Save</Button></>}>
          <div className="space-y-4">
            <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} /></Field>
            <Field label="Instructions"><Textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className="min-h-[140px]" /></Field>
            <Field label="Deadline" hint="Submissions are rejected after this time."><Input type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} className="sm:w-64" /></Field>
            <div>
              <p className="label">Rubric <span className="font-normal text-muted">— total {total} points</span></p>
              <div className="space-y-2">{form.rubric.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={r.criterion} onChange={(e) => setForm({ ...form, rubric: form.rubric.map((x, k) => (k === i ? { ...x, criterion: e.target.value } : x)) })} placeholder="Criterion" />
                  <Input type="number" min={0} value={r.points} onChange={(e) => setForm({ ...form, rubric: form.rubric.map((x, k) => (k === i ? { ...x, points: e.target.value } : x)) })} className="w-24" aria-label="Points" />
                  <IconBtn label="Remove criterion" danger onClick={() => setForm({ ...form, rubric: form.rubric.filter((_, k) => k !== i) })}><X className="h-4 w-4" /></IconBtn>
                </div>
              ))}</div>
              <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...form, rubric: [...form.rubric, { criterion: '', points: '10' }] })}>Add criterion</Button>
            </div>
          </div>
        </Modal>
      )}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => remove.mutate()} danger title="Delete assignment?" message="All submissions and grades for it will be deleted." confirmLabel="Delete" loading={remove.isPending} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function AnnouncementsTab({ course }: { course: CourseDetail }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['announcements', course.id], queryFn: async () => (await api.get(`/courses/${course.id}/announcements`)).data.data as any[] });
  const [form, setForm] = useState({ title: '', content: '', email: true });
  const post = useMutation({ mutationFn: async () => (await api.post(`/courses/${course.id}/announcements`, form)).data, onSuccess: (a) => { toast.success(`Announcement sent to ${a.notified} student(s)`); setForm({ title: '', content: '', email: true }); qc.invalidateQueries({ queryKey: ['announcements', course.id] }); }, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/announcements/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements', course.id] }) });
  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      <Card className="h-fit p-5">
        <p className="mb-4 flex items-center gap-2 font-semibold"><Megaphone className="h-4 w-4 text-brand-600" />New announcement</p>
        <div className="space-y-3">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} /></Field>
          <Field label="Message"><Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="min-h-[120px]" /></Field>
          <label className="flex items-center justify-between text-sm"><span>Also send by email</span><Toggle checked={form.email} onChange={(v) => setForm({ ...form, email: v })} label="Send email" /></label>
          <Button className="w-full" onClick={() => post.mutate()} loading={post.isPending} disabled={form.title.trim().length < 3 || !form.content.trim()} icon={<Send className="h-4 w-4" />}>Post to {course.enrollment_count} student(s)</Button>
        </div>
      </Card>
      <div className="space-y-3">
        {list.isLoading ? <Skeleton className="h-40" /> : !list.data?.length ? <EmptyState icon={<Megaphone className="h-6 w-6" />} title="No announcements yet" /> : list.data.map((a) => (
          <Card key={a.id} className="p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{a.title}</p><p className="text-xs text-muted">{timeAgo(a.created_at)} · {a.author}</p></div><IconBtn label="Delete" danger onClick={() => del.mutate(a.id)}><Trash2 className="h-4 w-4" /></IconBtn></div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{a.content}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DiscussionsTab({ course, threadId }: { course: CourseDetail; threadId: string | null }) {
  const flagged = useQuery({ queryKey: ['instructor-flagged'], queryFn: async () => (await api.get('/instructor/flagged-posts')).data.data as any[] });
  const mine = flagged.data?.filter((f) => f.course_id === course.id) ?? [];
  if (threadId) return <ThreadPanel threadId={threadId} backTo={`/instructor/courses/${course.id}?tab=discussions`} />;
  return (
    <div className="space-y-5">
      {mine.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-500/30 dark:bg-rose-500/10">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-rose-800 dark:text-rose-200"><AlertTriangle className="h-4 w-4" />{mine.length} reported post(s) need moderation</p>
          <ul className="space-y-1">{mine.map((f) => <li key={f.id}><Link to={`/instructor/courses/${course.id}?tab=discussions&thread=${f.thread_id}`} className="text-sm text-rose-700 underline dark:text-rose-300">“{f.content.slice(0, 80)}” — {f.flag_reason}</Link></li>)}</ul>
        </div>
      )}
      <ThreadList courseId={course.id} basePath={`/app/discussions/${course.id}`} />
      <p className="flex items-center gap-1 text-xs text-muted"><MessagesSquare className="h-3 w-3" />As the instructor you can hide, delete or dismiss reports on any post in this course.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function CourseAnalyticsPanel({ courseId }: { courseId: string }) {
  const q = useQuery({ queryKey: ['course-analytics', courseId], queryFn: async () => (await api.get(`/instructor/courses/${courseId}/analytics`)).data as any });
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState message={errMsg(q.error)} />;
  const { total_students, lectures, quizzes, topics, students } = q.data;
  const short = (s: string) => (s.length > 26 ? `${s.slice(0, 26)}…` : s);
  return (
    <div className="space-y-6">
      {total_students === 0 && <div className="rounded-2xl border border-border bg-surface-2 p-4 text-sm text-muted">No students yet — analytics fill in as students enroll and learn.</div>}
      <Card>
        <CardHeader title="Lecture drop-off" subtitle={`% of ${total_students} enrolled students who completed each lecture`} icon={<BarChart3 className="h-5 w-5" />} />
        <div className="p-5 pt-3"><Bars data={lectures.map((l: any) => ({ name: short(l.title), completion: l.completion_rate, watched: l.avg_watch_percent }))} x="name" series={[{ key: 'completion', name: 'Completed %' }, { key: 'watched', name: 'Avg watched %' }]} height={280} format={(v) => `${v}%`} /></div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Quiz performance" subtitle="Average score per quiz" />
          <div className="p-5 pt-3">{quizzes.length ? <Bars layout="vertical" data={quizzes.map((x: any) => ({ name: short(x.title), avg: x.avg_score ?? 0 }))} x="name" series={[{ key: 'avg', name: 'Avg score %' }]} height={Math.max(160, quizzes.length * 48)} format={(v) => `${v}%`} /> : <p className="py-10 text-center text-sm text-muted">No quizzes yet.</p>}</div>
        </Card>
        <Card>
          <CardHeader title="Where students struggle" subtitle="Topic mastery and AI tutor questions per module" />
          <div className="space-y-4 p-5">
            {topics.map((t: any) => (
              <div key={t.id}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{t.title}</span><span className="text-muted">{t.avg_mastery != null ? `${Math.round(t.avg_mastery)}% mastery` : 'no quiz data'} · {t.ai_questions} AI questions</span></div>
                <ProgressBar value={t.avg_mastery ?? 0} size="sm" />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Time on task" subtitle="Average time students spend per lecture" />
        <div className="overflow-x-auto p-2">
          <table className="w-full min-w-[560px]">
            <thead><tr><th className="table-th">Lecture</th><th className="table-th">Length</th><th className="table-th">Started</th><th className="table-th">Completed</th><th className="table-th">Avg. time</th></tr></thead>
            <tbody className="divide-y divide-border">{lectures.map((l: any) => (
              <tr key={l.id}><td className="table-td"><p className="font-medium">{l.title}</p><p className="text-xs text-muted">{l.module_title}</p></td><td className="table-td">{duration(l.duration_seconds)}</td><td className="table-td">{l.started}</td><td className="table-td">{l.completed} ({l.completion_rate}%)</td><td className="table-td">{clock(l.avg_time_seconds)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHeader title="Students" subtitle={`${students.length} enrolled`} />
        <div className="overflow-x-auto p-2">
          <table className="w-full min-w-[640px]">
            <thead><tr><th className="table-th">Student</th><th className="table-th">Progress</th><th className="table-th">Quiz avg.</th><th className="table-th">Time spent</th><th className="table-th">Last active</th></tr></thead>
            <tbody className="divide-y divide-border">{students.map((s: any) => (
              <tr key={s.id}>
                <td className="table-td"><p className="font-medium">{s.full_name}</p><p className="text-xs text-muted">{s.email}</p></td>
                <td className="table-td"><div className="flex items-center gap-2"><ProgressBar value={s.progress_percent} size="sm" className="w-24" /><span className="text-xs">{Math.round(s.progress_percent)}%</span>{s.completed_at && <Badge tone="success">Done</Badge>}</div></td>
                <td className="table-td">{s.avg_quiz != null ? `${Math.round(s.avg_quiz)}%` : '—'}</td>
                <td className="table-td">{duration(s.time_spent_seconds)}</td>
                <td className="table-td text-muted">{s.last_active_at ? timeAgo(s.last_active_at) : `enrolled ${date(s.enrolled_at)}`}</td>
              </tr>
            ))}</tbody>
          </table>
          {!students.length && <p className="py-8 text-center text-sm text-muted">No students yet.</p>}
        </div>
      </Card>
    </div>
  );
}
