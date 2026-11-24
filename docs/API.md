# MuzikHub API

Base path for product endpoints: **`/api/v1`**. Authentication (Better Auth): **`/api/auth/*`**.

## Conventions

- JSON in, JSON out. Send cookies (`credentials: 'include'`); there are no bearer tokens.
- Bodies and query strings are validated with Zod schemas from `packages/shared`. Unknown fields on create/update endpoints are rejected.
- **Lists are cursor-paginated**: `?limit=` (1–30, default 12) and `?cursor=` (the previous page's `nextCursor`). Response: `{ items: [...], nextCursor: string | null }`.
- Things you may not see are reported as **404**, not 403 — ids of private items can't be probed.
- Errors are **RFC 9457 problem details** (`Content-Type: application/problem+json`): `{ "type", "title", "status", "detail", "code", "instance?", "errors?" }`. `code` is the stable machine code, `detail` is safe to show users, and `errors` lists field issues for `VALIDATION_ERROR`. Better Auth routes under `/api/auth/*` keep the library's own error format. See `docs/migrations/2026-11-rfc9457-errors.md`.

| Status | Codes | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `MEDIA_INVALID`, `MEDIA_REJECTED`, `MEDIA_NOT_READY`, `NOT_PUBLISHABLE`, `NOT_SHAREABLE`, `CANNOT_*` | Bad input or a rule was broken |
| 401 | `UNAUTHENTICATED` | No valid session |
| 403 | `ACCOUNT_INACTIVE` | Account suspended or deactivated |
| 404 | `*_NOT_FOUND` | Missing, or not visible to you |
| 409 | `CONFLICT`, `UPLOAD_INCOMPLETE`, `MEDIA_IN_USE`, `INVALID_TRANSITION`, `ALREADY_CONNECTED`, `REQUEST_PENDING`, `REQUEST_RECEIVED` | State conflict |
| 429 | `TOO_MANY_PENDING_UPLOADS`, `CONNECTION_COOLDOWN` | Limit reached |
| 503 | `MEDIA_NOT_CONFIGURED` | Cloudinary credentials missing |

## Health & auth

See Milestone 1: `GET /health`; Better Auth at `/api/auth` (`sign-up/email` with `username` + `primaryUse`, `sign-in/email`, `sign-in/username`, `sign-out`, `get-session`, `is-username-available`, `request-password-reset`, `reset-password`).

## Me & profiles

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/me` | ✔ | Own account + profile + `stats` |
| PATCH | `/me/profile` | ✔ | Any subset of profile fields |
| PUT | `/me/profile/links` | ✔ | `{ links: [{ url }] }`, https only, platform derived server-side |
| PUT | `/me/profile/avatar` · `/me/profile/cover` | ✔ | `{ mediaId \| null }` — a READY upload with purpose AVATAR / COVER. The old file is deleted. |
| POST | `/me/onboarding/complete` | ✔ | Idempotent |
| GET | `/profiles/:username` | — | Public profile incl. `image`, `cover`, `stats { followers, following, connections, publishedWork }` |
| GET | `/profiles/:username/portfolio` | optional | Published public work (owner also sees their private published work) |
| GET | `/profiles/:username/posts` | optional | That person's visible posts |

## Media (Cloudinary signed direct upload)

1. `POST /media/uploads` `{ kind: IMAGE|AUDIO|VIDEO, purpose: AVATAR|COVER|PORTFOLIO|POST, bytes, filename? }` → `201 { assetId, uploadUrl, fields, chunked, chunkBytes }`. The signature fixes `public_id`, `allowed_formats` and `overwrite=false`.
2. Browser POSTs `multipart/form-data` (`fields` + `file`) **directly to `uploadUrl`**. If `chunked`, send `chunkBytes` slices with `X-Unique-Upload-Id: <assetId>` and `Content-Range: bytes a-b/total`.
3. `POST /media/:id/confirm` → `MediaView` (delivery URLs). The server checks what Cloudinary actually stored; a mismatch is deleted and returns `MEDIA_REJECTED`. `UPLOAD_INCOMPLETE` means retry shortly.
4. `DELETE /media/:id` — discard your own unused upload (`MEDIA_IN_USE` if attached).

Limits (`packages/shared/src/media.ts`): image 10 MB · audio 50 MB / 20 min · video 100 MB / 10 min. Max 20 unfinished uploads per user.

## Portfolio

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/portfolio` | ✔ | `{ type, title, description?, genres?, credits?, externalUrl?, mediaId?, coverId?, visibility?, featured?, publish?, shareToFeed? }` |
| GET | `/portfolio/:id` | optional | Public if published + public; owner sees everything |
| PATCH | `/portfolio/:id` | owner | Re-validates files on type change; replaced files are deleted; making it PRIVATE removes its feed post |
| POST | `/portfolio/:id/publish` | owner | `{ shareToFeed }` — never creates a second showcase post |
| POST | `/portfolio/:id/archive` | owner | Hidden from everyone but you |
| DELETE | `/portfolio/:id` | owner | Deletes files and its showcase post |
| GET | `/me/portfolio?status=` | ✔ | Studio list (DRAFT/PUBLISHED/ARCHIVED) |

Publish rules: IMAGE needs an image; AUDIO/BEAT/VIDEO need a file **or** a link; PROJECT needs a description or link. Types → media kinds: AUDIO/BEAT → audio, VIDEO → video, IMAGE → image, PROJECT → none (cover only).

## Feed

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/feed?tab=discover\|following` | optional (`following` needs auth) | Newest first. Discover = all visible posts; Following = people you follow + you |
| POST | `/posts` | ✔ | `{ body?, mediaIds? }` — type derived: none → TEXT, 1–4 images → IMAGE, 1 audio → AUDIO, 1 video → VIDEO |
| GET | `/posts/:id` | optional | |
| PATCH | `/posts/:id` | author | `{ body }` (text only) |
| DELETE | `/posts/:id` | author | Deletes its media too |
| PUT / DELETE | `/posts/:id/like` | ✔ | Idempotent → `{ liked, likeCount }` |
| GET / POST | `/posts/:id/comments` | optional / ✔ | Oldest first; `{ body }` ≤ 1000 chars |
| DELETE | `/comments/:id` | comment or post author | |
| POST | `/reports` | ✔ | `{ targetType: POST\|COMMENT\|PORTFOLIO_ITEM\|PROFILE, targetId, reason, details? }` — idempotent; no self-reports |

A post is visible when its author is ACTIVE and any showcased work is still published + public.

## Relationships

| Method | Path | Auth | Notes |
|---|---|---|---|
| PUT / DELETE | `/users/:username/follow` | ✔ | Idempotent → `{ following, followers }` |
| GET | `/users/:username/followers` · `/following` | — | Paginated people |
| GET | `/users/:username/relationship` | optional | `{ isSelf, following, followsYou, connection, canRequestAfter }` |
| GET | `/connections?filter=incoming\|outgoing\|accepted` | ✔ | |
| POST | `/connections` | ✔ | `{ username, message? }` |
| POST | `/connections/:id/accept` · `/decline` | addressee | Only while PENDING |
| POST | `/connections/:id/cancel` | requester | Only while PENDING |
| DELETE | `/connections/:id` | either person | ACCEPTED → REMOVED |

After a **decline**, the requester can re-request after **30 days** (429 `CONNECTION_COOLDOWN` before then). Withdrawing your own request has no cooldown.

## Discovery (public)

| Method | Path | Query |
|---|---|---|
| GET | `/discover/people` | `q` (name, username, bio, location, exact skill), `roles=A,B`, `genres=a,b`, `location` |
| GET | `/discover/work` | `q` (title, description, credits), `types=BEAT,VIDEO`, `genres=` |

Unknown filter values return 400 rather than being ignored. Signed-in viewers get `following` flags on people cards.
