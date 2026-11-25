import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { billingApi, billingKeys } from '@/lib/billing';

/** Header bell: unread count, refreshed every minute (no realtime channel yet). */
export function NotificationBell() {
  const q = useQuery({ queryKey: billingKeys.unread, queryFn: billingApi.unreadCount, refetchInterval: 60_000 });
  const count = q.data?.count ?? 0;
  return (
    <Button asChild variant="quiet" size="sm" className="relative">
      <Link to="/notifications" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}>
        <Bell aria-hidden />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 min-w-4.5 rounded-full bg-signal px-1 text-center text-xs font-bold text-on-signal"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Link>
    </Button>
  );
}
