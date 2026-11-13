import { useQuery } from '@tanstack/react-query';
import { Award, GraduationCap, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CourseThumb } from '@/components/common/CourseVisuals';
import { Badge, Button, CardsSkeleton, EmptyState, ErrorState, PageHeader, ProgressBar, Segmented } from '@/components/common/ui';
import { api, errMsg } from '@/services/api';
import type { Enrollment } from '@/types';
import { timeAgo } from '@/utils/format';

export function MyLearning() {
  const [filter, setFilter] = useState<'all' | 'progress' | 'completed'>('all');
  const q = useQuery({ queryKey: ['enrollments'], queryFn: async () => (await api.get<{ data: Enrollment[] }>('/enrollments/me')).data.data });
  const list = (q.data ?? []).filter((e) => filter === 'all' || (filter === 'completed' ? !!e.completed_at : !e.completed_at));
  return (
    <div>
      <PageHeader title="My learning" subtitle="All the courses you're enrolled in." actions={<Link to="/courses"><Button variant="outline">Browse more courses</Button></Link>} />
      <div className="mb-5"><Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: `All (${q.data?.length ?? 0})` }, { value: 'progress', label: 'In progress' }, { value: 'completed', label: 'Completed' }]} /></div>
      {q.isLoading ? <CardsSkeleton count={3} /> : q.isError ? <ErrorState message={errMsg(q.error)} onRetry={() => q.refetch()} /> : !list.length ? (
        <EmptyState icon={<GraduationCap className="h-6 w-6" />} title={filter === 'completed' ? 'No completed courses yet' : 'No courses here yet'} description="Courses you enroll in appear here with your progress." action={<Link to="/courses"><Button>Find a course</Button></Link>} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => (
            <div key={e.id} className="card flex flex-col overflow-hidden">
              <Link to={`/app/learn/${e.course_id}/${e.last_lecture_id ?? e.next_lecture?.id ?? ''}`} className="relative block">
                <CourseThumb course={{ title: e.title, category: e.category, thumbnail_url: e.thumbnail_url }} />
                {e.completed_at && <Badge tone="success" className="absolute left-3 top-3 shadow">Completed</Badge>}
              </Link>
              <div className="flex flex-1 flex-col p-4">
                <p className="line-clamp-2 font-semibold">{e.title}</p>
                <p className="text-sm text-muted">{e.instructor_name}</p>
                <div className="mt-3 flex items-center gap-3"><ProgressBar value={e.progress_percent} className="flex-1" /><span className="text-xs font-semibold">{Math.round(e.progress_percent)}%</span></div>
                <p className="mt-1 text-xs text-muted">{e.completed_count}/{e.lecture_count} lectures{e.last_activity_at && ` · active ${timeAgo(e.last_activity_at)}`}</p>
                <div className="mt-auto flex gap-2 pt-4">
                  <Link to={`/app/learn/${e.course_id}/${e.last_lecture_id ?? e.next_lecture?.id ?? ''}`} className="flex-1"><Button className="w-full" size="sm" icon={<PlayCircle className="h-4 w-4" />}>{e.completed_at ? 'Review' : Number(e.progress_percent) > 0 ? 'Continue' : 'Start'}</Button></Link>
                  {e.completed_at && <Link to="/app/achievements"><Button variant="secondary" size="sm" icon={<Award className="h-4 w-4" />}>Certificate</Button></Link>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
