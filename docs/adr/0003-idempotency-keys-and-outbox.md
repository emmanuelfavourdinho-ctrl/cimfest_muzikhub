# ADR 0003 — Idempotency keys and the outbox pattern

- **Status:** accepted (2026-11-24, M0; owner asked for these before later milestones)
- **Context:** later milestones depend on not doing things twice or losing them:
  - payments: duplicate callbacks, checkout retries;
  - messaging: retries and reconnects (FR-53);
  - offline sync: replayed operations (FR-71, FR-72);
  - notifications: created only if the change committed.

## 1. Idempotency-Key (server) — `apps/api/src/middleware/idempotency.ts`

Follows the IETF draft "The Idempotency-Key HTTP Header Field".

- **Storage:** table `idempotency_key`, unique on (userId, key), with a 24 h TTL swept hourly. It also stores the request hash (method, path, body), status and the stored response.

**Behaviour:**

| Situation | Result |
|---|---|
| No header | Runs normally. Routes can require the header with `idempotent({ required: true })`, which payments and message sends will use |
| First use | Runs; a 2xx response is stored |
| Same key, same request | Stored response replayed, with `Idempotent-Replayed: true` |
| Same key, different request | `422 IDEMPOTENCY_KEY_REUSED` |
| Same key while the first is running | `409 IDEMPOTENCY_IN_PROGRESS` + `Retry-After` |
| Non-2xx result | Key released, so the client may retry with it |

- **Applied now to:** `POST /posts`, `POST /posts/:id/comments`, `POST /connections`, `POST /reports`.
- **Will be required for:** payments (M10), message send (M9), applications and entries (M7/M8), and every offline-synced write (M11).
- **Web client:** `request(..., { idempotencyKey })`. The feed composer uses one key per distinct post, so a double tap or a retry after a dropped connection can't post twice, while edited content gets a new key.

## 2. Transactional outbox (server) — `apps/api/src/lib/outbox.ts`

- **Writing:** `enqueue(tx, topic, payload)` inside the **same transaction** as the change, so the event exists if and only if the change committed.
- **Delivery:** a worker in `server.ts` runs every 2 s. It claims due events with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, which is safe with several instances, runs the topic's handler, and marks the event `DONE`.
- **Failures:** retry with exponential backoff (2^n s, capped at 30 min) and ±20% jitter. After 8 attempts the event becomes `FAILED` and is kept for inspection. Events left `PROCESSING` for more than 5 min (a crashed worker) are reclaimed.
- **Handlers must be idempotent.** After a crash, delivery is at least once. A handler typically writes a notification row with a unique (eventId) constraint.
- **First users:** in-app notifications and notification emails (M4), then realtime fan-out (M9).

## 3. Client outbox for offline (design for M11)

- **Storage:** IndexedDB store `outbox`. Each entry has a `{ id, idempotencyKey, method, path, body, createdAt, state }`.
- **States:** `pending → syncing → synced | failed`, visible in the UI and retryable or discardable (FR-70).
- **Replay:** on `online`, on app open and on a timer, entries replay in order with their **original** idempotency key, so a write that actually reached the server before the connection dropped is replayed, not duplicated (FR-71, FR-72). Background Sync is used where available, but iOS Safari lacks it, so we never depend on it.
- **Live-only operations** are never queued: payments, calls, moderation (FR-73).
- **Sign-out** clears the outbox and caches.

## Consequences

- One extra write per keyed request (two with completion), cheap compared with a duplicate payment or message.
- The outbox adds a small amount of polling (one indexed query every 2 s per instance).
- The new tables have no foreign key to `user`. Keys expire within 24 h, and events reference ids in their payload.
