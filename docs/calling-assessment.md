# Audio and video calling: assessment (2026-11-24)

**Status: not built. Blocked on infrastructure (decision D4).** No call button, call screen or placeholder exists in the product.

## Why it isn't built

Reliable one-to-one calls in the browser need WebRTC and three pieces of infrastructure:

| Piece | Purpose | MuzikHub today |
|---|---|---|
| Signalling channel | Exchange offers, answers and ICE candidates between the two people | **Available.** The Socket.IO realtime channel (`/api/realtime`, session-authenticated, per-user rooms) built for messaging could carry it. |
| STUN | Lets each browser learn its public address | Public STUN servers exist, but they aren't enough on their own. |
| **TURN** | Relays media when a direct path is impossible: symmetric NAT and carrier-grade NAT, which are common on Cameroonian mobile networks | **Missing.** Render (the API host) cannot run coturn because it needs UDP ports. Decision D4 chose a **managed** TURN provider (for example Cloudflare Calls TURN, Twilio Network Traversal or Metered), with short-lived credentials generated on the server. No provider has been chosen, and no account or credentials exist. |

Without TURN, a large share of calls between mobile users would fail to connect, or connect with no audio (risk R3 in `decisions-and-risks.md`). Shipping that would break the rule against presenting functionality that does not work (CLAUDE.md §1.1), so no calling UI was added.

## What's needed to build it

1. The owner chooses a managed TURN provider (D4) after comparing price, African points of presence and credential API, then creates the account.
2. Server-side environment variables for the provider (never exposed to the browser). The API issues short-lived ICE credentials only to the two participants of an existing conversation, after block and message-policy checks.
3. Then build: an audio-first call between conversation participants, with signalling over the existing realtime channel; ring, accept, decline and timeout states; a "couldn't connect" state that is honest about the failure; a call record in the conversation; rate limits; and Playwright tests using fake media devices.

Estimated effort once a provider exists: one milestone (M12 in the plan).
