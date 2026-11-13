import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { afterLogin, homeFor, useAuth } from '@/store/auth';
import type { Role } from '@/types';

/**
 * Client-side route guard. It only improves UX (redirects); real security is enforced by the API,
 * which checks the JWT and role on every request.
 */
export function ProtectedRoute({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (roles && !user.roles.some((r) => roles.includes(r))) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

/**
 * For /login, /register: signed-in users go straight on — to the ?next= page they were sent here
 * from (this also runs right after a successful sign-in), otherwise to their dashboard.
 */
export function GuestRoute({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const [params] = useSearchParams();
  if (user) return <Navigate to={afterLogin(params.get('next'), user.role)} replace />;
  return <>{children}</>;
}
