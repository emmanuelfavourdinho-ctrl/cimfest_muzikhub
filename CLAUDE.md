# MUZIKHUB — MASTER PRODUCT & ENGINEERING INSTRUCTIONS

**Document type:** Product, Design, Architecture and Engineering Source of Truth  
**Project:** MuzikHub  
**Product category:** Music Industry Networking, Discovery and Professional Collaboration Platform  
**Development standard:** Simple, Lovable, Complete (SLC)  
**Primary design direction:** Premium, mobile-first, responsive  
**Frontend deployment:** Vercel  
**Backend deployment:** Render  
**Payment provider:** Notch Pay  
**Status:** Active development

---

# 1. YOUR ROLE AND RESPONSIBILITY

You are acting as the senior product engineer, software architect, UI/UX designer and technical implementation partner responsible for helping build MuzikHub.

Your responsibility is not simply to generate code or make screens look attractive.

Your responsibility is to help deliver a coherent, secure, polished and genuinely functional music-industry platform.

You must understand the product before implementing features.

You must consider how every feature interacts with the rest of the platform, including:

- User accounts and authentication.
- Professional profiles.
- Creative portfolios.
- The main feed.
- Music discovery.
- Following and connections.
- Communities.
- Collaboration requests.
- Opportunities.
- Messaging.
- Notifications.
- Payments.
- Promotions.
- Administration and moderation.
- Media storage.
- Responsive design.
- Security and permissions.

A feature must never be implemented in isolation when it affects another part of the platform.

## 1.1 Non-negotiable engineering principles

1. Never invent product requirements.
2. Never silently change an established product decision.
3. Never create fake functionality.
4. Never present hardcoded information as live platform data.
5. Never mark an incomplete feature as complete.
6. Never introduce unnecessary complexity.
7. Never duplicate existing functionality without investigating the current implementation.
8. Never compromise security for implementation convenience.
9. Never sacrifice mobile usability for desktop appearance.
10. Never introduce visual elements that conflict with MuzikHub's brand identity.
11. Never make assumptions about undecided business rules.
12. Never remove existing functionality without understanding its dependencies and obtaining approval where necessary.

If something is unclear, inspect the existing implementation and documentation first.

If the information is still unavailable, identify the uncertainty and ask for clarification before making a consequential product or architectural decision.

---

# 2. PRODUCT VISION

MuzikHub is a professional music-industry networking and discovery platform.

It brings together people who create, produce, perform, distribute, promote and work within the music industry.

The platform should make it easier for music professionals to:

- Establish a professional identity.
- Showcase their creative work.
- Discover other professionals.
- Explore music and creative projects.
- Build meaningful professional relationships.
- Find collaborators.
- Participate in industry communities.
- Discover relevant opportunities.
- Communicate with other professionals.
- Access optional professional services and promotional tools.

MuzikHub should become a place where music professionals can build their presence, discover talent and create meaningful industry connections.

It is not simply a social media application.

It is not merely a music streaming platform.

It is not a generic freelancer marketplace.

It combines professional identity, creative discovery, networking and collaboration in a single coordinated experience.

## 2.1 Core product philosophy

The platform must prioritize genuine professional value.

Users should be able to:

- Join the platform.
- Create a professional profile.
- Showcase their work.
- Browse the feed.
- Discover other professionals.
- Follow relevant people.
- Participate in communities.
- Build relationships.

These fundamental activities should not require payment.

Monetization should focus on optional professional value, enhanced services and promotional opportunities rather than restricting basic participation.

## 2.2 Product development standard: SLC

Build MuzikHub using the Simple, Lovable, Complete approach.

This means:

**Simple:** Avoid unnecessary features, confusing workflows and excessive complexity.

**Lovable:** Deliver an experience that feels polished, intuitive, responsive and enjoyable.

**Complete:** Ensure that the essential user journeys work from beginning to end.

Do not interpret SLC as permission to build a collection of incomplete demo features.

The first release must deliver complete and dependable core experiences.

---

# 3. PRODUCT SCOPE

The initial platform should concentrate on the following connected areas:

1. Authentication and user accounts.
2. Professional profiles.
3. Creative portfolios and work showcases.
4. Main discovery feed.
5. Search and discovery.
6. Following and professional connections.
7. Communities.
8. Structured collaboration requests.
9. Opportunities.
10. Messaging and notifications.
11. Optional promotional services.
12. Payments through Notch Pay.
13. Administration and moderation.

These areas must work together.

Do not introduce major additional product modules without approval.

In particular, do not independently introduce:

- Paid voting.
- Complex booking marketplaces.
- Internal wallets for users.
- Escrow between users.
- User-to-user money transfers.
- Complex reputation scoring algorithms.
- Unapproved subscription tiers.
- Unapproved commissions.
- Unapproved service prices.
- Unnecessary financial products.

If a feature appears useful but is outside the approved scope, propose it separately rather than silently implementing it.

---

# 4. USER TYPES AND PROFESSIONAL IDENTITIES

MuzikHub must support different categories of music-industry professionals.

Examples include:

- Artists and musicians.
- Singers and vocalists.
- Rappers.
- Songwriters.
- Producers.
- Beatmakers.
- DJs.
- Audio engineers.
- Recording engineers.
- Mixing and mastering engineers.
- Music composers.
- Instrumentalists.
- Music managers.
- Record labels.
- Music promoters.
- Event organizers.
- Music marketers.
- Other relevant music-industry professionals.

The system must support multiple professional identities where appropriate.

Do not assume that every user belongs to only one professional category.

For example:

A user may be both a music producer and an audio engineer.

A user may be an artist and a songwriter.

A user may be a DJ and a music promoter.

Design the data model so professional roles can be represented without creating duplicate accounts.

## 4.1 Professional identity

During onboarding, users should be able to establish their professional identity.

Depending on the selected role, relevant profile fields may include:

- Display name.
- Username.
- Profile photograph.
- Cover image.
- Professional roles.
- Biography.
- Location.
- Genres.
- Skills.
- Experience.
- Professional interests.
- Portfolio.
- External professional links.

Only collect information that has a clear product purpose.

Avoid unnecessarily long onboarding forms.

Where appropriate, allow users to complete and improve their profiles after registration.

---

# 5. AUTHENTICATION AND ACCOUNT MANAGEMENT

Implement proper account authentication and lifecycle management.

Essential functionality includes:

- Registration.
- Login.
- Logout.
- Secure password storage.
- Email verification where configured.
- Password reset.
- Session management.
- Account profile management.
- Account deactivation where supported.
- Appropriate account status handling.

Authentication must be integrated with the actual backend and database.

Do not create frontend-only authentication.

Do not store passwords in plain text.

Do not expose private authentication tokens or secrets to the browser.

If an external email service or environment variable is required, document it.

Never pretend that email verification or password reset works when the required service has not been configured.

Account status and access restrictions must be enforced on the backend, not merely hidden in the interface.

## 5.1 Transactional email — Resend (confirmed 2026-11-24)

**Resend** is the confirmed transactional email provider, initially for **password-reset** and **account-verification** emails.

- Entirely server-side, through the existing mailer (`apps/api/src/lib/mailer.ts`) and the official `resend` SDK. Do not create a second email service.
- Credentials: `RESEND_API_KEY` in `apps/api/.env` only. Never expose it to the frontend, print it, or put a real value in `.env.example`, docs, code or Git.
- Transports by environment: tests capture emails in memory; development prints them to the API console (nothing is sent); production sends through Resend and refuses to start without `RESEND_API_KEY` and `EMAIL_FROM`.
- Never send real emails to real people from development or automated tests. The opt-in live test sends only to Resend's `delivered@resend.dev` sink.
- Email verification is **optional** at the hackathon/initial-deployment stage: users see a banner and can resend the link, but are not blocked.
- **Pending configuration:** the production sending domain, its DNS verification and the production `EMAIL_FROM` address. They will be set up later. Never invent a domain or sender, and never claim an email was delivered without confirmation from Resend.

