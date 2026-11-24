import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, Handshake, RotateCw, Send, WifiOff } from 'lucide-react';
import type { ConversationView, MessageView } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { Avatar, EmptyState, PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { ReportButton } from '@/features/feed/ReportButton';
import { timeAgo } from '@/features/feed/PostCard';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { drafts, messagingApi, messagingKeys, newClientId } from '@/lib/messaging';
import { getSocket, useOnReconnect, useSocketEvent } from '@/lib/realtime';

/** /messages and /messages/:id — conversation list beside the open thread (stacked on phones). */
export function MessagesPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: messagingKeys.list, queryFn: messagingApi.list });
  const refreshList = useCallback(() => void qc.invalidateQueries({ queryKey: messagingKeys.list }), [qc]);
  useSocketEvent('message:new', refreshList);
  useSocketEvent('conversation:receipt', refreshList);
  useOnReconnect(refreshList);

  return (
    <div className="mx-auto max-w-content">
      <h1 className={cn('mb-4 text-2xl font-bold tracking-tight', id && 'sr-only md:not-sr-only')}>Messages</h1>
      <div className="grid min-h-[70svh] overflow-hidden rounded-panel border border-hairline-strong bg-surface-raised md:grid-cols-[--spacing(80)_minmax(0,1fr)]">
        <nav aria-label="Conversations" className={cn('border-hairline-strong md:border-r', id && 'hidden md:block')}>
          {list.isPending ? (
            <PageLoading />
          ) : list.isError ? (
            <LoadFailed message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
          ) : list.data.items.length === 0 ? (
            <div className="p-5 text-small text-text-2">
              No conversations yet. Open someone’s profile and choose <strong>Message</strong> to start one.
            </div>
          ) : (
            <ul>
              {list.data.items.map((c) => (
                <ConversationLink key={c.id} c={c} active={c.id === id} />
              ))}
            </ul>
          )}
        </nav>
        <section className={cn('min-w-0', !id && 'hidden md:flex md:items-center md:justify-center')} aria-label="Conversation">
          {id ? <Thread key={id} id={id} /> : <p className="p-6 text-small text-text-2">Choose a conversation.</p>}
        </section>
      </div>
    </div>
  );
}

