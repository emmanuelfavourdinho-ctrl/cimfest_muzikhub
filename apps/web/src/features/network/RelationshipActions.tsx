import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Plus, UserCheck, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { CONNECTION_MESSAGE_MAX } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Textarea } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { socialKeys, useRelationship } from '@/lib/social-queries';

/**
 * Follow (one-way) and Connect (mutual) are separate actions with separate state,
 * as CLAUDE.md §10 requires. The state shown always comes from the server.
 */
export function RelationshipActions({ username, name }: { username: string; name: string }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const rel = useRelationship(username, Boolean(me));
  const [busy, setBusy] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [message, setMessage] = useState('');

  if (!me) {
    return (
      <Button size="sm" onClick={() => void navigate(`/login?next=${encodeURIComponent(`/u/${username}`)}`)}>
        <Plus /> Follow
      </Button>
    );
  }
  if (!rel.data || rel.data.isSelf) return null;
  const r = rel.data;

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: socialKeys.relationship(username) }),
      qc.invalidateQueries({ queryKey: ['profile'] }),
      qc.invalidateQueries({ queryKey: ['me'] }),
      qc.invalidateQueries({ queryKey: ['connections'] }),
      qc.invalidateQueries({ queryKey: ['discover', 'people'] }),
      qc.invalidateQueries({ queryKey: ['feed', 'following'] }),
    ]);
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (success) toast.success(success);
    } catch (e) {
      toast.error(errorMessage(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const c = r.connection;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant={r.following ? 'outline' : 'primary'} disabled={busy} aria-pressed={r.following} onClick={() => void run(() => api.setFollow(username, !r.following))}>
        {r.following ? <><Check /> Following</> : <><Plus /> Follow</>}
      </Button>

      {c?.status === 'ACCEPTED' ? (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm(`Remove your connection with ${name}?`)) void run(() => api.connectionAction(c.id, 'remove'), 'Connection removed'); }}>
          <UserCheck /> Connected
        </Button>
      ) : c?.status === 'PENDING' && c.direction === 'outgoing' ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api.connectionAction(c.id, 'cancel'), 'Request withdrawn')}>
          <Clock /> Requested · Withdraw
        </Button>
      ) : c?.status === 'PENDING' ? (
        <>
          <Button size="sm" disabled={busy} onClick={() => void run(() => api.connectionAction(c.id, 'accept'), `You're now connected with ${name}`)}>
            <Check /> Accept request
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api.connectionAction(c.id, 'decline'), 'Request declined')}>
            <X /> Decline
          </Button>
        </>
      ) : r.canRequestAfter ? (
        <Button size="sm" variant="outline" disabled title={`You can send another request after ${new Date(r.canRequestAfter).toLocaleDateString()}`}>
          <UserPlus /> Connect (available {new Date(r.canRequestAfter).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })})
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setRequestOpen(true)}>
          <UserPlus /> Connect
        </Button>
      )}

      <Dialog open={requestOpen} onClose={() => setRequestOpen(false)} title={`Connect with ${name}`}>
        <p className="mb-4 text-sm text-sage">Connections are mutual — {name} will need to accept. Following doesn't need approval.</p>
        <Field label="Add a note (optional)" hint={`${message.length}/${CONNECTION_MESSAGE_MAX}`}>
          {(a) => <Textarea {...a} value={message} maxLength={CONNECTION_MESSAGE_MAX} onChange={(e) => setMessage(e.target.value)} placeholder="Say why you'd like to connect" />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRequestOpen(false)}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.requestConnection(username, message.trim() || undefined);
                setRequestOpen(false);
                setMessage('');
              }, 'Connection request sent')
            }
          >
            Send request
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