---

# 6. PROFESSIONAL PROFILES

Professional profiles are a fundamental part of MuzikHub.

Every profile should communicate who the person is, what they do and what kind of work they produce.

A profile should function as a professional identity and creative portfolio.

## 6.1 Profile information

Support relevant information such as:

- Profile image.
- Cover image.
- Display name.
- Unique username.
- Professional roles.
- Biography.
- Location.
- Music genres.
- Skills.
- Experience.
- Creative work.
- Selected portfolio items.
- External links.
- Professional connections.
- Followers and following.
- Relevant opportunities or collaboration information where appropriate.

Do not overcrowd the profile.

Organize information according to its importance.

## 6.2 External profile links

Users must be able to add links to their external professional presence.

Examples include:

- Spotify.
- YouTube.
- SoundCloud.
- Apple Music.
- Instagram.
- TikTok.
- Facebook.
- X.
- Personal websites.
- Other relevant professional platforms.

### Required visual behavior

External links must be presented using the recognizable logo or brand icon of the destination platform.

For example:

- A Spotify link should display the Spotify logo.
- A YouTube link should display the YouTube logo.
- An Instagram link should display the Instagram logo.
- A SoundCloud link should display the SoundCloud logo.

The destination platform's icon must make it immediately clear where the visitor will be redirected.

Do not use the MuzikHub logo as a replacement for the destination platform's logo.

Do not display long, unattractive raw URLs on the profile.

The links should be presented as a coordinated, premium collection of recognizable platform icons.

### Visual requirements

- Use consistent icon sizing.
- Maintain appropriate spacing.
- Align icons carefully.
- Use subtle hover and focus states.
- Provide accessible labels.
- Provide tooltips where useful.
- Ensure the icons remain legible on mobile.
- Avoid overcrowding the profile header.
- Maintain visual balance with the rest of the profile.

Use an appropriate, maintainable icon source or official brand assets.

Do not invent platform logos.

If an official or recognizable icon is unavailable, use a clean generic external-link icon rather than displaying an incorrect logo.

### Functional requirements

Every external link must:

- Be validated.
- Use an allowed URL protocol, normally HTTPS.
- Be stored against the correct user.
- Open the correct destination.
- Be protected against unsafe URL schemes.
- Be manageable by the profile owner.

External links must never redirect to an unintended destination.

---

# 7. CREATIVE PORTFOLIOS AND WORK SHOWCASES

The platform must allow professionals to showcase their actual creative work.

A professional profile should not be limited to text and photographs.

Depending on the content type, users should be able to showcase:

- Audio recordings.
- Beats and instrumentals.
- Songs.
- Music videos.
- Performances.
- Production work.
- Behind-the-scenes content.
- Artwork and visual projects.
- Other relevant creative material.

Support direct media uploads and external media links where appropriate.

Cloudinary is the selected media-storage and delivery service for the initial implementation.

Do not assume that every external link is a direct media file.

Do not attempt to play arbitrary URLs as audio or video.

Use appropriate media handling for supported formats and trusted providers.

## 7.1 Portfolio functionality

Users should be able to:

- Add portfolio items.
- Edit portfolio items.
- Delete their own items.
- Add titles and descriptions.
- Categorize their work.
- Upload supported media.
- Add external media links.
- Preview their work.
- Display selected work on their profile.

Portfolio items must belong to the correct user.

Only authorized users should be able to modify them.

A user must never be able to edit another person's portfolio by manipulating an API request.

---

# 8. THE MAIN FEED — A CORE PRODUCT FEATURE

The feed is one of the most important parts of MuzikHub.

Do not treat it as a secondary social-media feature.

The feed is a major discovery surface through which users explore the creative work, activities and professional presence of other people.

Users must be able to discover:

- Artists.
- Singers.
- Rappers.
- Producers.
- Beatmakers.
- DJs.
- Audio engineers.
- Other music professionals.
- Their creative work.
- Their activities and updates.

The feed must help users discover talent they may not already know.

## 8.1 Feed content

Support relevant post types such as:

- Text updates.
- Audio showcases.
- Beat previews.
- Music releases or work announcements.
- Video content.
- Images.
- Creative project updates.
- Professional announcements.
- Collaboration-related posts.
- Community-related posts where appropriate.

Do not make the feed exclusively text-based.

Creative work should be presented attractively.

## 8.2 Feed functionality

Implement complete functionality for the supported post types.

Depending on the post type, users should be able to:

- Create posts.
- Edit their own posts.
- Delete their own posts.
- View posts.
- Like or react to posts where supported.
- Comment.
- View comment threads.
- Share or copy a post link.
- Visit the author's profile.
- Follow the author.
- Explore the associated creative work.
- Report inappropriate content.

All interactions must be backed by persistent database records.

Do not implement buttons that only change their appearance without performing the corresponding action.

## 8.3 Feed and profile relationship

A post should be associated with its author.

Where a post contains creative work, users should be able to navigate from that post to the relevant professional profile or portfolio item.

A user's profile and their feed activity must remain consistent.

For example:

When an artist publishes a beat or creative showcase, it should be discoverable in the feed.

When a visitor opens the artist's profile, the relevant work should also be accessible through the artist's portfolio or appropriate profile section.

Avoid creating disconnected content systems.

The feed should encourage discovery and navigation throughout MuzikHub.

## 8.4 Feed ranking and discovery

Start with understandable and maintainable ranking rules.

Relevant factors may include:

- Recency.
- Followed accounts.
- Selected professional interests.
- Genres.
- Relevant professional categories.
- Engagement.
- Content relevance.

Do not introduce an elaborate machine-learning recommendation system without an approved requirement and sufficient data.

Do not fabricate engagement counts or popularity indicators.

The initial feed must be useful even when the platform has relatively few users.

Include sensible empty states and discovery suggestions.

---

# 9. SEARCH AND DISCOVERY

MuzikHub must make it easy to find relevant professionals and creative work.

Search and discovery should support the platform's professional nature.

Users should be able to discover professionals by relevant criteria, including:

- Name.
- Username.
- Professional role.
- Genre.
- Skills.
- Location.
- Other appropriate profile information.

Where appropriate, allow users to discover creative work by category or content type.

Search results must be real database results.

Do not use hardcoded sample profiles as production search results.

## 9.1 Discovery experience

The discovery experience should help users find:

- New artists.
- Producers.
- Beatmakers.
- DJs.
- Engineers.
- Other music professionals.
- Interesting creative work.
- Relevant communities.
- Relevant collaboration requests.
- Relevant opportunities.

Keep discovery organized and easy to navigate.

Do not overwhelm users with too many filters at once.

Filters should be meaningful and functional.

---

# 10. FOLLOWING AND PROFESSIONAL CONNECTIONS

Users should be able to build professional relationships.

Implement the approved relationship model consistently.

At minimum, support following and unfollowing where applicable.

If connection requests are part of the implemented product, they must have a proper lifecycle.

A connection request must support appropriate states, such as:

- Pending.
- Accepted.
- Declined.
- Cancelled.

Do not confuse following with a mutually accepted connection.

A follow should not require the other user to approve it unless the product explicitly supports private accounts.

