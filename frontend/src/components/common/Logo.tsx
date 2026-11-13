import { Link } from 'react-router-dom';

/** Just the mark — safe to render outside the router (e.g. the startup splash screen). */
export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`${className} shrink-0`} aria-hidden>
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8B5CF6" /><stop offset="1" stopColor="#4C1D95" /></linearGradient></defs>
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <path d="M8 10l8 13 8-13" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="9" r="2" fill="#fff" />
    </svg>
  );
}

export function Logo({ to = '/', compact }: { to?: string; compact?: boolean }) {
  return (
    <Link to={to} className="flex items-center gap-2.5" aria-label="VertexLearn AI home">
      <LogoMark />
      {!compact && (
        <span className="text-[1.05rem] font-bold tracking-tight">
          VertexLearn<span className="ml-1 rounded-md bg-brand-600 px-1.5 py-0.5 align-middle text-[0.65rem] font-bold text-white">AI</span>
        </span>
      )}
    </Link>
  );
}
