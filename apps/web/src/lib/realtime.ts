import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { API_BASE } from './api';

/**
 * One shared real-time connection per tab (Socket.IO, cookie-authenticated). It only PUSHES hints
 * and new data; the REST API stays the source of truth, and every screen re-fetches what it
 * missed when the socket (re)connects, because sockets don't replay events missed while offline.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  socket ??= io(API_BASE || window.location.origin, {
    path: '/api/realtime',
    withCredentials: true,
    // Long-polling first, then upgrade to WebSocket where the path allows it. In production the
    // API sits behind Vercel's /api rewrite (setup B), which doesn't carry WebSockets: there the
    // upgrade fails quietly and the connection stays on polling. Locally (Vite proxy) it upgrades.
    transports: ['polling', 'websocket'],
  });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

/** Subscribe to a server event while the component is mounted. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const s = getSocket();
    s.on(event, handler);
    return () => {
      s.off(event, handler);
    };
  }, [event, handler, enabled]);
}

/** Runs on every (re)connect after mount, so screens can catch up over REST on what they missed. */
export function useOnReconnect(handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const s = getSocket();
    s.on('connect', handler);
    return () => {
      s.off('connect', handler);
    };
  }, [handler, enabled]);
}

/** App-wide: keep the notification badge live while signed in. */
export function useRealtimeNotifications(signedIn: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!signedIn) {
      closeSocket();
      return;
    }
    const s = getSocket();
    const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });
    s.on('notification', refresh);
    s.on('connect', refresh);
    return () => {
      s.off('notification', refresh);
      s.off('connect', refresh);
    };
  }, [signedIn, qc]);
}
