import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ACCOUNT_STATUSES, CREATIVE_ROLE_KEYS, CREATIVE_ROLES, PLATFORM_ROLES } from '@muzikhub/shared';
import { Input, Select } from '@/components/ui/form';
import { InfiniteList } from '@/components/ui/InfiniteList';
import { Avatar, PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { errorMessage } from '@/lib/api';
import { flatten } from '@/lib/social-queries';
import { adminApi } from './admin-api';
import { AdminHeader, Ago, DataTable, EmptyRow, RoleTag, StatusTag, Tag, useAdmin } from './ui';

export function UsersPage() {
  const { me } = useAdmin();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const filters = { q: params.get('q') ?? undefined, status: params.get('status') ?? undefined, role: params.get('role') ?? undefined, creativeRole: params.get('creativeRole') ?? undefined };
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => set('q', text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useInfiniteQuery({
    queryKey: ['admin', 'users', filters],
    queryFn: ({ pageParam }) => adminApi.users({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
  });
  const rows = flatten(query.data);
  const showEmail = me.permissions.includes('users.viewPrivate');

  return (
    <div>
      <AdminHeader title="Users" description={showEmail ? 'Search by name, username or email.' : 'Search by name or username. Email addresses are visible to administrators only.'} />
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input aria-label="Search users" placeholder="Search…" value={text} onChange={(e) => setText(e.target.value)} />
        <Select aria-label="Account status" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
        </Select>
        <Select aria-label="Platform role" value={filters.role ?? ''} onChange={(e) => set('role', e.target.value)}>
          <option value="">Any platform role</option>
          {PLATFORM_ROLES.map((r) => <option key={r} value={r}>{r === 'USER' ? 'Member' : r.charAt(0) + r.slice(1).toLowerCase()}</option>)}
        </Select>
        <Select aria-label="Professional role" value={filters.creativeRole ?? ''} onChange={(e) => set('creativeRole', e.target.value)}>
          <option value="">Any professional role</option>
          {CREATIVE_ROLE_KEYS.map((r) => <option key={r} value={r}>{CREATIVE_ROLES[r]}</option>)}
        </Select>
      </div>
      {query.isPending ? (
        <PageLoading />
      ) : query.isError && rows.length === 0 ? (
        <LoadFailed message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <InfiniteList hasNextPage={query.hasNextPage} isFetchingNextPage={query.isFetchingNextPage} fetchNextPage={() => void query.fetchNextPage()} isError={query.isError}>
          <DataTable>
            <thead><tr><th>Member</th>{showEmail && <th>Email</th>}<th>Status</th><th>Roles</th><th>Joined</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <EmptyRow cols={showEmail ? 5 : 4}>No users match.</EmptyRow> : rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link to={`/admin/users/${u.id}`} className="flex items-center gap-2.5 hover:text-mint">
                      <Avatar name={u.name} image={u.image} className="size-8 text-[10px]" />
                      <span><span className="block font-semibold">{u.name}</span><span className="text-xs text-sage">@{u.username}</span></span>
                    </Link>
                  </td>
                  {showEmail && <td className="text-sage">{u.email} {u.emailVerified ? '' : <Tag color="gray">unverified</Tag>}</td>}
                  <td><StatusTag status={u.status} />{u.statusUntil && <span className="ml-1 text-[11px] text-sage">until {new Date(u.statusUntil).toLocaleDateString()}</span>}</td>
                  <td className="space-x-1"><RoleTag role={u.role} />{u.creativeRoles.slice(0, 2).map((r) => <span key={r} className="text-xs text-sage">{CREATIVE_ROLES[r as keyof typeof CREATIVE_ROLES]}</span>)}</td>
                  <td className="whitespace-nowrap text-sage"><Ago iso={u.joinedAt} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </InfiniteList>
      )}
    </div>
  );
}
