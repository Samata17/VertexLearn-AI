import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CourseCard } from '@/components/common/CourseVisuals';
import { Button, CardsSkeleton, EmptyState, ErrorState, Input, Pagination, Select } from '@/components/common/ui';
import { useDebounce } from '@/hooks/useDebounce';
import { api, errMsg } from '@/services/api';
import type { CourseCard as Course, Paginated } from '@/types';

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

export function Catalog() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [showFilters, setShowFilters] = useState(false);
  const debounced = useDebounce(q);

  const filters = {
    q: params.get('q') ?? '',
    category: params.get('category') ?? '',
    difficulty: params.get('difficulty') ?? '',
    min_rating: params.get('min_rating') ?? '',
    price: params.get('price') ?? '',
    sort: params.get('sort') ?? 'popular',
    page: Number(params.get('page') ?? 1),
  };
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => { if (debounced !== filters.q) set('q', debounced); }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQ(params.get('q') ?? ''); }, [params.get('q')]); // eslint-disable-line react-hooks/exhaustive-deps

  const categories = useQuery({ queryKey: ['categories'], queryFn: async () => (await api.get<{ data: { name: string; count: number }[] }>('/courses/categories')).data.data });
  const courses = useQuery({
    queryKey: ['catalog', filters],
    queryFn: async () => {
      const p = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null));
      return (await api.get<Paginated<Course>>('/courses', { params: { ...p, limit: 9 } })).data;
    },
    placeholderData: keepPreviousData,
  });
  const active = ['category', 'difficulty', 'min_rating', 'price'].filter((k) => (filters as any)[k]);

  const FilterPanel = (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-semibold">Category</p>
        <div className="space-y-1">
          <button onClick={() => set('category', '')} className={clsx('flex w-full justify-between rounded-lg px-3 py-1.5 text-sm', !filters.category ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-muted hover:bg-surface-2')}>All categories</button>
          {categories.data?.map((c) => (
            <button key={c.name} onClick={() => set('category', c.name)} className={clsx('flex w-full justify-between rounded-lg px-3 py-1.5 text-sm', filters.category === c.name ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-muted hover:bg-surface-2')}>
              {c.name}<span className="text-xs">{c.count}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Difficulty</p>
        <div className="flex flex-wrap gap-2">
          {DIFFICULTIES.map((d) => (
            <button key={d} onClick={() => set('difficulty', filters.difficulty === d ? '' : d)} aria-pressed={filters.difficulty === d}
              className={clsx('rounded-full border px-3 py-1 text-xs font-medium capitalize transition', filters.difficulty === d ? 'border-brand-500 bg-brand-600 text-white' : 'border-border text-muted hover:border-brand-300')}>{d}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Rating</p>
        <div className="space-y-1">
          {[['', 'Any rating'], ['4.5', '4.5 & up'], ['4', '4.0 & up'], ['3', '3.0 & up']].map(([v, l]) => (
            <label key={v} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm text-muted">
              <input type="radio" name="rating" checked={filters.min_rating === v} onChange={() => set('min_rating', v)} className="accent-brand-600" />{l}
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Price</p>
        <Select value={filters.price} onChange={(e) => set('price', e.target.value)} aria-label="Price"><option value="">Any price</option><option value="free">Free</option><option value="paid">Paid</option></Select>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Explore courses</h1>
        <p className="mt-1 text-muted">Expert-led courses, each with an AI tutor that knows the material.</p>
      </div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, topic or instructor" className="h-11 pl-10" aria-label="Search courses" />
        </div>
        <div className="flex gap-2">
          <Select value={filters.sort} onChange={(e) => set('sort', e.target.value)} className="h-11 sm:w-48" aria-label="Sort by">
            <option value="popular">Most popular</option><option value="rating">Highest rated</option><option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
          </Select>
          <Button variant="outline" className="h-11 lg:hidden" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setShowFilters((s) => !s)}>Filters</Button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[230px_1fr]">
        <aside className={clsx('lg:block', showFilters ? 'block' : 'hidden')}><div className="card p-5 lg:sticky lg:top-24">{FilterPanel}</div></aside>
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
            {courses.data && <span>{courses.data.total} course{courses.data.total === 1 ? '' : 's'}</span>}
            {active.map((k) => (
              <button key={k} onClick={() => set(k, '')} className="chip bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                {k === 'min_rating' ? `${(filters as any)[k]}★+` : (filters as any)[k]}<X className="h-3 w-3" />
              </button>
            ))}
            {active.length > 0 && <button onClick={() => setParams(filters.q ? { q: filters.q } : {})} className="text-xs font-medium text-brand-600 hover:underline">Clear all</button>}
          </div>
          {courses.isLoading ? <CardsSkeleton /> : courses.isError ? <ErrorState message={errMsg(courses.error)} onRetry={() => courses.refetch()} /> : !courses.data?.data.length ? (
            <EmptyState icon={<Search className="h-6 w-6" />} title="No courses match your search" description="Try different keywords or remove some filters." action={<Button variant="outline" onClick={() => { setQ(''); setParams({}); }}>Reset filters</Button>} />
          ) : (
            <>
              <div className={clsx('grid gap-5 sm:grid-cols-2 xl:grid-cols-3 transition-opacity', courses.isFetching && 'opacity-60')}>
                {courses.data.data.map((c) => <CourseCard key={c.id} course={c} />)}
              </div>
              <Pagination page={courses.data.page} totalPages={courses.data.total_pages} onChange={(p) => set('page', String(p))} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