function ConversationLink({ c, active }: { c: ConversationView; active: boolean }) {
  return (
    <li>
      <Link
        to={`/messages/${c.id}`}
        aria-current={active ? 'page' : undefined}
        className={cn('flex gap-3 border-b border-hairline-strong px-4 py-3 hover:bg-surface-overlay', active && 'bg-surface-overlay')}
      >
        <Avatar name={c.other.name} image={c.other.image} className="size-10 shrink-0 text-xs" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-small', c.unread ? 'font-bold text-text-1' : 'font-semibold text-text-1')}>
              {c.other.name}
            </span>
            {c.lastMessage && <span className="shrink-0 text-caption text-text-3">{timeAgo(c.lastMessage.createdAt)}</span>}
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={cn('truncate text-caption', c.unread ? 'text-text-1' : 'text-text-2')}>
              {c.lastMessage ? `${c.lastMessage.mine ? 'You: ' : ''}${c.lastMessage.body}` : 'No messages yet'}
            </span>
            {c.unread > 0 && (
              <span className="shrink-0 rounded-full bg-signal px-1.5 text-xs font-bold text-on-signal">
                {c.unread}
                <span className="sr-only"> unread</span>
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** A message on its way: shown immediately, retried with the SAME client id, never duplicated. */
type Outgoing = { clientId: string; body: string; state: 'sending' | 'failed'; error?: string };
const PAGE = 30;

function Thread({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const conversation = useQuery({ queryKey: messagingKeys.conversation(id), queryFn: () => messagingApi.conversation(id) });
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [text, setText] = useState(() => drafts.get(id));
  const [online, setOnline] = useState(() => navigator.onLine);
  const [live, setLive] = useState(() => getSocket().connected);
  const bottom = useRef<HTMLDivElement>(null);

  // Merge by id, keep chronological order; a pushed copy of a message we already have is ignored.
  const merge = useCallback((incoming: MessageView[]) => {
    setMessages((cur) => {
      const byId = new Map(cur.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    });
    setOutgoing((cur) => cur.filter((o) => !incoming.some((m) => m.mine && m.clientId === o.clientId)));
  }, []);

  const load = useCallback(async () => {
    try {
      const page = await messagingApi.messages(id, { limit: PAGE });
      merge(page.items);
      setHasMore(page.hasMore);
      setLoaded(true);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [id, merge]);
  useEffect(() => void load(), [load]);

  // Catch up over REST after any reconnect: sockets don't replay what we missed.
  const latestId = messages.at(-1)?.id;
  const catchUp = useCallback(async () => {
    setLive(true);
    if (!latestId) return void load();
    try {
      const page = await messagingApi.messages(id, { after: latestId, limit: 50 });
      merge(page.items);
    } catch {
      /* the next reconnect or refresh will try again */
    }
    void qc.invalidateQueries({ queryKey: messagingKeys.conversation(id) });
  }, [id, latestId, load, merge, qc]);
  useOnReconnect(catchUp);

  useSocketEvent<MessageView>(
    'message:new',
    useCallback(
      (m) => {
        if (m.conversationId !== id) return;
        merge([m]);
        if (!m.mine) void messagingApi.delivered(id, m.id).catch(() => {});
      },
      [id, merge],
    ),
  );
  useSocketEvent<{ conversationId: string }>(
    'conversation:receipt',
    useCallback((r) => r.conversationId === id && void qc.invalidateQueries({ queryKey: messagingKeys.conversation(id) }), [id, qc]),
  );

  useEffect(() => {
    const s = getSocket();
    const down = () => setLive(false);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    s.on('disconnect', down);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      s.off('disconnect', down);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Read receipts: mark the newest incoming message read while this thread is open and visible.
  const newestTheirs = useMemo(() => [...messages].reverse().find((m) => !m.mine), [messages]);
  useEffect(() => {
    if (!newestTheirs || document.visibilityState !== 'visible') return;
    void messagingApi
      .read(id, newestTheirs.id)
      .then(() => qc.invalidateQueries({ queryKey: messagingKeys.list }))
      .catch(() => {});
  }, [id, newestTheirs, qc]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, outgoing.length]);

  async function deliver(o: Outgoing) {
    setOutgoing((cur) => cur.map((x) => (x.clientId === o.clientId ? { ...x, state: 'sending', error: undefined } : x)));
    try {
      const saved = await messagingApi.send(id, o.clientId, o.body);
      merge([saved]);
      void qc.invalidateQueries({ queryKey: messagingKeys.list });
      void qc.invalidateQueries({ queryKey: messagingKeys.conversation(id) });
    } catch (e) {
      setOutgoing((cur) => cur.map((x) => (x.clientId === o.clientId ? { ...x, state: 'failed', error: errorMessage(e) } : x)));
      void qc.invalidateQueries({ queryKey: messagingKeys.conversation(id) });
    }
  }

  function submit() {
    const body = text.trim();
    if (!body) return;
    const o: Outgoing = { clientId: newClientId(), body, state: 'sending' };
    setOutgoing((cur) => [...cur, o]);
    setText('');
    drafts.set(id, '');
    void deliver(o);
  }

  async function older() {
    const first = messages[0];
    if (!first) return;
    const page = await messagingApi.messages(id, { before: first.id, limit: PAGE });
    merge(page.items);
    setHasMore(page.hasMore);
  }

  if (conversation.isPending) return <PageLoading />;
  if (conversation.isError) return <LoadFailed message={errorMessage(conversation.error)} onRetry={() => void conversation.refetch()} />;
  const c = conversation.data;
  const lastMine = [...messages].reverse().find((m) => m.mine);
  const receipt = lastMine
    ? c.otherReadAt && c.otherReadAt >= lastMine.createdAt
      ? 'Read'
      : c.otherDeliveredAt && c.otherDeliveredAt >= lastMine.createdAt
        ? 'Delivered'
        : 'Sent'
    : null;

  return (
    <div className="flex h-[70svh] flex-col">
      <header className="flex items-center gap-3 border-b border-hairline-strong px-4 py-3">
        <Button
          variant="quiet"
          size="icon"
          className="md:hidden"
          aria-label="Back to conversations"
          onClick={() => void navigate('/messages')}
        >
          <ArrowLeft />
        </Button>
        <Link to={`/u/${c.other.username}`} className="flex min-w-0 flex-1 items-center gap-3 hover:text-signal">
          <Avatar name={c.other.name} image={c.other.image} className="size-9 text-xs" />
          <span className="truncate font-semibold">{c.other.name}</span>
        </Link>
        {(!online || !live) && (
          <span className="inline-flex items-center gap-1 text-caption text-warning" role="status">
            <WifiOff aria-hidden className="size-3.5" /> {online ? 'Reconnecting…' : 'Offline'}
          </span>
        )}
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" aria-live="polite" aria-relevant="additions">
        {hasMore && (
          <div className="text-center">
            <Button size="sm" variant="ghost" onClick={() => void older()}>
              Load earlier messages
            </Button>
          </div>
        )}
        {!loaded && !loadError && <PageLoading />}
        {loadError && <LoadFailed message={loadError} onRetry={() => void load()} />}
        {loaded && messages.length === 0 && outgoing.length === 0 && (
          <EmptyState title={`Say hello to ${c.other.name}`}>Messages are private between the two of you.</EmptyState>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {outgoing.map((o) => (
          <div key={o.clientId} className="flex flex-col items-end">
            <p
              className={cn(
                'max-w-[85%] rounded-panel px-3.5 py-2 text-small whitespace-pre-line',
                o.state === 'failed' ? 'border border-danger/50 bg-surface-overlay text-text-1' : 'bg-signal/70 text-on-signal',
              )}
            >
              {o.body}
            </p>
            {o.state === 'sending' ? (
              <span className="mt-0.5 text-caption text-text-3">Sending…</span>
            ) : (
              <span className="mt-0.5 inline-flex items-center gap-1 text-caption text-danger">
                <CircleAlert aria-hidden className="size-3.5" /> Not sent{o.error ? `: ${o.error}` : ''}
                <Button size="sm" variant="quiet" onClick={() => void deliver(o)}>
                  <RotateCw /> Retry
                </Button>
              </span>
            )}
          </div>
        ))}
        {receipt && outgoing.length === 0 && <p className="text-right text-caption text-text-3">{receipt}</p>}
        <div ref={bottom} />
      </div>

      {c.blocked ? (
        <p className="border-t border-hairline-strong px-4 py-3 text-small text-text-2">You can’t message each other.</p>
      ) : (
        <form
          className="border-t border-hairline-strong p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {c.sendLimitNote && <p className="mb-2 text-caption text-text-2">{c.sendLimitNote}</p>}
          <div className="flex items-end gap-2">
            <Textarea
              aria-label={`Message ${c.other.name}`}
              value={text}
              rows={2}
              maxLength={4000}
              disabled={!c.canSend}
              onChange={(e) => {
                setText(e.target.value);
                drafts.set(id, e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={c.canSend ? 'Write a message' : 'Waiting for a reply'}
              className="min-h-11 flex-1 resize-none"
            />
            <Button type="submit" size="icon" aria-label="Send" disabled={!c.canSend || !text.trim()}>
              <Send />
            </Button>
          </div>
          {!online && <p className="mt-1 text-caption text-text-3">You’re offline. Your draft is saved; sending needs a connection.</p>}
        </form>
      )}
    </div>
  );
}

function Bubble({ m }: { m: MessageView }) {
  if (m.kind === 'COLLABORATION') {
    return (
      <div className="mx-auto max-w-md rounded-panel border border-control-border bg-surface-overlay p-3 text-small">
        <p className="inline-flex items-center gap-2 font-semibold text-text-1">
          <Handshake aria-hidden className="size-4 text-signal" /> Collaboration
        </p>
        <p className="mt-1 whitespace-pre-line text-text-2">{m.body}</p>
        {m.collaborationRequestId && (
          <Link
            to={`/collaborate/requests/${m.collaborationRequestId}`}
            className="mt-2 inline-block text-signal underline-offset-2 hover:underline"
          >
            Open the request
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start')}>
      <p
        className={cn(
          'max-w-[85%] rounded-panel px-3.5 py-2 text-small whitespace-pre-line break-words',
          m.removed
            ? 'border border-hairline-strong text-text-3 italic'
            : m.mine
              ? 'bg-signal text-on-signal'
              : 'bg-surface-overlay text-text-1',
        )}
      >
        {m.body}
      </p>
      <span className="mt-0.5 flex items-center gap-1 text-caption text-text-3">
        <time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>
        {!m.mine && !m.removed && <ReportButton targetType="MESSAGE" targetId={m.id} compact />}
      </span>
    </div>
  );
}