Prevent duplicate relationships.

Prevent users from following or connecting with themselves.

Ensure counts and relationship states are derived from actual database records.

---

# 11. COMMUNITIES

Communities are spaces for ongoing conversations, knowledge-sharing, professional discussion and relationship-building around shared interests.

They should help professionals learn from one another and build stronger industry relationships.

Communities are not merely group-chat rooms.

They should support meaningful, organized participation.

## 11.1 Community functionality

Depending on the approved implementation, communities should support:

- Community creation.
- Community descriptions.
- Community images.
- Community discovery.
- Joining and leaving.
- Community membership.
- Community discussions.
- Posts and comments.
- Community announcements.
- Reporting.
- Moderation.

Community members should be able to discover and participate in relevant discussions.

## 11.2 Community ownership and permissions

Community management must have a proper permission model.

Support the following distinct responsibilities:

### Community owner

The owner is responsible for the community.

The owner should be able to:

- Manage community settings.
- Manage membership.
- Assign or remove community administrators.
- Assign or remove moderators.
- Manage community-level permissions.
- Moderate content.
- Remove inappropriate members.
- Delete the community where permitted.

### Community administrator

Administrators help manage the community.

Their permissions should be explicitly defined and scoped to the communities they administer.

They may be able to:

- Manage community information.
- Manage members within their permitted scope.
- Review reports.
- Moderate content.
- Manage community discussions.
- Perform other explicitly authorized community-management actions.

### Community moderator

Moderators help maintain healthy discussions.

They may be able to:

- Review reported content.
- Remove content where authorized.
- Handle inappropriate discussions.
- Take permitted moderation actions.
- Escalate serious issues to community administrators or owners.

### Community member

Members can participate according to community rules.

They should not automatically receive management permissions.

## 11.3 Permission enforcement

Community permissions must be enforced on the backend.

Do not rely on hiding buttons in the frontend.

Every community-management endpoint must verify:

1. The authenticated user.
2. The target community.
3. The user's membership.
4. The user's role in that community.
5. Whether that role has permission to perform the requested action.

Community administrators and moderators must not automatically receive global platform administrator privileges.

Their authority is limited to their assigned communities.

Do not allow users to grant themselves elevated permissions through manipulated API requests.

---

# 12. STRUCTURED COLLABORATION REQUESTS

MuzikHub should make it easier for music professionals to find and work with one another.

Collaboration requests must be structured rather than being limited to informal posts.

Examples include:

- An artist looking for a producer.
- A producer looking for vocalists.
- A beatmaker looking for artists.
- A DJ looking for event collaborators.
- A songwriter looking for a composer.
- An engineer offering or seeking project collaboration.

## 12.1 Creating a collaboration request

A user should be able to create a request containing relevant information such as:

- Request title.
- Collaboration type.
- Description.
- Required role or skill.
- Genre.
- Project requirements.
- Location where relevant.
- Availability.
- Deadline where applicable.
- Additional instructions.

Only collect fields that make sense for the selected collaboration type.

## 12.2 Collaboration lifecycle

Support the appropriate workflow:

1. A user creates a collaboration request.
2. The request is published or sent to an intended participant.
3. Other professionals discover the request.
4. Interested users express interest.
5. The request owner reviews responses.
6. The owner accepts or declines an expression of interest.
7. The relevant participants can communicate.
8. The request status is updated.

Use explicit status values.

Do not treat an expression of interest as an accepted collaboration.

Do not represent a request as successful before the parties have completed the appropriate acceptance steps.

The interface should make the current state clear to everyone involved.

---

# 13. OPPORTUNITIES

MuzikHub should provide a place for relevant music-industry opportunities.

Examples may include:

- Artist opportunities.
- Music production opportunities.
- Collaboration opportunities.
- Creative project opportunities.
- Industry announcements.
- Relevant professional openings.

The opportunity model must be understandable and maintainable.

Where applicable, support:

- Opportunity title.
- Description.
- Opportunity category.
- Requirements.
- Eligibility.
- Location or remote status.
- Application instructions.
- Deadline.
- Publisher.
- Status.

Users should be able to discover relevant opportunities and access their application instructions.

Do not invent opportunities.

Do not present expired opportunities as active.

If applications are handled externally, make that clear.

Do not introduce a complicated recruitment or hiring system without approval.

---

# 14. MESSAGING AND COMMUNICATION

Professional networking requires communication.

Implement a secure messaging experience between authorized users.

Essential functionality should include:

- Starting a conversation where permitted.
- Viewing conversations.
- Sending messages.
- Receiving messages.
- Persisting messages.
- Displaying message timestamps.
- Handling conversation participants.
- Appropriate unread-message indicators.

Message history must be stored persistently.

Do not use frontend-only message arrays as the final implementation.

## 14.1 Real-time communication

Real-time delivery may be implemented using an appropriate technology such as Server-Sent Events or WebSockets.

Choose based on the actual requirements and existing architecture.

Do not assume that real-time delivery exists simply because messages can be stored.

If real-time delivery is unavailable, implement reliable refresh or polling behavior and clearly document the limitation.

For Server-Sent Events, remember that the browser-to-server actions still use normal authenticated API requests. SSE is a server-to-client delivery channel.

## 14.2 Messaging security

Users must not be able to access conversations they do not belong to.

Every message endpoint must verify conversation membership.

Do not expose private messages through public profile or feed endpoints.

---

# 15. NOTIFICATIONS

Notifications should help users understand relevant activity.

Examples include:

- New followers.
- Connection requests.
- Connection acceptance.
- Likes or reactions.
- Comments.
- Collaboration interest.
- Collaboration acceptance or rejection.
- Community activity.
- New messages.
- Relevant opportunity updates.
- Payment confirmations where applicable.

Notifications must be generated from actual events.

They must not be fabricated in the frontend.

Support:

- Persistent notification records.
- Read and unread states.
- Appropriate notification navigation.
- Relevant timestamps.
- Reasonable notification grouping where useful.

Avoid overwhelming users with unnecessary notifications.

---

# 16. MONETIZATION AND BUSINESS MODEL

MuzikHub must be financially sustainable without making basic participation difficult.

The core principle is:

**Users should be able to establish their presence, showcase their work, discover talent and build relationships without being forced to pay.**

The platform should monetize optional professional value.

Potential monetization categories include:

- Optional promotional services.
- Paid visibility opportunities.
- Professional services offered through the platform.
- Other approved paid services.

These are monetization directions, not permission to invent final products or prices.

## 16.1 Pricing is not finalized

The prices for MuzikHub's different services have not yet been decided.

This is an important product decision.

DO NOT:

- Invent subscription prices.
- Invent service fees.
- Invent platform commissions.
- Invent promotional prices.
- Apply a universal commission to every transaction.
- Hardcode speculative pricing throughout the application.
- Display prices as officially approved when they are not.

Where a service needs a price during development, use clearly identified configuration placeholders or test values.

Do not present those values as real commercial prices.

## 16.2 Pricing design requirements

The future pricing model must consider both the customer and the platform.

Every paid service should be evaluated using:

1. The value delivered to the customer.
2. The customer's ability and willingness to pay.
3. The cost of delivering the service.
4. Payment-provider charges.
5. Media or infrastructure costs where relevant.
6. Operational and administrative costs.
7. Taxes and applicable obligations.
8. The platform's sustainable margin.

Pricing should be reasonable, understandable and transparent.

Customers must know what they are paying for.

Avoid hidden charges.

The platform must not sell services at a price that creates unsustainable losses.

## 16.3 Centralized pricing configuration

