import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  MESSAGE_POLICIES,
  type MessagePolicy,
  NOTIFICATION_CATEGORIES,
  notificationSettingsSchema,
  personSummarySchema,
  type NotificationCategory,
} from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Avatar, PageHeader, PageLoading, Panel } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage, request } from '@/lib/api';
import { cn } from '@/lib/cn';
import { messagingApi, messagingKeys } from '@/lib/messaging';

const blocksSchema = z.object({ items: z.array(personSummarySchema) });

/** /settings/preferences — in-app notification categories (MSG-006) and your block list (PROF-006). */
export function PreferencesPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="Notifications and privacy"
        description="Choose what MuzikHub tells you about, and manage who you’ve blocked."
      />
      <div className="space-y-4">
        <NotificationSettings />
        <MessagePrivacy />
        <BlockedMembers />
      </div>
    </div>
  );
}

function NotificationSettings() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notifications', 'settings'],
    queryFn: () => request('/notifications/settings', notificationSettingsSchema),
  });
  const toggle = async (category: NotificationCategory, inApp: boolean) => {
    try {
      qc.setQueryData(
        ['notifications', 'settings'],
        await request('/notifications/settings', notificationSettingsSchema, { method: 'PUT', body: { settings: [{ category, inApp }] } }),
      );
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Panel className="p-5 sm:p-6" aria-labelledby="notif-heading">
      <h2 id="notif-heading" className="text-lg font-bold">
        In-app notifications
      </h2>
      <p className="mt-0.5 text-sm text-text-2">
        Payment, plan and account-safety notices are always on. We don’t send email notifications yet.
      </p>
      {q.isPending ? (
        <PageLoading />
      ) : q.isError ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <ul className="mt-4 divide-y divide-hairline-strong">
          {q.data.settings.map((s) => (
            <li key={s.category} className="flex min-h-14 items-center justify-between gap-4">
              <span className="text-sm text-text-1">{NOTIFICATION_CATEGORIES[s.category]}</span>
              <button
                type="button"
                role="switch"
                aria-checked={s.inApp}
                aria-label={NOTIFICATION_CATEGORIES[s.category]}
                onClick={() => void toggle(s.category, !s.inApp)}
                className={cn(
                  'relative h-7 w-12 shrink-0 rounded-full border transition',
                  s.inApp ? 'border-signal bg-signal' : 'border-control-border bg-surface-overlay',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-0.5 size-5.5 rounded-full transition',
                    s.inApp ? 'left-5.5 bg-on-signal' : 'left-0.5 bg-text-2',
                  )}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MessagePrivacy() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: messagingKeys.policy, queryFn: messagingApi.policy });
  const set = async (policy: MessagePolicy) => {
    try {
      qc.setQueryData(messagingKeys.policy, await messagingApi.setPolicy(policy));
      toast.success('Saved');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Panel className="p-5 sm:p-6" aria-labelledby="dm-heading">
      <h2 id="dm-heading" className="text-lg font-bold">
        Who can message you
      </h2>
      <p className="mt-0.5 text-sm text-text-2">Applies to new conversations. People you already talk with can keep replying.</p>
      {q.isPending ? (
        <PageLoading />
      ) : q.isError ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <fieldset className="mt-4 space-y-2">
          <legend className="sr-only">Who can message you</legend>
          {(Object.keys(MESSAGE_POLICIES) as MessagePolicy[]).map((p) => (
            <label key={p} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="radio"
                name="message-policy"
                checked={q.data.policy === p}
                onChange={() => void set(p)}
                className="accent-signal"
              />
              {MESSAGE_POLICIES[p]}
            </label>
          ))}
        </fieldset>
      )}
    </Panel>
  );
}

function BlockedMembers() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['blocks'], queryFn: () => request('/blocks', blocksSchema) });
  return (
    <Panel className="p-5 sm:p-6" aria-labelledby="blocks-heading">
      <h2 id="blocks-heading" className="text-lg font-bold">
        Blocked members
      </h2>
      <p className="mt-0.5 text-sm text-text-2">
        Blocked members can’t message, follow, connect, collaborate with or invite you. They aren’t told.
      </p>
      {q.isPending ? (
        <PageLoading />
      ) : q.isError ? (
        <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <p className="mt-4 text-sm text-text-3">You haven’t blocked anyone.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {q.data.items.map((p) => (
            <li key={p.username} className="flex items-center justify-between gap-3">
              <Link to={`/u/${p.username}`} className="flex min-w-0 items-center gap-3 hover:text-signal">
                <Avatar name={p.name} image={p.image} className="size-9 text-xs" />
                <span className="truncate text-sm font-semibold">{p.name}</span>
              </Link>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await request(`/blocks/${encodeURIComponent(p.username)}`, null, { method: 'DELETE' });
                    await qc.invalidateQueries({ queryKey: ['blocks'] });
                    toast.success(`You unblocked ${p.name}`);
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
