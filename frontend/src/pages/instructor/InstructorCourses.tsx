import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CourseThumb } from '@/components/common/CourseVisuals';
import { Badge, Button, Card, CardsSkeleton, EmptyState, ErrorState, Field, Input, PageHeader, Select, Textarea, statusTone } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import type { CourseCard } from '@/types';
import { money } from '@/utils/format';

export const CATEGORIES = ['Computer Science', 'Data Science', 'AI & Machine Learning', 'Web Development', 'Design', 'Business'];

export function InstructorCourses() {
  const q = useQuery({ queryKey: ['instructor-courses'], queryFn: async () => (await api.get<{ data: CourseCard[] }>('/instructor/courses')).data.data });
  return (
    <div>
      <PageHeader title="My courses" subtitle="Create, edit and publish your courses. New courses are reviewed by an admin before going live."
        actions={<Link to="/instructor/courses/new"><Button icon={<Plus className="h-4 w-4" />}>Create course</Button></Link>} />
      {q.isLoading ? <CardsSkeleton count={3} /> : q.isError ? <ErrorState message={errMsg(q.error)} /> : !q.data?.length ? (
        <EmptyState icon={<Layers className="h-6 w-6" />} title="You haven't created a course yet" description="Start with a title and description — you can add modules, lectures and quizzes next." action={<Link to="/instructor/courses/new"><Button>Create your first course</Button></Link>} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.map((c) => (
            <Link key={c.id} to={`/instructor/courses/${c.id}`} className="card group flex flex-col overflow-hidden transition hover:shadow-lift">
              <div className="relative"><CourseThumb course={c} /><Badge tone={statusTone(c.status)} className="absolute left-3 top-3 capitalize shadow">{c.status}</Badge></div>
              <div className="flex flex-1 flex-col p-4">
                <p className="line-clamp-2 font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-300">{c.title}</p>
                <p className="mt-1 text-sm text-muted">{c.category} · <span className="capitalize">{c.difficulty}</span></p>
                <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-sm mt-4">
                  <span className="flex items-center gap-1 text-muted"><Users className="h-4 w-4" />{c.enrollment_count} · {c.module_count} modules · {c.lecture_count} lectures</span>
                  <span className="font-semibold">{money(c.price)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export interface CourseFormValue { title: string; description: string; category: string; difficulty: string; price: string; learning_outcomes: string[] }

export function CourseForm({ value, onChange }: { value: CourseFormValue; onChange: (v: CourseFormValue) => void }) {
  const [outcome, setOutcome] = useState('');
  const set = (k: keyof CourseFormValue, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-5">
      <Field label="Course title"><Input value={value.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Data Structures & Algorithms Masterclass" maxLength={200} /></Field>
      <Field label="Description"><Textarea value={value.description} onChange={(e) => set('description', e.target.value)} placeholder="What will students learn and who is it for?" className="min-h-[120px]" maxLength={5000} /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Category"><Select value={value.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Difficulty"><Select value={value.difficulty} onChange={(e) => set('difficulty', e.target.value)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></Select></Field>
        <Field label="Price (₹)" hint="0 = free"><Input type="number" min={0} step={1} value={value.price} onChange={(e) => set('price', e.target.value)} /></Field>
      </div>
      <Field label="Learning outcomes" hint="Up to 12 short statements shown on the course page.">
        <div className="flex gap-2"><Input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Implement quicksort and explain its worst case" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (outcome.trim()) { set('learning_outcomes', [...value.learning_outcomes, outcome.trim()].slice(0, 12)); setOutcome(''); } } }} />
          <Button type="button" variant="outline" onClick={() => { if (outcome.trim()) { set('learning_outcomes', [...value.learning_outcomes, outcome.trim()].slice(0, 12)); setOutcome(''); } }}>Add</Button></div>
        <ul className="mt-3 space-y-2">{value.learning_outcomes.map((o, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"><span className="flex-1">{o}</span><button type="button" onClick={() => set('learning_outcomes', value.learning_outcomes.filter((_, k) => k !== i))} aria-label="Remove"><X className="h-4 w-4 text-muted" /></button></li>
        ))}</ul>
      </Field>
    </div>
  );
}

export function CourseCreate() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [v, setV] = useState<CourseFormValue>({ title: '', description: '', category: CATEGORIES[0], difficulty: 'beginner', price: '0', learning_outcomes: [] });
  const m = useMutation({
    mutationFn: async () => (await api.post('/courses', { ...v, price: Number(v.price) || 0 })).data,
    onSuccess: (c) => { toast.success('Course created — now add modules and lectures.'); qc.invalidateQueries({ queryKey: ['instructor-courses'] }); nav(`/instructor/courses/${c.id}?tab=curriculum`); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Create a course" subtitle="Your course is submitted for admin review right away; you can keep adding content while it's pending." />
      <Card className="p-6">
        <CourseForm value={v} onChange={setV} />
        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-5">
          <Link to="/instructor/courses"><Button variant="outline">Cancel</Button></Link>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={v.title.trim().length < 3}>Create course</Button>
        </div>
      </Card>
    </div>
  );
}