Design the system so approved prices can be managed centrally.

Do not scatter service prices throughout frontend components and backend business logic.

Use an appropriate service catalogue and pricing configuration.

Each service should have an identifiable:

- Name.
- Description.
- Price.
- Currency.
- Availability status.
- Applicable charges.
- Relevant service rules.

When a customer begins a purchase, preserve a snapshot of the agreed price and service details.

A later pricing update must not silently change an already initiated purchase.

---

# 17. PAYMENT INTEGRATION — NOTCH PAY

Notch Pay is the selected payment provider for MuzikHub.

Use Notch Pay for the approved payment collection workflows.

Do not independently introduce another payment provider without approval.

## 17.1 Payment flow

The intended flow is:

1. A customer selects a paid MuzikHub service.
2. The backend retrieves the approved service price.
3. The backend creates a payment request through Notch Pay.
4. The customer completes payment through the Notch Pay checkout experience.
5. Notch Pay processes the payment.
6. Notch Pay sends the appropriate payment confirmation to MuzikHub.
7. MuzikHub verifies the payment.
8. The corresponding service is activated or fulfilled.

Payment confirmation must be based on verified provider information.

Never activate a paid service merely because the browser displays a success message.

## 17.2 Notch Pay balance and settlement

MuzikHub accepts the Notch Pay balance model.

Collected funds may remain in the MuzikHub merchant's Notch Pay account balance.

This is acceptable.

The platform does not need to build its own internal wallet or escrow system.

Understand the distinction:

- Notch Pay is the payment provider.
- The Notch Pay merchant balance is maintained by the provider.
- MuzikHub records the payment and its status.
- The merchant can manage withdrawals and settlement through Notch Pay's supported processes.

The intended receiving destination for withdrawals is the MuzikHub merchant's MTN Mobile Money account, subject to Notch Pay's available withdrawal options and merchant configuration.

Do not claim that funds are deposited directly into MTN at the instant of customer payment if they first enter the Notch Pay balance.

Do not confuse the customer's payment method with the merchant's withdrawal destination.

Do not build:

- A MuzikHub wallet.
- Escrow.
- Internal user balances.
- User-to-user transfers.
- Artist payout infrastructure.
- Multi-vendor payment splitting.
- A system that holds money on behalf of other users.

Unless explicitly approved later, MuzikHub is collecting payment for its own approved services, not operating a fund-custody marketplace.

## 17.3 Payment security

Payment integration must be implemented on the backend.

Never expose private Notch Pay credentials in frontend code.

Use environment variables for secrets.

Implement:

- Payment initiation.
- Provider reference storage.
- Payment status tracking.
- Webhook processing.
- Webhook signature verification.
- Duplicate webhook protection.
- Idempotent payment handling.
- Failed-payment handling.
- Cancelled-payment handling.
- Expired-payment handling.
- Successful-payment handling.
- Reconciliation where appropriate.

Verify Notch Pay webhook signatures according to the current official documentation.

Use the correct request body and signature verification process.

Do not assume that a webhook is authentic simply because it reaches the endpoint.

Do not process the same successful payment multiple times.

## 17.4 Payment records

Store enough information to reconcile payments.

Relevant fields may include:

- Internal payment ID.
- User ID.
- Service ID.
- Amount.
- Currency.
- Provider reference.
- Provider transaction identifier where available.
- Payment status.
- Payment creation timestamp.
- Payment confirmation timestamp.
- Relevant metadata.

Never store unnecessary sensitive payment information.

## 17.5 Payment-provider charges

Notch Pay charges must be considered when MuzikHub finalizes service prices.

Do not silently assume that the platform receives the entire amount paid by the customer.

Distinguish:

- MuzikHub's service selling price.
- Notch Pay collection charges.
- Withdrawal or transfer charges.
- Applicable taxes.
- MuzikHub's operational costs.
- MuzikHub's final margin.

The final fee allocation between MuzikHub and the customer is not yet decided.

Do not implement a fee allocation policy without approval.

## 17.6 Test and production environments

Use the appropriate Notch Pay test environment during development.

Never use real customer funds for unverified test workflows.

Production payment credentials must be configured securely.

Document all required environment variables without including actual secret values.

---

# 18. PROMOTIONAL SERVICES

MuzikHub may offer optional paid promotional services.

The purpose is to give professionals additional opportunities to reach relevant audiences.

Promotion must not undermine organic discovery.

The platform must remain useful for users who do not pay.

Promotional functionality should be designed transparently.

Where paid promotion is implemented, users should understand:

- What is being promoted.
- The intended audience.
- The duration.
- The service price.
- The expected placement or visibility.
- The campaign status.

Do not promise guaranteed engagement, streams, followers or commercial results.

Do not fabricate campaign performance.

Paid content must be distinguishable from organic content.

Do not implement promotional pricing until approved.

---

# 19. ADMINISTRATION AND PLATFORM GOVERNANCE

MuzikHub requires a secure administration system.

Platform administrators are responsible for managing the overall platform.

Depending on approved roles, administration may include:

- User management.
- Account restrictions.
- Reports and moderation.
- Content moderation.
- Community oversight.
- Payment records.
- Service management.
- Platform settings.
- Audit logs.

## 19.1 Role separation

Distinguish global platform roles from community-specific roles.

Examples of global platform roles may include:

- ADMIN.
- MODERATOR.
- FINANCE_ADMIN.

Only implement roles that are required by the approved permission model.

A community moderator is not automatically a platform moderator.

A community administrator is not automatically a platform administrator.

## 19.2 Backend enforcement

Every privileged action must be authorized by the backend.

Frontend visibility is not security.

Never trust a role supplied by the browser.

Prevent privilege escalation.

Record important administrative actions in an audit log where appropriate.

## 19.3 Admin Console — confirmed product requirement (2026-11-24)

MuzikHub must have a **complete, dedicated Admin Console** at `/admin`, with its own layout, navigation, access control and working management workflows. It is part of the product, not an optional extra, and must not be confused with the ordinary user dashboard.

Scope: operational overview (real data only), user management (search, filter, suspend, reinstate, ban, with recorded reasons), content moderation (posts, portfolio, media, comments), a central reports queue (pending, under review, resolved, dismissed; assignment, internal notes, escalation), community oversight, competitions and opportunities oversight, payment and financial oversight (verified backend data only, live-updating where supported), platform management, and **append-only audit logs**.

Rules:

- A role-based permission model separate from professional identity. Least privilege: a community moderator manages only their community; a platform moderator has no financial or global-configuration access; a finance administrator has only financial permissions.
- Administrative roles are assigned only by authorised administrators through server-side workflows, never through registration or any client-supplied field.
- Every admin endpoint is authorised on the server, rate-limited, validated and audited. Hiding a button is not authorisation.
- No fake statistics, dead buttons or screens without a working backend workflow. Sections that depend on unbuilt pillars (communities, competitions, opportunities, payments) appear only when those pillars exist, or are clearly marked as pending.
- Admins must never silently alter competition outcomes, submissions or payment records. Any such action needs a recorded reason and an audit entry.

### 19.4 Approved decisions and implementation (2026-11-24)

The plan was approved on 2026-11-24, and phases 1–4 are **implemented** (see `docs/ARCHITECTURE.md` §5e and `docs/IMPLEMENTATION_STATUS.md`).

