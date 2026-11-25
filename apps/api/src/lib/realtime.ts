import type { Server as HttpServer } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { isVisibleStatus } from './account-status.js';
import { auth } from './auth.js';
import { hasProxySecret } from './proxy-gate.js';

/**
 * Real-time push (Socket.IO, decided in the M10 plan). It is a DELIVERY channel only:
 *  - the database is the source of truth; every write goes through the REST API, is persisted,
 *    and only then is pushed here;
 *  - clients catch up over REST after (re)connecting, because sockets don't replay missed events.
 * Connections are authenticated with the same Better Auth session cookie as the API and checked
 * against the allowed web origins. Each user joins only their own room, so nothing private is
 * broadcast to anyone else. Single API instance for release one (in-memory adapter, R9).
 */
let io: Server | null = null;

export function attachRealtime(
  server: HttpServer,
  origins: readonly string[] = env.CORS_ORIGINS,
  proxySecret: string | undefined = env.PROXY_SHARED_SECRET,
) {
  io = new Server(server, {
    path: '/api/realtime',
    cors: { origin: [...origins], credentials: true },
    serveClient: false,
    // Setup B: like the REST API, only requests forwarded by Vercel (lib/proxy-gate.ts).
    ...(proxySecret ? { allowRequest: (req, done) => done(null, hasProxySecret(req, proxySecret)) } : {}),
  });
  // Long-polling responses go through Vercel in setup B: never let them be cached.
  const noStore = (headers: Record<string, string>) => {
    headers['Cache-Control'] = 'no-store';
  };
  io.engine.on('initial_headers', noStore);
  io.engine.on('headers', noStore);
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !origins.includes(origin)) return next(new Error('origin not allowed'));
      const session = await auth.api.getSession({ headers: fromNodeHeaders(socket.request.headers) });
      if (!session || !isVisibleStatus(session.user.status)) return next(new Error('unauthenticated'));
      socket.data.userId = session.user.id;
      next();
    } catch {
      next(new Error('unauthenticated'));
    }
  });
  io.on('connection', (socket) => {
    void socket.join(`user:${socket.data.userId as string}`);
  });
  return io;
}

/** Push an event to every open tab of one user. A no-op when realtime isn't attached (tests, scripts). */
export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Disconnect a user's sockets (e.g. after suspension or sign-out everywhere). */
export function disconnectUser(userId: string) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

export async function closeRealtime() {
  await io?.close();
  io = null;
}
