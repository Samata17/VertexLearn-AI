import { Menu, X } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/common/ui';
import { Logo } from '@/components/common/Logo';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import { homeFor, useAuth } from '@/store/auth';

/**
 * In-app navigation doesn't scroll to "#section" links by itself (the browser only does that on a full
 * page load). So: links like /#features scroll to that section, and a new page starts at the top.
 * The landing page is lazy-loaded, so we retry briefly until the section exists.
 */
function useHashScroll() {
  const { pathname, hash, key } = useLocation();
  // New page (not just new filters in the query string): start at the top.
  useEffect(() => { if (!hash) window.scrollTo(0, 0); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hash) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el || ++tries > 40) {
        clearInterval(timer);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
    return () => clearInterval(timer);
  }, [hash, key]); // key changes on every click, so clicking the same link again scrolls again
}

export function PublicLayout() {
  const user = useAuth((s) => s.user);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useHashScroll();
  const links = [{ to: '/courses', label: 'Courses' }, { to: '/#tutor', label: 'AI Tutor' }, { to: '/#features', label: 'Features' }, { to: '/#instructors', label: 'For instructors' }];
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => {
              const active = l.to.includes('#') ? loc.pathname + loc.hash === l.to : loc.pathname.startsWith(l.to);
              return <Link key={l.to} to={l.to} aria-current={active ? 'page' : undefined} className={clsx('rounded-lg px-3 py-2 text-sm font-medium hover:text-ink', active ? 'text-ink' : 'text-muted')}>{l.label}</Link>;
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            {user ? (
              <Link to={homeFor(user.role)}><Button size="sm">Go to dashboard</Button></Link>
            ) : (
              <>
                <Link to="/login" className="hidden sm:block"><Button variant="ghost" size="sm">Sign in</Button></Link>
                {/* On very small phones this moves into the menu below so the header fits. */}
                <Link to="/register" className="max-[359px]:hidden"><Button size="sm">Get started</Button></Link>
              </>
            )}
            <button className="rounded-lg p-2 text-muted md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-border px-4 py-3 md:hidden">
            {links.map((l) => <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm font-medium">{l.label}</Link>)}
            {!user && <Link to="/login" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm font-medium">Sign in</Link>}
            {!user && <Link to="/register" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm font-medium text-brand-600 min-[360px]:hidden">Get started</Link>}
          </nav>
        )}
      </header>
      <main className="flex-1"><Outlet /></main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
          <div className="md:col-span-2">
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-muted">The learning platform with an AI tutor that answers from your course material — in seconds, at any hour.</p>
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold">Platform</p>
            <ul className="space-y-2 text-sm text-muted"><li><Link to="/courses" className="hover:text-ink">Course catalog</Link></li><li><Link to="/register" className="hover:text-ink">Create an account</Link></li><li><Link to="/login" className="hover:text-ink">Sign in</Link></li></ul>
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold">Company</p>
            <ul className="space-y-2 text-sm text-muted"><li>Vertexon Learning Technologies Pvt. Ltd.</li><li><Link to="/register?role=instructor" className="hover:text-ink">Teach on VertexLearn</Link></li></ul>
          </div>
        </div>
        <div className="border-t border-border py-5 text-center text-xs text-muted">© {new Date().getFullYear()} Vertexon Learning Technologies Pvt. Ltd. All rights reserved.</div>
      </footer>
    </div>
  );
}