- **Account states** (server-enforced): `ACTIVE`; `RESTRICTED` (can sign in and browse; cannot publish, interact, message or collaborate); `SUSPENDED` (mandatory reason and end date, sessions revoked, reinstated automatically at expiry); `BANNED` (indefinite, sessions revoked, only an ADMIN may reinstate); `DEACTIVATED`.
- **Platform roles:** `USER`, `MODERATOR`, `ADMIN`. **`FINANCE_ADMIN` is deferred** until payments exist. The single permission matrix lives in `packages/shared/src/admin.ts`.
- **Moderators may:** manage reports, remove and restore content (reason required), restrict accounts, and suspend for **at most 30 days**. **Moderators may not:** ban, reinstate a ban, assign roles, change platform settings, see email addresses or access financial information. Escalated reports are decided by an ADMIN.
- Nobody may act on their own account or on staff of the same or a higher role. Admins cannot change their own role, and at least one ADMIN always remains (serializable transaction).
- **Two-factor authentication** (Better Auth `twoFactor` plugin, TOTP plus single-use backup codes) is **required for all staff** and optional for everyone else. "Trust this device" is disabled.
- **Fresh authentication** (a session under 15 minutes old) is required for bans, ban reinstatements, role changes and two-factor resets.
- **Audit log:** append-only, enforced by database triggers. It records actor, role, action, target, reason, before/after state and IP.
- **First administrator:** granted only through `npm run admin:grant-initial -w @muzikhub/api -- --email …` (an existing, verified account; refuses if an admin exists; idempotent; audited). There is no HTTP route that creates administrators. Last-resort recovery: `npm run admin:reset-two-factor -w @muzikhub/api`.
- **Deferred:** platform announcements (shown as a disabled "Pending" entry), finance administration (with payments), and community, competition and opportunity oversight (with those pillars).

---

# 20. BRAND IDENTITY AND VISUAL DESIGN SYSTEM

MuzikHub must maintain a strict and consistent visual identity throughout the entire platform.

The established brand palette is:

- Deep Forest.
- Emerald.
- Mint.
- Off White.

These are the approved brand directions.

Do not independently introduce unrelated primary color systems.

Do not turn the platform into a generic blue-and-purple SaaS interface.

Do not use random gradients, decorative colors or inconsistent component styling.

## 20.1 Visual identity principles

The platform should feel:

- Premium.
- Modern.
- Professional.
- Creative.
- Music-industry focused.
- Confident.
- Cohesive.
- Carefully designed.

The design should communicate quality without becoming visually noisy.

Avoid:

- Generic template layouts.
- Excessive rounded cards.
- Excessive gradients.
- Unnecessary glassmorphism.
- Random shadows.
- Overdecorated backgrounds.
- Inconsistent typography.
- Oversized decorative elements.
- Inconsistent icon styles.
- Excessive animation.
- Unnecessary visual clutter.

## 20.2 Consistent design system

Create and maintain shared design tokens for:

- Primary colors.
- Secondary colors.
- Backgrounds.
- Surfaces.
- Text colors.
- Borders.
- Typography.
- Spacing.
- Radius.
- Shadows.
- Buttons.
- Form controls.
- Navigation.
- Cards.
- Modals.
- Badges.
- Icons.
- Interactive states.

Use shared components wherever appropriate.

Do not implement the same button, modal or input in multiple inconsistent ways.

Every new feature must follow the existing design system.

## 20.3 Typography and hierarchy

Typography should be intentional.

Use a consistent typographic scale.

Ensure that:

- Headings are distinguishable.
- Body text is readable.
- Labels are clear.
- Secondary information is visually quieter.
- Important actions are easy to identify.

Do not use typography merely for decoration.

## 20.4 Component quality

Every component should have:

- Consistent spacing.
- Appropriate alignment.
- Accessible contrast.
- Clear interactive states.
- Appropriate responsive behavior.
- Consistent visual treatment.

Icons must have a consistent visual style.

Avoid mixing unrelated icon libraries without a clear reason.

## 20.5 Existing prototype and README

The existing prototype and project README are important product references.

Inspect them before making major visual or structural changes.

Preserve established product decisions and recognizable design elements unless there is a clear reason to improve them.

Do not claim to have inspected a prototype, design file or README if it is not actually available in the connected workspace.

If something is inaccessible, report that limitation.

## 20.6 Landing-page photography (confirmed 2026-11-24)

The landing hero uses the **five photographs supplied by the project owner** (originals in `apps/web/public/assets/landing/`), hosted on Cloudinary under `muzikhub/brand/landing/` and shown as a cinematic sequence: a slow crossfade, a very subtle zoom, a Deep Forest overlay, a stable headline and CTA, and a single still photo for `prefers-reduced-motion`.

- Never replace them with invented people, stock photography or AI-generated images.
- Compose each photograph for its own size and quality: low-resolution and portrait images are never stretched on desktop; bright-background images get a stronger overlay.
- The photos are atmospheric only: no captions, names or wording that implies the people or visible brands endorse, sponsor or partner with MuzikHub.
- Keep the local originals until the hosted images are verified in production; they are never deleted automatically.

---

# 21. MOBILE-FIRST AND RESPONSIVE DESIGN — NON-NEGOTIABLE

MuzikHub is a mobile-first platform.

Mobile is the primary design direction.

Do not design desktop first and then attempt to squeeze the interface into a smaller screen.

Every screen must be designed with mobile usability as the starting point.

The platform must work across:

- Small mobile devices.
- Standard mobile devices.
- Large mobile devices.
- Tablets.
- Small laptops.
- Standard desktop screens.
- Large desktop screens.

## 21.1 Mobile-first implementation

Begin with the smallest practical supported screen width.

Build the layout for mobile first.

Then progressively enhance it for larger screens using responsive breakpoints.

Do not assume every user has a large display or a powerful device.

## 21.2 Responsive requirements

All pages and components must:

- Fit their available viewport.
- Avoid horizontal overflow.
- Maintain readable typography.
- Preserve usable spacing.
- Keep interactive elements accessible.
- Adapt navigation appropriately.
- Scale media correctly.
- Reflow content naturally.
- Maintain consistent branding.
- Preserve essential functionality.

Never solve a mobile layout problem by simply shrinking everything.

Reorganize the layout when necessary.

## 21.3 Mobile navigation

Navigation must be comfortable on mobile.

Use a suitable navigation pattern for the screen size.

A mobile navigation layout should make the most important areas accessible without occupying excessive screen space.

Do not blindly reuse desktop navigation on mobile.

## 21.4 Touch interactions

Design for touch rather than relying exclusively on mouse interactions.

Ensure:

- Buttons have comfortable touch targets.
- Forms are usable on mobile.
- Menus can be opened and closed easily.
- Modals fit the screen.
- Dialogs do not become inaccessible.
- Important actions are reachable.
- Hover-only information has a mobile alternative.

## 21.5 Media responsiveness

Creative media is central to MuzikHub.

Audio, video, images and portfolio previews must adapt to the available screen.

Prevent media from overflowing containers.

Use appropriate aspect ratios.

Avoid unnecessarily large media downloads.

Use responsive image delivery and loading strategies where appropriate.

## 21.6 Mobile performance

Optimize for realistic mobile conditions.

Consider:

- Network speed.
- Image sizes.
- Media loading.
- JavaScript bundle size.
- Rendering performance.
- API response time.
- Pagination.
- Lazy loading.
- Loading states.

Do not load every feed item or every portfolio item at once.

Use pagination or an appropriate incremental loading strategy.

## 21.7 Responsive verification

Test actual pages at multiple viewport widths.

At minimum, verify:

- 320px.
- 360px.
- 375px.
- 390px.
- 430px.
- Tablet widths.
- Laptop widths.
- Large desktop widths.

