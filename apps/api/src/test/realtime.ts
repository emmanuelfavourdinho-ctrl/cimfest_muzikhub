import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { Express } from 'express';
import { attachRealtime, closeRealtime } from '../lib/realtime.js';
import { newUserInput, ORIGIN } from './helpers.js';

/** A real HTTP server with Socket.IO attached, for realtime integration tests. */
export async function startRealtimeServer(
  app: Express,
  { proxySecret }: { proxySecret?: string } = {},
): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const server = createServer(app);
  attachRealtime(server, [ORIGIN], proxySecret);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    server,
    url,
    close: async () => {
      await closeRealtime();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Signs up and returns the session cookie header (for sockets) plus the supertest agent. */
export async function signUpWithCookie(app: Express) {
  const input = newUserInput();
  const res = await request(app).post('/api/auth/sign-up/email').set('Origin', ORIGIN).send(input);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  const agent = request.agent(app);
  agent.set('Cookie', cookie);
  return { agent, cookie, input, userId: res.body.user.id as string };
}

export function connect(
  url: string,
  cookie?: string,
  { headers = {}, transports = ['websocket'] }: { headers?: Record<string, string>; transports?: ('websocket' | 'polling')[] } = {},
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      path: '/api/realtime',
      transports,
      extraHeaders: { ...(cookie && { Cookie: cookie }), Origin: ORIGIN, ...headers },
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => reject(e));
  });
}

export const nextEvent = <T = unknown>(socket: Socket, event: string, ms = 3000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${event} within ${ms}ms`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
