/**
 * Signed-in shell: role-specific sidebar + top bar. The sidebar collapses into a drawer on mobile.
 */
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Award, BarChart3, BookMarked, BookOpen, ClipboardCheck, ClipboardList, Compass, FileClock, GraduationCap, Layers,
  LayoutDashboard, LogOut, Megaphone, Menu, MessagesSquare, Search, Settings, ShieldCheck, Sparkles, Trophy, Users, Wallet, X, CalendarCheck2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/common/ui';
import { Logo } from '@/components/common/Logo';
import { NotificationBell } from '@/components/common/NotificationBell';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { api } from '@/services/api';
import { getRefreshToken, homeFor, useAuth } from '@/store/auth';
import { useT } from '@/utils/i18n';

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean }
const ic = 'h-[18px] w-[18px]';

function useNav(): { section?: string; items: NavItem[] }[] {
  const role = useAuth((s) => s.user?.role);
  const t = useT();
  if (role === 'admin') {
    return [
      { items: [
        { to: '/admin', label: t('nav.overview'), icon: <LayoutDashboard className={ic} />, end: true },
        { to: '/admin/users', label: t('nav.users'), icon: <Users className={ic} /> },
        { to: '/admin/courses', label: t('nav.approvals'), icon: <ShieldCheck className={ic} /> },
        { to: '/admin/revenue', label: t('nav.revenue'), icon: <Wallet className={ic} /> },
        { to: '/admin/moderation', label: t('nav.moderation'), icon: <MessagesSquare className={ic} /> },
        { to: '/admin/notifications', label: t('nav.broadcast'), icon: <Megaphone className={ic} /> },
        { to: '/admin/audit', label: t('nav.audit'), icon: <FileClock className={ic} /> },
      ] },
      { section: 'Platform', items: [{ to: '/courses', label: t('nav.catalog'), icon: <Compass className={ic} /> }] },
    ];
  }
  if (role === 'instructor') {
    return [
      { items: [
        { to: '/instructor', label: t('nav.dashboard'), icon: <LayoutDashboard className={ic} />, end: true },
        { to: '/instructor/courses', label: t('nav.courses'), icon: <Layers className={ic} /> },
        { to: '/instructor/grading', label: t('nav.grading'), icon: <ClipboardCheck className={ic} /> },
        { to: '/instructor/analytics', label: t('nav.analytics'), icon: <BarChart3 className={ic} /> },
        { to: '/app/tutor', label: t('nav.tutor'), icon: <Sparkles className={ic} /> },
      ] },
      { section: 'Platform', items: [{ to: '/courses', label: t('nav.catalog'), icon: <Compass className={ic} /> }] },
    ];
  }
  return [
    { items: [
      { to: '/app', label: t('nav.dashboard'), icon: <LayoutDashboard className={ic} />, end: true },
      { to: '/app/learning', label: t('nav.myLearning'), icon: <GraduationCap className={ic} /> },
      { to: '/courses', label: t('nav.catalog'), icon: <Compass className={ic} /> },
      { to: '/app/tutor', label: t('nav.tutor'), icon: <Sparkles className={ic} /> },
    ] },
    { section: 'Practice', items: [
      { to: '/app/assignments', label: t('nav.assignments'), icon: <ClipboardList className={ic} /> },
      { to: '/app/quizzes', label: t('nav.quizzes'), icon: <BookOpen className={ic} /> },
      { to: '/app/flashcards', label: t('nav.flashcards'), icon: <Layers className={ic} /> },
      { to: '/app/study-plan', label: t('nav.studyPlan'), icon: <CalendarCheck2 className={ic} /> },
      { to: '/app/notes', label: t('nav.notes'), icon: <BookMarked className={ic} /> },
    ] },
    { section: 'Community', items: [
      { to: '/app/discussions', label: t('nav.discussions'), icon: <MessagesSquare className={ic} /> },
      { to: '/app/achievements', label: t('nav.achievements'), icon: <Award className={ic} /> },
      { to: '/app/leaderboard', label: t('nav.leaderboard'), icon: <Trophy className={ic} /> },
    ] },
  ];
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const groups = useNav();
  const role = useAuth((s) => s.user?.role);
  const t = useT();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5"><Logo to={homeFor(role)} /></div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2 scrollbar-thin" aria-label="Main">
        {groups.map((g, i) => (
          <div key={i}>
            {g.section && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{g.section}</p>}
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavigate} className={({ isActive }) => clsx('nav-link', isActive && 'active')}>
                  {it.icon}{it.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <NavLink to="/settings" onClick={onNavigate} className={({ isActive }) => clsx('nav-link', isActive && 'active')}><Settings className={ic} />{t('nav.settings')}</NavLink>
        {role === 'student' && (
          <div className="mt-3 rounded-2xl bg-gradient-to-br from-brand-600 to-navy-800 p-4 text-white">
            <Sparkles className="mb-2 h-5 w-5" />
            <p className="text-sm font-semibold">Stuck on a concept?</p>
            <p className="mt-0.5 text-xs text-white/75">Your AI tutor answers from your course material, with sources.</p>
            <NavLink to="/app/tutor" onClick={onNavigate} className="mt-3 inline-block rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25">Ask the tutor</NavLink>
          </div>
        )}
      </div>
    </div>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = useAuth((s) => s.user)!;
  const clear = useAuth((s) => s.clear);
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMobileOpen(false); setMenu(false); }, [loc.pathname]);

  // Profile menu closes on a click outside it or on Escape. (It used to close when the button lost
  // focus, which happened mid-click — so "Sign out" often vanished before the click landed.)
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menu]);

  const logout = async () => {
    try { await api.post('/auth/logout', { refresh_token: getRefreshToken() }); } catch { /* still sign out locally */ }
    clear();
    qc.clear();
    nav('/login');
  };

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-surface lg:block"><Sidebar /></aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-border bg-surface shadow-lift animate-fade-in">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 rounded-lg p-1.5 text-muted" aria-label="Close menu"><X className="h-5 w-5" /></button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md sm:px-6">
          <button className="rounded-xl p-2 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <form className="relative hidden max-w-md flex-1 sm:block" onSubmit={(e) => { e.preventDefault(); nav(`/courses?q=${encodeURIComponent(q)}`); }} role="search">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses, topics, instructors…" className="input h-10 pl-9" aria-label="Search courses" />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            <div className="relative ml-1" ref={menuRef}>
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 hover:bg-surface-2" aria-haspopup="menu" aria-expanded={menu}>
                <Avatar name={user.full_name} src={user.avatar_url} size={32} />
                <div className="hidden text-left md:block">
                  <p className="text-sm font-semibold leading-tight">{user.full_name}</p>
                  <p className="text-xs capitalize text-muted">{user.role}</p>
                </div>
              </button>
              {menu && (
                <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-surface p-1.5 shadow-lift animate-scale-in" role="menu">
                  <div className="px-3 py-2"><p className="truncate text-sm font-semibold">{user.full_name}</p><p className="truncate text-xs text-muted">{user.email}</p></div>
                  <button role="menuitem" onClick={() => { setMenu(false); nav('/settings'); }} className="nav-link w-full"><Settings className="h-4 w-4" />Settings</button>
                  <button role="menuitem" onClick={() => { setMenu(false); void logout(); }} className="nav-link w-full text-rose-600 hover:text-rose-700"><LogOut className="h-4 w-4" />Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