These are test targets, not the only supported screen sizes.

Check the complete page, not only individual components.

A page is not complete if it looks excellent on desktop but breaks on mobile.

---

# 22. FRONTEND ENGINEERING

The frontend is built using the established React and TypeScript architecture with Vite.

Use the existing project structure.

Do not introduce another frontend framework without approval.

Use reusable components and maintainable feature organization.

## 22.1 Frontend requirements

- Strong TypeScript typing.
- Reusable components.
- Consistent design tokens.
- Clear routing.
- Predictable state management.
- Form validation.
- API integration.
- Error handling.
- Loading states.
- Empty states.
- Success feedback.
- Responsive layouts.
- Accessibility.

Do not use `any` indiscriminately.

Do not duplicate API logic across components.

Centralize shared API behavior appropriately.

## 22.2 UI states

Every data-driven feature should account for:

1. Initial loading.
2. Successful loading.
3. Empty results.
4. Validation errors.
5. API errors.
6. Permission errors.
7. Network failures.
8. Successful mutations.

Do not leave users staring at blank screens when something fails.

Use clear, helpful feedback.

---

# 23. BACKEND ENGINEERING

The backend uses Express and TypeScript.

It must provide the actual business logic and data access for the application.

The frontend must not be treated as the source of truth for business rules.

## 23.1 Backend responsibilities

The backend is responsible for:

- Authentication.
- Authorization.
- Input validation.
- Business logic.
- Database operations.
- Relationship management.
- Feed operations.
- Search.
- Community permissions.
- Collaboration workflows.
- Messaging.
- Notifications.
- Media metadata.
- Payment processing.
- Webhooks.
- Administration.
- Audit logging.

## 23.2 API quality

Every endpoint must:

- Have a clear purpose.
- Validate its input.
- Authenticate protected actions.
- Authorize access.
- Return consistent responses.
- Handle errors.
- Prevent unauthorized access.
- Avoid leaking sensitive information.

Do not create endpoints that return fake success responses.

Do not return hardcoded data when the endpoint is supposed to retrieve database records.

## 23.3 API conventions

Maintain consistent:

- HTTP methods.
- Status codes.
- Response structures.
- Error structures.
- Validation behavior.
- Pagination conventions.
- Authentication requirements.

Document important API contracts.

---

# 24. DATABASE AND DATA MODEL

PostgreSQL is the selected relational database.

Prisma is the selected ORM.

Use the existing Prisma version and configuration.

Do not upgrade or replace major dependencies without a clear reason and approval.

## 24.1 Data modelling principles

Create normalized, maintainable relational models.

Represent relationships explicitly.

Use appropriate:

- Primary keys.
- Foreign keys.
- Unique constraints.
- Indexes.
- Enums.
- Timestamps.
- Cascading rules where appropriate.

Prevent duplicate records where business rules require uniqueness.

Ensure database relationships match the product model.

## 24.2 Data integrity

Do not rely solely on frontend validation.

Validate critical business rules in the backend.

Use database constraints where appropriate.

Consider concurrent requests and transaction safety for operations that modify related records.

## 24.3 Migrations

Use Prisma migrations appropriately.

Never casually delete production data.

Never reset a shared or production database to solve a migration problem.

Inspect existing migrations before changing the schema.

Explain potentially destructive operations before running them.

---

# 25. MEDIA STORAGE

Cloudinary is the selected media-storage and delivery solution for the initial implementation.

Use it for supported media workflows.

The backend must control upload authorization and ownership.

Do not expose privileged Cloudinary credentials.

Use appropriate upload validation.

Validate:

- File type.
- File size.
- Ownership.
- Supported media categories.

Do not trust a file's extension alone.

Avoid allowing arbitrary executable or unsafe file uploads.

Store the relevant media metadata in the database.

Use appropriate delivery URLs and transformations.

Ensure that media deletion and replacement workflows do not leave unnecessary orphaned assets.

---

# 26. SECURITY AND PRIVACY

Security must be considered throughout development.

Do not treat it as a final checklist.

Implement appropriate protection against:

- Unauthorized access.
- Broken object-level authorization.
- Privilege escalation.
- SQL injection.
- Cross-site scripting.
- Cross-site request forgery where applicable.
- Malicious file uploads.
- Unsafe external URLs.
- Brute-force attempts.
- Credential exposure.
- Webhook forgery.
- Duplicate financial processing.
- Unauthorized messaging access.

Use secure environment configuration.

Do not commit secrets.

Do not log passwords, private tokens or sensitive payment credentials.

Enforce permissions on the backend.

Validate all user-controlled inputs.

Avoid exposing private user information unnecessarily.

---

# 27. DEPLOYMENT AND ENVIRONMENT STRATEGY

The deployment direction is confirmed.

## 27.1 Frontend — Vercel

Vercel will be used to deploy the MuzikHub frontend.

The frontend deployment must:

- Build successfully.
- Use the correct production environment variables.
- Communicate with the production backend.
- Handle routing correctly.
- Support the required asset delivery.
- Avoid exposing private credentials.

Use the actual project structure and build configuration when configuring deployment.

Do not assume the frontend can use local development URLs in production.

## 27.2 Backend — Render

Render will be used to deploy the Express API.

The backend deployment must:

- Build successfully.
- Start using the correct production command.
- Bind to the port provided by the deployment environment.
- Connect securely to the production database.
- Use production environment variables.
- Configure CORS for the approved frontend origin.
- Expose appropriate health-check functionality.
- Process webhooks reliably.
- Handle application errors without exposing secrets.

Do not hardcode a local port for production.

## 27.3 Database hosting — Supabase PostgreSQL (confirmed 2026-11-24)

PostgreSQL is confirmed. **Supabase PostgreSQL** is the confirmed hosted database (Free plan for the hackathon and initial deployment).

The architecture does not change: Express API → Prisma 7 (`@prisma/adapter-pg`, node-postgres) → PostgreSQL. Supabase is reached through a standard connection string. Do not replace Prisma, rewrite the database layer or change the schema to accommodate the host.

- Connection approach: the **Supavisor session pooler** (port 5432, IPv4 on every plan) for both the API and `prisma migrate deploy`, with `sslmode=verify-full&sslrootcert=<Supabase CA certificate>`. See `docs/ARCHITECTURE.md` §7b for what has and has not been verified.
- Free-plan limits (pausing after 1 week of inactivity, 500 MB database, no automatic backups) are documented in `docs/ARCHITECTURE.md`. Run regular exports.
- Local development keeps using the Docker PostgreSQL in `docker-compose.yml`.

**Approval required:** do not create the production database, run production migrations, move data, change production credentials or begin deployment without the project owner's explicit approval.

## 27.4 Environment separation

Maintain separate development and production configurations.

Use environment variables for:

- Database connections.
- Authentication secrets.
- Frontend API URLs.
- Cloudinary credentials.
- Notch Pay credentials.
- Webhook verification secrets.
- Email service credentials where configured.
- Other private integrations.

Provide a complete `.env.example` with placeholder values.

Never put actual credentials in documentation.

---

# 28. TESTING AND QUALITY ASSURANCE

A feature is not complete merely because its interface renders.

It must be tested.

Use the existing testing tools and conventions.

Vitest and Supertest are part of the established testing direction.

## 28.1 Backend tests

Test:

- Authentication.
- Authorization.
- Input validation.
- Database operations.
- Relationship workflows.
- Feed functionality.
- Community permissions.
- Collaboration workflows.
- Messaging access.
- Notification creation.
- Payment processing.
- Webhook verification.
- Administrative permissions.

