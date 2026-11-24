# MuzikHub product spec (summary)

The full source of truth is [`CLAUDE.md`](../CLAUDE.md), with the SRS v1.0 for numbered requirements (FR-xx). This page summarises the agreed scope.

**Vision:** a professional music-industry networking and discovery platform — profiles, creative work, discovery, relationships, communities, collaboration and opportunities in one connected experience. Basic participation is free.

## Users

- **Primary use** (chosen at sign-up): Artist/creator · Fan · Industry professional.
- **Professional roles** (any number per person): artist, singer, rapper, songwriter, producer, beatmaker, DJ, audio/recording/mixing engineer, composer, instrumentalist, dancer, manager, record label, promoter, event organiser, marketer, talent scout, other.
- **Platform roles:** user, moderator, admin (global; finance admin deferred until payments). **Community roles** (future): owner, admin, moderator, member, scoped to one community and never granting platform access.
- **Account states:** active · restricted (read-only) · suspended (temporary, with a reason and end date) · banned (indefinite) · deactivated.

## Agreed scope (decision of 2026-11-23: union of CLAUDE.md, master prompt and SRS)

1. Accounts, authentication, onboarding
2. Professional profiles with external platform links
3. Creative portfolios
4. Main feed (a core discovery surface)
5. Search and discovery (real data only)
6. Following **and** connection requests
7. Communities with scoped roles and moderation
8. Structured collaboration requests
9. Opportunities
10. Competitions and challenges
11. Real-time messaging (Socket.IO, persisted, offline queue)
12. Notifications
13. Audio/video calls (WebRTC + TURN)
14. Promotions and Notch Pay payments (prices pending approval)
15. **Admin Console** (`/admin`): a dedicated platform-management and trust-and-safety console. It covers the overview, user management, content moderation, the reports queue, community/competition/opportunity oversight, financial oversight, platform management and append-only audit logs, with least-privilege roles. Confirmed and approved on 2026-11-24 (CLAUDE.md §19.3–19.4). Phases 1–4 implemented: permissions, two-factor for staff, audit log, first-admin CLI, user management, reports and content moderation, overview. Finance, announcements and community/competition/opportunity oversight are deferred to their milestones.
16. Offline/PWA resilience

## Core journeys

Register → set up profile → showcase work → appear in feed/discovery → follow/connect → join communities → collaborate → find opportunities/competitions → message/call → optionally promote (paid) → moderation keeps it safe.

## Confirmed infrastructure and design decisions

| Decision | Date | Status |
|---|---|---|
| Landing hero = the owner's five supplied photographs as a cinematic sequence, hosted on Cloudinary (CLAUDE.md §20.6) | 2026-11-24 | Implemented |
| Resend for password-reset and verification email; verification optional for now (CLAUDE.md §5.1) | 2026-11-24 | Implemented; production sending domain pending |
| Supabase PostgreSQL (Free plan) as the hosted database; Express + Prisma unchanged (CLAUDE.md §27.3) | 2026-11-24 | Configuration documented; not deployed |
| Admin Console as a core pillar (CLAUDE.md §19.3) | 2026-11-24 | Phases 1–4 implemented; finance/announcements deferred |
| Account states RESTRICTED / SUSPENDED / BANNED; moderator limits; required staff 2FA; FINANCE_ADMIN deferred (CLAUDE.md §19.4) | 2026-11-24 | Implemented |

## Not decided — do not invent

Final prices and plans (the proposed FCFA prices in CLAUDE.md are **pending approval**), fee allocation, the production email sending domain and sender address, and the finance-administration permission model (to be designed with payments).
