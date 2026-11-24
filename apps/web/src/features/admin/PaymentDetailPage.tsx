import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { formatDateTime, formatXaf, OrderStatusPill } from '@/features/billing/ui';
import { errorMessage } from '@/lib/api';
import { adminApi, type AdminOrderDetail } from './admin-api';
import { AdminHeader, canDo, ReasonDialog, Section, Tag, useAdmin, useAdminAction } from './ui';

type Action = 'recheck' | 'retry-fulfilment' | 'approve-late' | 'refund';
const ACTIONS: Record<Action, { label: string; title: string; description: string; destructive?: boolean }> = {
  recheck: {
    label: 'Re-check with provider',
    title: 'Re-check this payment',
    description: 'Asks the provider for the current status and applies the normal rules. It never forces a status.',
  },
  'retry-fulfilment': {
    label: 'Retry fulfilment',
    title: 'Retry fulfilment',
    description: 'Queues granting the benefit again. Safe to repeat: a benefit is never granted twice.',
  },
  'approve-late': {
    label: 'Approve late payment',
    title: 'Approve a late payment',
    description:
      'Only if the provider confirms right now that it was paid in full. Then the benefit is granted. Requires a recent sign-in.',
  },
  refund: {
    label: 'Refund',
    title: 'Refund this order',
    description:
      'Refunds the payment through the provider and ends what it granted. The provider keeps its original fee. Requires a recent sign-in.',
    destructive: true,
  },
};

/** /admin/payments/:reference — one order: facts, history, webhooks and the allowed, audited actions. */
export function PaymentDetailPage() {
  const { reference = '' } = useParams();
  const q = useQuery({ queryKey: ['admin', 'payment', reference], queryFn: () => adminApi.paymentOrder(reference) });
  if (q.isPending) return <PageLoading />;
  if (q.isError) return <LoadFailed message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return <Detail o={q.data} />;
}

function Detail({ o }: { o: AdminOrderDetail }) {
  const { me } = useAdmin();
  const act = useAdminAction();
  const [open, setOpen] = useState<Action | null>(null);
  const allowed: [Action, boolean][] = [
    ['recheck', o.actions.recheck && canDo(me, 'payments.repair')],
    ['retry-fulfilment', o.actions.retryFulfilment && canDo(me, 'payments.repair')],
    ['approve-late', o.actions.approveLate && canDo(me, 'payments.repair')],
    ['refund', o.actions.refund && canDo(me, 'payments.refund')],
  ];
  const facts: [string, string][] = [
    ['Item', `${o.product}, ${o.option}`],
    ['Amount', formatXaf(o.amountXaf)],
    ['Member', `${o.user.name}${o.user.username ? ` (@${o.user.username})` : ''}`],
    ['Provider', `${o.provider}${o.providerTransactionId ? ` · ${o.providerTransactionId}` : ''}`],
    ['Created', formatDateTime(o.createdAt)],
    ['Expires', formatDateTime(o.expiresAt)],
    ...(o.paidAt ? ([['Paid', formatDateTime(o.paidAt)]] as [string, string][]) : []),
    ...(o.fulfilledAt ? ([['Fulfilled', formatDateTime(o.fulfilledAt)]] as [string, string][]) : []),
    ...(o.refundedAt
      ? ([['Refunded', `${formatDateTime(o.refundedAt)} · ${o.refundReason ?? ''} · provider fee not refunded`]] as [string, string][])
      : []),
    ...(o.targetId ? ([['Promotion target', o.targetId]] as [string, string][]) : []),
  ];
  return (
    <div>
      <Link to="/admin/payments" className="mb-3 inline-flex items-center gap-1 text-xs text-text-2 hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Payments
      </Link>
      <AdminHeader
        title={`${o.product}, ${o.option}`}
        description={<span className="font-mono text-xs break-all">{o.reference}</span>}
        actions={o.mode === 'SANDBOX' ? <Tag color="gold">Sandbox: test payment</Tag> : <Tag color="green">Live</Tag>}
      />
      <div className="space-y-4">
        <Section title="Status">
          <div className="flex flex-wrap items-center gap-2 px-3">
            <OrderStatusPill status={o.status} />
            {o.statusReason && <span className="text-xs text-text-2">Reason: {o.statusReason.replace('_', ' ')}</span>}
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-text-2">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
          {allowed.some(([, ok]) => ok) && (
            <div className="mt-4 flex flex-wrap gap-2 px-3">
              {allowed
                .filter(([, ok]) => ok)
                .map(([a]) => (
                  <Button key={a} size="sm" variant={ACTIONS[a].destructive ? 'destructive' : 'outline'} onClick={() => setOpen(a)}>
                    {ACTIONS[a].label}
                  </Button>
                ))}
            </div>
          )}
        </Section>
        <Section title="History">
          <ol className="space-y-2 px-3 text-sm">
            {o.history.map((h, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="text-text-2">{formatDateTime(h.at)}</span>
                <span>
                  {h.from ? `${h.from} → ` : ''}
                  <strong>{h.to}</strong>
                </span>
                <span className="font-mono text-xs text-text-3">{h.trigger}</span>
                {h.detail && <span className="w-full text-xs text-text-3">{h.detail}</span>}
              </li>
            ))}
          </ol>
        </Section>
        <Section title="Fulfilment and webhooks">
          <div className="space-y-1 px-3 text-sm text-text-2">
            {o.fulfilments.length === 0 ? (
              <p>Nothing granted.</p>
            ) : (
              o.fulfilments.map((f) => (
                <p key={f.fulfiller}>
                  Granted by {f.fulfiller} ({f.entitlementType ?? 'no entitlement'}) at {formatDateTime(f.at)}
                </p>
              ))
            )}
            {o.webhooks.length === 0 ? (
              <p>No webhooks received.</p>
            ) : (
              o.webhooks.map((w) => (
                <p key={w.eventId}>
                  Webhook {w.type} at {formatDateTime(w.at)}
                </p>
              ))
            )}
          </div>
        </Section>
      </div>
      {open && (
        <ReasonDialog
          open
          onClose={() => setOpen(null)}
          title={ACTIONS[open].title}
          description={ACTIONS[open].description}
          confirmLabel={ACTIONS[open].label}
          destructive={ACTIONS[open].destructive}
          onConfirm={(reason) => act(() => adminApi.paymentAction(o.reference, open, reason), 'Done')}
        />
      )}
    </div>
  );
}