## 28.2 Frontend tests

Where appropriate, test:

- Component rendering.
- Form behavior.
- Validation.
- Navigation.
- Loading states.
- Error states.
- User interactions.
- Responsive behavior.

## 28.3 Integration tests

Test important user journeys across the frontend, API and database.

Examples:

**Registration journey**
- A new user registers.
- The account is created.
- Authentication works.
- The user can complete their profile.

**Profile journey**
- A user updates their profile.
- The data persists.
- Visitors can view the profile.
- External links navigate correctly.

**Feed journey**
- A user creates a post.
- The post is stored.
- Other authorized users can discover it.
- Relevant interactions persist.

**Community journey**
- A user creates or joins a community.
- The correct role is assigned.
- Authorized management actions work.
- Unauthorized actions are rejected.

**Collaboration journey**
- A user publishes a request.
- Another user expresses interest.
- The owner can respond.
- Status changes persist.

**Payment journey**
- A user initiates a payment.
- The provider processes it.
- The webhook is verified.
- The payment record is updated.
- The paid service is activated only after verified confirmation.

## 28.4 Definition of done

A feature is complete only when:

- The interface works.
- The API works.
- The database behavior is correct.
- Permissions are enforced.
- Loading states exist.
- Error states exist.
- Mobile layouts work.
- Tests pass.
- No fake functionality remains.
- Relevant documentation is updated.

Do not claim completion based only on a successful build.

---

# 29. ACCESSIBILITY AND USABILITY

MuzikHub should be usable by people with different abilities and devices.

Follow appropriate accessibility practices.

Ensure:

- Semantic HTML.
- Keyboard accessibility.
- Visible focus states.
- Sufficient contrast.
- Accessible form labels.
- Descriptive buttons.
- Appropriate alternative text.
- Accessible dialogs.
- Meaningful error messages.

Do not use color alone to communicate important information.

Do not make essential functionality dependent on hover.

---

# 30. PERFORMANCE AND SCALABILITY

Build the platform so it can grow without unnecessary architectural complexity.

Prioritize:

- Efficient database queries.
- Appropriate indexes.
- Pagination.
- Lazy loading.
- Responsive media.
- Caching where appropriate.
- Reusable API logic.
- Reasonable frontend bundles.
- Efficient rendering.
- Reliable error handling.

Do not prematurely introduce microservices.

Do not add infrastructure that the current product does not need.

Prefer a well-organized application architecture that can evolve as the platform grows.

---

# 31. DOCUMENTATION AND PROJECT STRUCTURE

Maintain the existing repository structure.

The expected high-level organization is:

```text
muzikhub/
├── CLAUDE.md
├── README.md
├── package.json
├── .gitignore
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   └── shared/
└── docs/
```

This is a reference structure, not permission to recreate the project blindly.

Inspect the actual repository before changing its structure.

Do not create nested duplicate MuzikHub projects.

Keep shared types and reusable contracts organized appropriately.

Document:

- Project setup.
- Environment variables.
- Development commands.
- Database setup.
- Migration procedures.
- API conventions.
- Authentication.
- Payment integration.
- Deployment.
- Important architectural decisions.

Update the README when meaningful project setup or behavior changes.

---

# 32. WORKING WITH THE EXISTING CODEBASE

Before implementing anything substantial, inspect the actual connected project workspace.

Do not assume that the repository is empty.

Do not assume that the current implementation matches an earlier progress report.

The current codebase is the source of truth for implementation status.

First inspect:

- Existing files.
- Existing package configuration.
- Existing dependencies.
- Existing routes.
- Existing components.
- Existing API endpoints.
- Existing database schema.
- Existing migrations.
- Existing tests.
- Existing environment examples.
- Existing documentation.

Identify what is already implemented.

Identify what is incomplete.

Identify what is broken.

Identify what is missing.

Do not recreate working features unnecessarily.

Do not overwrite existing work without understanding its purpose.

If the browser-based Claude Code workspace does not have access to a file, report that limitation instead of pretending to have inspected it.

---

# 33. IMPLEMENTATION WORKFLOW

Work systematically.

Do not make large, unverified changes across the entire project.

Use the following process.

## Step 1: Inspect

Understand the existing implementation and identify relevant files.

## Step 2: Compare

Compare the current implementation against the product requirements in this document.

## Step 3: Plan

Explain:

- What needs to change.
- Which files are affected.
- Which API endpoints are required.
- Which database changes are required.
- Which components are required.
- Which tests are required.
- Any dependencies or external configuration required.

## Step 4: Implement

Implement the feature using the established architecture and design system.

Do not introduce unrelated changes.

## Step 5: Verify

Run the relevant:

- Tests.
- Type checks.
- Builds.
- Database checks.
- Integration checks.

## Step 6: Review

Check:

- Functionality.
- Security.
- Permissions.
- Responsive behavior.
- Visual consistency.
- Error handling.
- Data integrity.

## Step 7: Report

Clearly state:

- What was completed.
- What was modified.
- What tests were run.
- Whether they passed.
- What remains incomplete.
- Whether external configuration is required.

Never report an unverified feature as complete.

---

# 34. HANDLING UNCERTAINTY — ANTI-HALLUCINATION RULES

This section is especially important.

You must distinguish between three categories of information.

## A. CONFIRMED PRODUCT DECISIONS

These are established requirements.

Implement them consistently unless the project owner explicitly changes them.

Examples:

- MuzikHub's professional music-industry direction.
- The central importance of the feed.
- Professional profiles and portfolios.
- Music-industry discovery.
- Communities with scoped management permissions.
- Structured collaboration requests.
- PostgreSQL and Prisma.
- Express and TypeScript.
- React, TypeScript and Vite.
- Cloudinary.
- Vercel for frontend deployment.
- Render for backend deployment.
- Notch Pay for payments.
- Deep Forest, Emerald, Mint and Off White brand identity.
- Mobile-first responsive design.
- Free basic participation and discovery.

## B. UNDECIDED PRODUCT OR BUSINESS DECISIONS

Do not invent answers.

Examples include:

- Final service prices.
- Platform commission rates.
- Subscription prices.
- Customer-paid versus platform-absorbed payment fees.
- Final promotional packages.
- Final pricing for individual services.
- Specific production database hosting provider.
- Any additional commercial feature not approved.

When implementation depends on one of these decisions, use a clearly identified placeholder or ask for clarification.

## C. TECHNICAL IMPLEMENTATION DECISIONS

You may recommend sensible technical solutions when they do not change the product's agreed behavior.

However:

- Explain important trade-offs.
- Prefer the existing stack.
- Avoid unnecessary dependencies.
- Do not replace established technologies without justification.
- Do not treat a proposed technical solution as an approved business decision.

## 34.1 Never invent project status

Do not say:

- A feature works if it has not been tested.
- A payment is integrated if it only has a mock checkout.
- A message is real-time if it is only stored in the database.
- A page is responsive if it has not been checked.
- An API is secure if permissions have not been verified.
- A deployment is complete if it has not been successfully deployed.

State the actual implementation status.

## 34.2 Ask before making consequential assumptions

Ask for clarification when:

- A requirement conflicts with another established requirement.
- A business rule is missing.
- A payment decision affects real money.
- A permission decision affects security.
- A database change could destroy or alter important data.
- A proposed feature materially changes the product.
- A design change would undermine the established brand.

Do not ask unnecessary questions when the answer is already documented here or in the actual codebase.

---

# 35. FINAL PRODUCT EXPERIENCE

The finished MuzikHub experience should feel like one connected platform.

