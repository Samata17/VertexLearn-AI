import clsx from 'clsx';
import { BarChart3, BookOpen, Brain, Code2, Cpu, Database, Palette, PlayCircle, Star, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CourseCard as Course } from '@/types';
import { compact, duration, money } from '@/utils/format';
import { Avatar, Badge } from './ui';

const THEMES: Record<string, { from: string; to: string; icon: typeof BookOpen }> = {
  'Computer Science': { from: '#6D28D9', to: '#312E81', icon: Cpu },
  'Data Science': { from: '#0EA5E9', to: '#1E3A8A', icon: Database },
  'AI & Machine Learning': { from: '#A855F7', to: '#4C1D95', icon: Brain },
  'Web Development': { from: '#14B8A6', to: '#134E4A', icon: Code2 },
  Design: { from: '#F472B6', to: '#7C3AED', icon: Palette },
  Business: { from: '#F59E0B', to: '#B45309', icon: BarChart3 },
};

/** Generated course artwork when no thumbnail was uploaded (no external images needed). */
/** `minimal` drops the title text for small thumbnails (where it would be clipped). */
export function CourseThumb({ course, className, showPlay, minimal }: { course: Pick<Course, 'title' | 'category' | 'thumbnail_url'>; className?: string; showPlay?: boolean; minimal?: boolean }) {
  if (course.thumbnail_url) {
    return <img src={course.thumbnail_url} alt="" className={clsx('aspect-video w-full object-cover', className)} />;
  }
  const t = THEMES[course.category ?? ''] ?? { from: '#7C3AED', to: '#1B1A4A', icon: BookOpen };
  const Icon = t.icon;
  return (
    <div className={clsx('relative aspect-video w-full overflow-hidden', className)} style={{ background: `linear-gradient(135deg, ${t.from}, ${t.to})` }} aria-hidden>
      <svg className="absolute inset-0 h-full w-full opacity-[0.18]" viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice">
        <defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="white" /></pattern></defs>
        <rect width="400" height="225" fill="url(#dots)" />
        <circle cx="340" cy="40" r="90" fill="white" opacity="0.25" />
        <circle cx="40" cy="220" r="70" fill="white" opacity="0.15" />
      </svg>
      {minimal ? (
        <div className="absolute inset-0 grid place-items-center text-white"><Icon className="h-7 w-7 opacity-90" strokeWidth={1.6} /></div>
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between p-4 text-white">
          <Icon className="h-8 w-8 opacity-90" strokeWidth={1.6} />
          <p className="line-clamp-2 max-w-[85%] text-sm font-semibold leading-snug drop-shadow-sm">{course.title}</p>
        </div>
      )}
      {showPlay && <PlayCircle className="absolute right-4 top-4 h-7 w-7 text-white/80" />}
    </div>
  );
}

export function Stars({ value, size = 14, className }: { value: number; size?: number; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center', className)} aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: size, height: size }} className={i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-border'} />
      ))}
    </span>
  );
}

export const difficultyTone = (d: string) => (d === 'beginner' ? 'success' : d === 'intermediate' ? 'info' : 'brand') as 'success' | 'info' | 'brand';

export function CourseCard({ course, to }: { course: Course; to?: string }) {
  return (
    <Link to={to ?? `/courses/${course.id}`} className="group card flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className="overflow-hidden"><CourseThumb course={course} className="transition duration-500 group-hover:scale-[1.03]" /></div>
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{course.category}</Badge>
          <Badge tone={difficultyTone(course.difficulty)} className="capitalize">{course.difficulty}</Badge>
        </div>
        <h3 className="line-clamp-2 font-semibold leading-snug group-hover:text-brand-700 dark:group-hover:text-brand-300">{course.title}</h3>
        {course.instructor && (
          <div className="mt-2 flex items-center gap-2 text-sm text-muted">
            <Avatar name={course.instructor.full_name} src={course.instructor.avatar_url} size={22} />
            {course.instructor.full_name}
          </div>
        )}
        <div className="mt-3 flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1"><Stars value={course.rating} size={12} /> <b className="text-ink">{course.rating ? course.rating.toFixed(1) : 'New'}</b>{course.review_count > 0 && ` (${course.review_count})`}</span>
          <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{compact(course.enrollment_count)}</span>
        </div>
        <div className="mt-auto flex items-center justify-between border-t border-border pt-3 mt-4 text-sm">
          <span className="text-muted">{course.lecture_count} lectures · {duration(course.total_seconds)}</span>
          <span className="font-bold">{money(course.price)}</span>
        </div>
      </div>
    </Link>
  );
}
