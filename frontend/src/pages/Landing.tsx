import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BarChart3, BookOpenCheck, Brain, CheckCircle2, FileText, Flame, GraduationCap, Layers, MessageSquareQuote, ShieldCheck, Sparkles, Trophy, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CourseCard } from '@/components/common/CourseVisuals';
import { Button, Card, Skeleton } from '@/components/common/ui';
import { api } from '@/services/api';
import type { CourseCard as Course, Paginated } from '@/types';

export function Landing() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog', 'featured'],
    queryFn: async () => (await api.get<Paginated<Course>>('/courses', { params: { sort: 'popular', limit: 3 } })).data,
  });

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-300/40 via-brand-200/30 to-sky-200/30 blur-3xl dark:from-brand-700/25 dark:via-brand-900/20 dark:to-sky-900/20" />
        </div>
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-2 lg:pt-24">
          <div className="animate-fade-in">
            <span className="chip mb-5 border border-brand-200 bg-surface/70 text-brand-700 dark:border-brand-500/30 dark:text-brand-300"><Sparkles className="h-3.5 w-3.5" />AI tutor grounded in your course material</span>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Learn faster with a tutor that <span className="bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent">never sleeps.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              VertexLearn combines expert-led courses with an AI tutor that answers your questions in seconds — citing the exact lecture and timestamp it learned from.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register"><Button size="lg" icon={<ArrowRight className="h-4 w-4" />} className="flex-row-reverse">Start learning free</Button></Link>
              <Link to="/courses"><Button size="lg" variant="outline">Browse courses</Button></Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {['Answers with source citations', 'Beginner → advanced explanations', 'Certificates on completion'].map((t) => (
                <span key={t} className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-500" />{t}</span>
              ))}
            </div>
          </div>

          {/* Product preview */}
          <div id="tutor" className="relative animate-fade-in [animation-delay:120ms]">
            <Card className="overflow-hidden p-0 shadow-lift">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <div className="flex gap-1.5"><span className="h-3 w-3 rounded-full bg-rose-400" /><span className="h-3 w-3 rounded-full bg-amber-400" /><span className="h-3 w-3 rounded-full bg-emerald-400" /></div>
                <p className="ml-2 text-xs font-medium text-muted">AI Tutor · Data Structures & Algorithms</p>
                <span className="chip ml-auto bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">Intermediate</span>
              </div>
              <div className="space-y-4 p-5">
                <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white">Why does quicksort degrade to O(n²) on sorted input?</div>
                <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-surface-2 px-4 py-3 text-sm leading-relaxed">
                  When the pivot is always the first or last element, sorted input makes it the <b>smallest or largest</b> value every time. Each partition peels off just one element, so the recursion depth becomes <i>n</i> and the work adds up to n + (n−1) + … = <b>O(n²)</b> <span className="text-brand-600">[1]</span>.
                  <br /><br />A randomized or median-of-three pivot fixes this <span className="text-brand-600">[2]</span>.
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="chip border border-border bg-surface text-muted"><FileText className="h-3 w-3" />[1] Sorting Algorithms – Part 2 · 14:02</span>
                  <span className="chip border border-border bg-surface text-muted"><FileText className="h-3 w-3" />[2] Sorting Algorithms – Part 2 · 16:20</span>
                </div>
              </div>
            </Card>
            <Card className="absolute -bottom-6 -left-4 hidden w-56 p-4 shadow-lift sm:block">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-500 dark:bg-amber-500/15"><Flame className="h-5 w-5" /></div>
                <div><p className="text-xl font-bold">12 days</p><p className="text-xs text-muted">Learning streak</p></div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-border bg-surface py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold text-brand-600">Everything in one place</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">A complete learning platform, with AI built in</h2>
            <p className="mt-3 text-muted">Not a chatbot bolted on — the AI tutor knows exactly what's in each course and adapts to how well you're doing.</p>
          </div>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Brain, title: 'Course-grounded AI tutor', text: 'Answers come only from your course\'s lectures and documents, with citations you can click to jump to the moment in the video.' },
              { icon: Wand2, title: 'Summaries, quizzes & flashcards', text: 'Turn any lecture into key points, a practice quiz or a flashcard deck in one click.' },
              { icon: Layers, title: 'Adaptive explanations', text: 'Switch between beginner, intermediate and advanced explanations. The tutor adapts to your quiz mastery.' },
              { icon: BookOpenCheck, title: 'Real assessments', text: 'Multiple-choice, multi-select and short-answer quizzes with auto-grading, plus assignments with rubrics.' },
              { icon: Trophy, title: 'Streaks, badges & certificates', text: 'Stay motivated with streaks and leaderboards, and earn a verifiable PDF certificate for every course.' },
              { icon: BarChart3, title: 'Personal study plans', text: 'Get a week-by-week plan built from your weakest topics and unfinished lectures.' },
            ].map(({ icon: Icon, title, text }) => (
              <Card key={title} className="p-6" hover>
                <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300"><Icon className="h-5 w-5" /></div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted">{text}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Featured courses */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-brand-600">Popular right now</p>
              <h2 className="mt-1 text-3xl font-bold tracking-tight">Featured courses</h2>
            </div>
            <Link to="/courses" className="hidden text-sm font-semibold text-brand-600 hover:underline sm:block">View all courses →</Link>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {isLoading ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-80" />) : data?.data.map((c) => <CourseCard key={c.id} course={c} />)}
          </div>
        </div>
      </section>

      {/* For instructors */}
      <section id="instructors" className="pb-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid items-center gap-10 overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-navy-800 to-brand-900 p-8 text-white sm:p-12 lg:grid-cols-2">
            <div>
              <GraduationCap className="mb-4 h-9 w-9 text-brand-300" />
              <h2 className="text-3xl font-bold tracking-tight">Teach once. Let AI help every student.</h2>
              <p className="mt-3 text-white/70">Upload your videos and PDFs and VertexLearn indexes them for the AI tutor automatically. Generate quiz drafts from transcripts, grade with rubrics, and see exactly where students drop off.</p>
              <Link to="/register?role=instructor"><Button size="lg" variant="white" className="mt-7">Become an instructor</Button></Link>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: Wand2, t: 'AI quiz drafts you review and publish' },
                { icon: BarChart3, t: 'Per-lecture drop-off & time-on-task' },
                { icon: MessageSquareQuote, t: 'Topic-level struggle insights' },
                { icon: ShieldCheck, t: 'Admin-reviewed course quality' },
              ].map(({ icon: Icon, t }) => (
                <li key={t} className="rounded-2xl bg-white/10 p-4 text-sm backdrop-blur"><Icon className="mb-2 h-5 w-5 text-brand-300" />{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