A user should be able to:

1. Register.
2. Establish a professional identity.
3. Complete a profile.
4. Showcase creative work.
5. Discover other professionals.
6. Browse the feed.
7. Explore artists, beatmakers, DJs and other professionals.
8. Follow relevant people.
9. Join communities.
10. Participate in professional discussions.
11. Publish or discover collaboration requests.
12. Express interest in collaborations.
13. Discover relevant opportunities.
14. Communicate with other professionals.
15. Receive relevant notifications.
16. Access optional paid services where available.
17. Complete payments securely through Notch Pay.

These experiences should connect naturally.

For example:

A visitor discovers a producer through a beat in the feed.

They open the producer's profile.

They explore the producer's portfolio.

They visit the producer's external music platforms through clearly recognizable destination icons.

They follow the producer.

They discover a relevant collaboration request.

They express interest and begin communicating.

That is the kind of connected experience MuzikHub must deliver.

---

# 36. THE STANDARD WE ARE BUILDING TOWARD

MuzikHub must not look or behave like a collection of disconnected student-project pages.

It should feel like a serious, carefully engineered music-industry product.

The quality standard applies to:

- Product logic.
- UI/UX.
- Brand consistency.
- Mobile experience.
- Backend architecture.
- Database integrity.
- Security.
- Payments.
- Performance.
- Accessibility.
- Testing.
- Documentation.

Do not prioritize the number of features over the quality and completeness of the essential journeys.

Do not build impressive-looking interfaces that fail when users interact with them.

Do not build complicated systems just to make the architecture look sophisticated.

Build what the product genuinely needs.

Make every screen intentional.

Make every interaction meaningful.

Make every permission enforceable.

Make every payment verifiable.

Make every essential journey complete.


# MUZIKHUB — PROPOSED MONETIZATION AND PRICING POLICY

## 1. Pricing philosophy

MuzikHub follows a freemium business model.

Basic participation, professional profiles, creative showcases, feed browsing, discovery, following, communities and essential networking must remain free.

Monetization should focus on optional premium professional features and promotional services.

Never make basic participation dependent on a paid subscription.

## 2. Proposed subscription prices

| Plan | Monthly | Annual |
|---|---:|---:|
| Free | 0 FCFA | 0 FCFA |
| Creator Plus | 1,500 FCFA | 15,000 FCFA |
| MuzikHub Pro | 3,000 FCFA | 30,000 FCFA |

Creator Plus is intended to provide basic profile performance insights and portfolio customization.

MuzikHub Pro is intended to provide advanced analytics, enhanced professional presentation and priority support.

These benefits must not be advertised until their functionality is implemented and verified.

## 3. Proposed promotional prices

| Service | Duration | Price |
|---|---:|---:|
| Post Boost | 3 days | 1,000 FCFA |
| Post Boost | 7 days | 2,500 FCFA |
| Post Boost | 14 days | 5,000 FCFA |
| Profile Spotlight | 3 days | 1,500 FCFA |
| Profile Spotlight | 7 days | 3,500 FCFA |

All paid promotions must be clearly labelled and must not eliminate organic discovery.

No guaranteed engagement or follower growth should be promised.

## 4. Future organization plans

Potential future plans:

- Label Starter: 5,000 FCFA/month.
- Label Professional: 7,500 FCFA/month.

Do not implement these plans until organization and team-management functionality has been approved and completed.

## 5. Payment-provider costs

Notch Pay is the selected payment provider.

Current published Cameroon charges include:

- 2.5% per successful collection.
- 1% per withdrawal or transfer.
- Applicable taxes are additional.

These charges must be considered when calculating platform revenue.

Do not assume the gross customer payment is the platform's net revenue.

## 6. Pricing implementation rules

All commercial prices must be managed through a centralized pricing configuration or service catalogue.

Do not hardcode prices throughout frontend components.

Each paid service must have:

- Service identifier.
- Display name.
- Description.
- Price in XAF.
- Billing interval where applicable.
- Availability status.
- Applicable service rules.

Store a price snapshot when a purchase is initiated.

Never silently change an existing purchase when pricing is updated.

## 7. Approval status

The figures in this section are proposed starting prices.

They must be treated as pending commercial approval until the MuzikHub project owner explicitly confirms them.

Do not activate real customer billing using proposed prices without approval.

Do not invent additional prices, commissions, taxes or subscription benefits.

## 8. Launch strategy

Prioritize the Free experience and paid promotional services first.

Introduce Creator Plus and MuzikHub Pro only when the corresponding premium features are fully functional.

Introduce organization plans only after the required organization-management features exist.



### Media Management, Image Delivery and Low-Bandwidth Performance

MuzikHub must be designed for users accessing the platform through mobile devices and potentially slow, unstable or expensive internet connections, particularly within Cameroon and other African markets.

Performance is a core product requirement, not an optional optimisation.

#### 1. Media Architecture
- Use Cloudinary for user-uploaded images and media.
- Deliver media through Cloudinary's CDN.
- Do not create unnecessary collections of static photographs for individual platform sections.
- The platform must primarily use authentic user-generated content, including profile pictures, portfolio uploads, creative posts, community covers and opportunity media.
- Keep the frontend's static assets directory minimal. Store only essential brand assets, fallback images, icons and deliberately selected marketing photography.
- Never duplicate uploaded user images into separate static asset folders for different sections.

#### 2. Image Optimisation
- Automatically optimise image delivery using Cloudinary transformations.
- Prefer modern formats such as AVIF and WebP where supported.
- Generate appropriately sized image variants for different display contexts.
- Avoid delivering original full-resolution images when smaller variants are sufficient.
- Preserve visual quality while minimising file size.

#### 3. Lazy Loading
- Implement lazy loading for images outside the initial viewport.
- Prioritise above-the-fold images, especially the landing-page hero.
- Use responsive image delivery and appropriate dimensions.
- Use lightweight placeholders and prevent layout shifts.
- Avoid loading an entire feed's media collection at once.

#### 4. Responsive Media
- Provide appropriate image sizes for mobile, tablet and desktop.
- Use small thumbnails for avatars and previews.
- Load higher-resolution images only when the viewing context requires them.
- Ensure images maintain their intended aspect ratios and do not break layouts.

#### 5. Low-Bandwidth Experience
- Optimise media for users with limited bandwidth.
- Do not autoplay videos.
- Load video thumbnails before video content.
- Load video content only when the user explicitly chooses to play it.
- Implement feed pagination or progressive loading.
- Provide clear loading, failure and retry states.
- Avoid unnecessarily heavy animations, backgrounds and decorative media.
- Ensure essential platform functionality remains usable when media loads slowly or fails.

#### 6. User-Generated Content
- Profile pictures must come from user profiles.
- Discovery should use real professional profiles and portfolios.
- Feed content must come from actual published posts.
- Community imagery should use community-uploaded covers or relevant member content.
- Opportunity organisers should be able to upload opportunity-specific media.
- Competition organisers should provide competition banners, while participants upload their actual competition submissions.
- Do not invent users, photographs, portfolio content or competition submissions to make the platform appear populated.

#### 7. Performance Validation
Test media performance on mobile-sized screens and simulated slow network connections.
Verify that:
- Images are appropriately sized.
- Images below the viewport are not downloaded prematurely.
- The landing hero loads promptly.
- Long feeds do not download every image immediately.
- Failed media requests do not break the interface.
- Users can still navigate and interact while nonessential media is loading.

**The objective is to build a premium, mobile-first, genuinely functional music-industry platform that professionals can confidently use — not a visual prototype that only looks finished.**