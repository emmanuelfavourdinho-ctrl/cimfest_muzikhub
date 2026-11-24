import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { CREATIVE_ROLES, PLATFORM_ROLES, REPORT_REASONS, type PlatformRole } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Avatar, PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { adminApi, type AdminUserDetail } from './admin-api';
import { describeAction } from './AuditPage';
import { AdminHeader, Ago, ReasonDialog, ReportStatusTag, RoleTag, Section, Stat, StatusTag, Tag, useAdminAction } from './ui';

export function UserDetailPage() {
  const { id = '' } = useParams();
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => adminApi.user(id) });
  if (isPending) return <PageLoading />;
  if (isError) return <LoadFailed message={errorMessage(error)} onRetry={() => void refetch()} />;
  return <UserWorkspace u={data} />;
}

type Dialog = null | 'restrict' | 'suspend' | 'ban' | 'reinstate' | 'role' | 'reset2fa' | 'avatar' | 'cover';

/** Date input value N days from now, for the suspension picker. */
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function UserWorkspace({ u }: { u: AdminUserDetail }) {
  const act = useAdminAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [until, setUntil] = useState(inDays(7));
  const [role, setRole] = useState<PlatformRole>(u.role);
  const close = () => setDialog(null);
  const a = u.allowed;

  return (
    <div>
      <Link to="/admin/users" className="mb-3 inline-flex items-center gap-1 text-xs text-sage hover:text-foreground">
        <ArrowLeft className="size-3" /> Users
      </Link>
      <AdminHeader
        title={u.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            @{u.username} <StatusTag status={u.status} /> <RoleTag role={u.role} />
            {u.role !== 'USER' && (
              <Tag color={u.twoFactorEnabled ? 'green' : 'gold'}>{u.twoFactorEnabled ? '2-step on' : '2-step not set up'}</Tag>
            )}
            {u.username && (
              <a
                href={`/u/${u.username}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-mint-soft hover:underline"
              >
                Public profile <ExternalLink className="size-3" />
              </a>
            )}
          </span>
        }
        actions={
          <>
            {a.restrict && (
              <Button size="sm" variant="outline" onClick={() => setDialog('restrict')}>
                Restrict
              </Button>
            )}
            {a.suspend && (
              <Button size="sm" variant="outline" onClick={() => setDialog('suspend')}>
                Suspend
              </Button>
            )}
            {a.ban && (
              <Button size="sm" variant="destructive" onClick={() => setDialog('ban')}>
                Ban
              </Button>
            )}
            {a.reinstate && (
              <Button size="sm" onClick={() => setDialog('reinstate')}>
                Reinstate
              </Button>
            )}
          </>
        }
      />

      {u.status !== 'ACTIVE' && u.statusReason && (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          <strong>{u.status.charAt(0) + u.status.slice(1).toLowerCase()}</strong>
          {u.statusUntil && <> until {new Date(u.statusUntil).toLocaleString()}</>}: {u.statusReason}
          <span className="text-sage">
            {' '}
            · <Ago iso={u.statusChangedAt} />
          </span>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Section title="Account">
            <div className="flex items-start gap-3 px-3 py-2">
              <Avatar name={u.name} image={u.image} className="size-14 text-sm" />
              <dl className="grid min-w-0 flex-1 grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs text-sage">Email</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    {u.email ?? <span className="text-sage-dim">visible to administrators</span>}{' '}
                    {u.email && (u.emailVerified ? <Tag color="green">verified</Tag> : <Tag color="gray">unverified</Tag>)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-sage">Joined</dt>
                  <dd>{new Date(u.joinedAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt className="text-xs text-sage">Last active</dt>
                  <dd>
                    <Ago iso={u.lastActiveAt} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-sage">Professional roles</dt>
                  <dd>{u.creativeRoles.map((r) => CREATIVE_ROLES[r as keyof typeof CREATIVE_ROLES]).join(' · ') || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-sage">Location</dt>
                  <dd>{u.location ?? '—'}</dd>
                </div>
              </dl>
            </div>
            {u.bio && <p className="px-3 pb-2 text-sm text-sage">{u.bio}</p>}
            {(u.image || u.hasCover) && (
              <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2">
                {u.image && (
                  <Button size="sm" variant="quiet" onClick={() => setDialog('avatar')}>
                    Remove profile photo
                  </Button>
                )}
                {u.hasCover && (
                  <Button size="sm" variant="quiet" onClick={() => setDialog('cover')}>
                    Remove cover image
                  </Button>
                )}
              </div>
            )}
          </Section>

          <Section title="Activity">
            <dl className="grid grid-cols-2 sm:grid-cols-5">
              <Stat label="Posts" value={u.activity.posts} />
              <Stat label="Comments" value={u.activity.comments} />
              <Stat label="Portfolio items" value={u.activity.portfolioItems} />
              <Stat label="Published" value={u.activity.publishedWork} />
              <Stat label="Reports filed" value={u.activity.reportsFiled} />
            </dl>
          </Section>

          <Section title={`Reports about this member (${u.reportsAgainst.length})`}>
            {u.reportsAgainst.length === 0 ? (
              <p className="px-3 py-2 text-sm text-sage">None.</p>
            ) : (
              <ul className="divide-y divide-line">
                {u.reportsAgainst.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <Link to={`/admin/reports/${r.id}`} className="hover:text-mint">
                      {REPORT_REASONS[r.reason as keyof typeof REPORT_REASONS]} · {r.targetType.toLowerCase().replace('_', ' ')} ·{' '}
                      <Ago iso={r.createdAt} />
                    </Link>
                    <ReportStatusTag status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          {(a.changeRole || a.resetTwoFactor) && (
            <Section title="Staff access">
              <div className="space-y-3 px-3 py-2">
                {a.changeRole && (
                  <div className="flex items-end gap-2">
                    <Field label="Platform role" className="mb-0 flex-1">
                      {(f) => (
                        <Select {...f} value={role} onChange={(e) => setRole(e.target.value as PlatformRole)}>
                          {PLATFORM_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r === 'USER' ? 'Member (no staff access)' : r.charAt(0) + r.slice(1).toLowerCase()}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Button size="sm" disabled={role === u.role} onClick={() => setDialog('role')}>
                      Change
                    </Button>
                  </div>
                )}
                {a.resetTwoFactor && u.twoFactorEnabled && (
                  <Button size="sm" variant="outline" onClick={() => setDialog('reset2fa')}>
                    Reset two-step verification
                  </Button>
                )}
                <p className="text-[11px] text-sage-dim">
                  Role changes and resets need a recent sign-in. Staff must set up two-step verification before using the console.
                </p>
              </div>
            </Section>
          )}
          <Section title="Account history">
            {u.history.length === 0 ? (
              <p className="px-3 py-2 text-sm text-sage">No administrative actions on this account.</p>
            ) : (
              <ol className="space-y-2 px-3 py-2 text-sm">
                {u.history.map((h) => (
                  <li key={h.id}>
                    <span className="font-medium">{describeAction(h.action)}</span>{' '}
                    <span className="text-xs text-sage">
                      <Ago iso={h.createdAt} /> · {h.actorRole?.toLowerCase() ?? h.actorLabel}
                    </span>
                    {h.reason && <p className="text-sage">{h.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>

      <ReasonDialog
        open={dialog === 'restrict'}
        onClose={close}
        title="Restrict account"
        confirmLabel="Restrict"
        description="They can still sign in and browse, but can't post, comment, like, follow, connect or edit their profile until reinstated."
        onConfirm={(reason) => act(() => adminApi.setStatus(u.id, { status: 'RESTRICTED', reason }), 'Account restricted')}
      />
      <ReasonDialog
        open={dialog === 'suspend'}
        onClose={close}
        title="Suspend account"
        confirmLabel="Suspend"
        destructive
        description={`They are signed out everywhere and can't sign in until the end date. Your role can suspend for up to ${a.maxSuspensionDays} days.`}
        onConfirm={(reason) =>
          act(
            () => adminApi.setStatus(u.id, { status: 'SUSPENDED', reason, until: new Date(`${until}T23:59:00`).toISOString() }),
            'Account suspended',
          )
        }
      >
        <Field label="Suspended until">
          {(f) => (
            <Input
              {...f}
              type="date"
              value={until}
              min={inDays(1)}
              max={inDays(a.maxSuspensionDays)}
              onChange={(e) => setUntil(e.target.value)}
            />
          )}
        </Field>
      </ReasonDialog>
      <ReasonDialog
        open={dialog === 'ban'}
        onClose={close}
        title="Ban account"
        confirmLabel="Ban"
        destructive
        description="Indefinite. They are signed out everywhere, disappear from MuzikHub, and only an administrator can reinstate them."
        onConfirm={(reason) => act(() => adminApi.setStatus(u.id, { status: 'BANNED', reason }), 'Account banned')}
      />
      <ReasonDialog
        open={dialog === 'reinstate'}
        onClose={close}
        title="Reinstate account"
        confirmLabel="Reinstate"
        onConfirm={(reason) => act(() => adminApi.setStatus(u.id, { status: 'ACTIVE', reason }), 'Account reinstated')}
      />
      <ReasonDialog
        open={dialog === 'role'}
        onClose={close}
        title={`Change role to ${role.toLowerCase()}`}
        confirmLabel="Change role"
        onConfirm={(reason) => act(() => adminApi.setRole(u.id, role, reason), 'Role changed')}
      />
      <ReasonDialog
        open={dialog === 'reset2fa'}
        onClose={close}
        title="Reset two-step verification"
        confirmLabel="Reset"
        destructive
        description="Use when they've lost their authenticator and backup codes. They're signed out everywhere and must set it up again."
        onConfirm={(reason) => act(() => adminApi.resetTwoFactor(u.id, reason), 'Two-step verification reset')}
      />
      <ReasonDialog
        open={dialog === 'avatar' || dialog === 'cover'}
        onClose={close}
        title={dialog === 'avatar' ? 'Remove profile photo' : 'Remove cover image'}
        confirmLabel="Remove"
        destructive
        description="The image file is deleted. This can't be undone."
        onConfirm={(reason) =>
          act(() => adminApi.removeContent(dialog === 'avatar' ? 'profile-avatar' : 'profile-cover', u.id, reason), 'Image removed')
        }
      />
    </div>
  );
}
