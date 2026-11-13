import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { LogoMark } from '@/components/common/Logo';
import { Button, Spinner } from '@/components/common/ui';
import { renewSession } from '@/services/api';
import { getRefreshToken, useAuth } from '@/store/auth';
import { useTheme } from '@/store/theme';
import { router } from '@/routes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err: any) => count < 2 && ![401, 403, 404].includes(err?.response?.status),
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  const ready = useAuth((s) => s.ready);
  const dark = useTheme((s) => s.isDark());
  const [unreachable, setUnreachable] = useState(false);

  // Restore the session on startup (and on every page reload): swap the stored refresh token
  // for a fresh access token.
  const restore = useCallback(async () => {
    setUnreachable(false);
    if (getRefreshToken()) {
      const r = await renewSession();
      // Server down / no network: keep the saved session and offer a retry instead of
      // dropping the user on the sign-in page.
      if (r.status === 'unreachable') return setUnreachable(true);
    }
    useAuth.getState().setReady();
  }, []);

  useEffect(() => { void restore(); }, [restore]);

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <LogoMark className="h-10 w-10" />
          {unreachable ? (
            <>
              <p className="font-semibold">Can't reach VertexLearn right now</p>
              <p className="max-w-xs text-sm text-muted">Check your connection. You're still signed in — we'll pick up where you left off.</p>
              <Button onClick={() => void restore()}>Try again</Button>
            </>
          ) : <Spinner />}
        </div>
      </div>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* Bottom-right so toasts never cover the header's profile menu / notifications. */}
      <Toaster position="bottom-right" richColors closeButton theme={dark ? 'dark' : 'light'} />
    </QueryClientProvider>
  );
}
