import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Award, Bell, BookOpen, CheckCheck, ClipboardCheck, Info, Megaphone, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { timeAgo } from '@/utils/format';

export interface Notification { id: string; title: string; body: string; type: string; link: string | null; is_read: boolean; created_at: string }

export const notifIcon = (type: string) => {
  const cls = 'h-4 w-4';
  return { announcement: <Megaphone className={cls} />, grade: <ClipboardCheck className={cls} />, badge: <Award className={cls} />, course: <BookOpen className={cls} />, system: <ShieldAlert className={cls} />, assignment: <ClipboardCheck className={cls} /> }[type] ?? <Info className={cls} />;
};

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get<{ data: Notification[]; unread_count: number }>('/notifications')).data,
    refetchInterval: 30_000, // simple polling keeps the bell fresh
  });
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data } = useNotifications();
  const markAll = useMutation({ mutationFn: () => api.put('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const markOne = useMutation({ mutationFn: (id: string) => api.put(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const unread = data?.unread_count ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-surface shadow-lift animate-scale-in">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-semibold">Notifications</p>
            {unread > 0 && <button onClick={() => markAll.mutate()} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"><CheckCheck className="h-3.5 w-3.5" />Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            {!data?.data.length ? <p className="px-4 py-10 text-center text-sm text-muted">You're all caught up.</p> : data.data.slice(0, 8).map((n) => (
              <button key={n.id} onClick={() => { if (!n.is_read) markOne.mutate(n.id); setOpen(false); if (n.link) nav(n.link); }}
                className={clsx('flex w-full gap-3 border-b border-border/60 px-4 py-3 text-left transition last:border-0 hover:bg-surface-2', !n.is_read && 'bg-brand-50/50 dark:bg-brand-500/5')}>
                <div className={clsx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl', n.is_read ? 'bg-surface-2 text-muted' : 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300')}>{notifIcon(n.type)}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{n.title}</p>
                  <p className="line-clamp-2 text-xs text-muted">{n.body}</p>
                  <p className="mt-1 text-[11px] text-muted">{timeAgo(n.created_at)}</p>
                </div>
                {!n.is_read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
              </button>
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-border px-4 py-2.5 text-center text-sm font-medium text-brand-600 hover:bg-surface-2">View all</Link>
        </div>
      )}
    </div>
  );
}
