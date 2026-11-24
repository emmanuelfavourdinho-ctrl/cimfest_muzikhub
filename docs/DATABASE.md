# MuzikHub database

PostgreSQL + Prisma 7. Schema: `apps/api/prisma/schema.prisma`. Every change goes through a migration in `apps/api/prisma/migrations/` — no manual edits.

## Implemented (migrations `init_auth` → `identity_and_profiles` → `media_and_portfolio` → `feed_and_relationships`)

```text
User 1──1 Profile ──avatar/cover──> MediaAsset
User 1──* MediaAsset            (owner; file lives in Cloudinary)
User 1──* PortfolioItem ──media/cover──> MediaAsset
User 1──* Post 1──* PostMedia ──> MediaAsset
          Post *──1 PortfolioItem   (SHOWCASE posts; deleted with the item)
          Post 1──* PostLike, Comment
User *──* User via Follow           (one-way)
User *──* User via Connection       (mutual, with status history)
User 1──* Report
```

| Table | Purpose | Key rules |
|---|---|---|
| `user`, `session`, `account`, `verification` | Identity (Better Auth) + username, primaryUse, platformRole, status | unique email/username; role/status server-controlled |
| `profile` | 1:1 profile | `avatarAssetId`/`coverAssetId` unique FKs; GIN on roles/genres |
| `profile_link` | External links | unique (profile, url); platform derived server-side |
| `media_asset` | Our record of a Cloudinary file | `publicId` unique; status PENDING → READY (verified) → DELETING; each asset fills **one** slot (unique FKs on profile/portfolio/post_media) |
| `portfolio_item` | A piece of work | status DRAFT/PUBLISHED/ARCHIVED; visibility PUBLIC/PRIVATE; GIN on genres |
| `post`, `post_media` | Feed posts | type TEXT/IMAGE/AUDIO/VIDEO/SHOWCASE; index (createdAt desc, id desc) for cursor paging |
| `post_like` | Likes | PK (post, user) → one like per person |
| `comment` | Comments | index (post, createdAt) |
| `report` | Moderation reports | unique (reporter, targetType, targetId) |
| `follow` | One-way follows | PK (follower, following); **CHECK** no self-follow |
| `connection` | Mutual connections | status PENDING/ACCEPTED/DECLINED/CANCELLED/REMOVED; **CHECK** no self-connection; **partial unique index** on (LEAST, GREATEST) of the pair WHERE status IN (PENDING, ACCEPTED) — at most one live connection per pair, even under races |

All counts (followers, likes, comments, connections, published work) are computed from rows, never stored.

## Planned

| Milestone | Tables |
|---|---|
| 3 — Communities, collaboration, opportunities, competitions | `Community` · `CommunityMember` (OWNER/ADMIN/MODERATOR/MEMBER) · `CommunityPost` · `CollaborationRequest` · `CollaborationInterest` · `Opportunity` · `OpportunityApplication` · `Competition` · `CompetitionEntry` |
| 4 — Communication | `Conversation` · `ConversationParticipant` · `Message` (unique `clientId`) · `Notification` · `Block` · `CallSession` |
| 5 — Business & operations | `ServiceCatalogue` · `Payment` (price snapshot) · `PaymentEvent` (unique provider event id) · `PromotionCampaign` · `AuditLog` |

## Local databases

| Database | Used by |
|---|---|
| `muzikhub` | `npm run dev` |
| `muzikhub_test` | Vitest integration tests and Playwright — wiped freely |

Both live in the `muzikhub-db` container (`localhost:5435`).
