/**
 * Presentation demo data, for a LOCAL development database only. Never production.
 *
 *   DEMO_SEED_PASSWORD='<at least 12 characters>' npm run demo:seed -w @muzikhub/api
 *
 * Safety
 * - Refuses unless NODE_ENV=development and DATABASE_URL points at a local database
 *   (localhost / 127.0.0.1 / ::1 / the docker-compose "db" host). Supabase or any remote host is refused.
 * - Only creates or changes accounts on the reserved demo domain (DEMO_DOMAIN, under .test, which
 *   can never receive email). Other accounts are never updated or deleted.
 * - No payments, orders, subscriptions or promotions are created. Payment settings aren't touched.
 *
 * How data is created
 * - Through the real API, in-process: validation, permissions, notifications and the audit log all
 *   apply, and passwords are hashed by Better Auth. Media goes through the real signed-upload flow
 *   into the development Cloudinary folder (generated artwork and synthesized loops, demo-media.ts).
 * - Three things are done directly, as an operator with database access (like the admin:* scripts)
 *   and only for demo-domain accounts:
 *     1. emailVerified=true, because demo addresses can't receive mail. This is NOT the email
 *        attestation feature for real users (not built; see IMPLEMENTATION_STATUS).
 *     2. The ADMIN role and organiser access, each with an audit entry (actor "cli:demo:seed").
 *     3. A finished competition's dates are moved into the past so its results can be shown.
 *
 * Idempotent: every step looks for its record first (by email, title, slug or unique pair) and is
 * skipped when it exists. Re-running with the same password changes nothing; with a different one
 * it only updates the demo accounts' password hashes.
 */
import { writeFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { writeAudit } from '../lib/audit.js';
import { auth } from '../lib/auth.js';
import { captureTransport, setEmailTransport } from '../lib/mailer.js';
import { prisma } from '../lib/prisma.js';
import { artwork, avatar, beatLoop } from './demo-media.js';

export const DEMO_DOMAIN = 'demo.muzikhub.test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);
const SHEET = new URL('../../../../demo-credentials.local.md', import.meta.url);
const DAY = 86_400_000;

function preflight(): string {
  const host = new URL(env.DATABASE_URL).hostname;
  if (env.NODE_ENV !== 'development') throw new Error(`demo:seed runs only with NODE_ENV=development (got ${env.NODE_ENV}).`);
  if (!LOCAL_HOSTS.has(host)) throw new Error(`demo:seed refuses non-local databases (host "${host}"). It is for local development only.`);
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new Error('demo:seed needs CLOUDINARY_* in apps/api/.env: releases, artwork and competition entries use real uploads.');
  }
  const password = process.env.DEMO_SEED_PASSWORD ?? '';
  if (password.length < 12) {
    throw new Error("Set DEMO_SEED_PASSWORD (at least 12 characters), e.g. DEMO_SEED_PASSWORD='…' npm run demo:seed -w @muzikhub/api");
  }
  return password;
}

type Agent = ReturnType<typeof request.agent>;
type Release = {
  title: string;
  type: 'AUDIO' | 'BEAT';
  description: string;
  genres: string[];
  credits: string;
  bpm: number;
  root: number;
  featured?: boolean;
};
type Person = {
  key: string;
  name: string;
  primaryUse: 'CREATOR' | 'FAN' | 'PROFESSIONAL';
  persona: string;
  flows: string[];
  admin?: true;
  organiser?: true;
  supporting?: true;
  profile: { bio: string; location: string; roles: string[]; genres: string[]; skills?: string[]; careerStage?: string };
  releases?: Release[];
};

const PEOPLE: Person[] = [
  {
    key: 'admin',
    name: 'Platform Admin (demo)',
    primaryUse: 'PROFESSIONAL',
    persona: 'Administrator',
    admin: true,
    flows: [
      'Sign in, set up two-factor authentication (required for staff), open /admin',
      'Overview: real counts and the pending report',
      'Reports queue: the spam report filed by Sam (assign, add a note, resolve, remove the post)',
      'Users: search "demo", open an account, see its status and history',
      'Audit log: the role and organiser grants recorded by cli:demo:seed',
    ],
    profile: { bio: 'Demo administrator account for presentations.', location: 'Douala', roles: ['OTHER'], genres: [] },
  },
  {
    key: 'amara',
    name: 'Amara (demo)',
    primaryUse: 'CREATOR',
    persona: 'Artist',
    flows: [
      'Profile with picture, banner, releases and featured work',
      'Feed: her release showcases, with likes and comments',
      'Messages with Kofi; an accepted collaboration with Nadia',
      'Owner of the Songwriters’ Room community',
    ],
    profile: {
      bio: 'Afro-soul singer and songwriter. Writing my first EP about Douala nights.',
      location: 'Douala',
      roles: ['SINGER', 'SONGWRITER'],
      genres: ['afro_pop', 'soul', 'makossa'],
      skills: ['Vocals', 'Toplines', 'Harmonies'],
      careerStage: 'EMERGING',
    },
    releases: [
      {
        title: 'Douala Nights',
        type: 'AUDIO',
        description: 'A slow afro-soul sketch: warm chords, a patient groove, room for the voice.',
        genres: ['afro_pop', 'soul'],
        credits: 'Written by Amara. Produced by Kofi.',
        bpm: 96,
        root: 49,
        featured: true,
      },
      {
        title: 'Salt and Sunrise',
        type: 'AUDIO',
        description: 'Morning-light makossa groove, demo version.',
        genres: ['makossa'],
        credits: 'Written and arranged by Amara.',
        bpm: 104,
        root: 55,
      },
    ],
  },
  {
    key: 'kofi',
    name: 'Kofi (demo)',
    primaryUse: 'CREATOR',
    persona: 'Producer',
    flows: [
      'Beats in the portfolio, with artwork and playable audio',
      'Owner of the Douala Producers Circle community',
      'A pending collaboration request from Amara and a pending connection request from Lena',
      'Entered in the open Beat Cup; won the finished Makossa Flip Challenge',
    ],
    profile: {
      bio: 'Producer and beatmaker. Amapiano and afrobeats, mostly at night.',
      location: 'Yaoundé',
      roles: ['PRODUCER', 'BEATMAKER'],
      genres: ['amapiano', 'afrobeats'],
      skills: ['Drum programming', 'Sound design', 'Arrangement'],
      careerStage: 'DEVELOPING',
    },
    releases: [
      {
        title: 'Harbour Lights',
        type: 'BEAT',
        description: 'Amapiano instrumental with rolling log drums. Open for toplines.',
        genres: ['amapiano'],
        credits: 'Produced by Kofi.',
        bpm: 112,
        root: 52,
        featured: true,
      },
      {
        title: 'Wouri Bounce',
        type: 'BEAT',
        description: 'Up-tempo afrobeats groove, open for a rapper or a singer.',
        genres: ['afrobeats'],
        credits: 'Produced by Kofi.',
        bpm: 118,
        root: 58,
      },
    ],
  },
  {
    key: 'joel',
    name: 'Joel (demo)',
    primaryUse: 'PROFESSIONAL',
    persona: 'Organiser',
    organiser: true,
    flows: [
      'Approved organiser: creates opportunities and competitions',
      'Opportunities: a published DJ gig with an application from Lena, and an audition',
      'Competitions: the open Beat Cup (entries arriving) and a finished challenge with judged results',
    ],
    profile: {
      bio: 'Mixing and mastering engineer. I run beat competitions and live sessions for new talent.',
      location: 'Douala',
      roles: ['MIXING_MASTERING_ENGINEER', 'EVENT_ORGANIZER'],
      genres: ['afrobeats', 'hip_hop'],
      skills: ['Mixing', 'Mastering', 'Event production'],
      careerStage: 'ESTABLISHED',
    },
  },
  {
    key: 'sam',
    name: 'Sam (demo)',
    primaryUse: 'FAN',
    persona: 'Ordinary user',
    flows: [
      'Discover artists and producers (follows four of them)',
      'Feed: likes and comments on releases',
      'Member of both communities',
      'Reported a spam post (the reporting flow)',
    ],
    profile: {
      bio: 'Music lover in Yaoundé, always looking for new artists.',
      location: 'Yaoundé',
      roles: ['OTHER'],
      genres: ['afrobeats', 'amapiano', 'rnb'],
    },
  },
  {
    key: 'lena',
    name: 'Lena (demo)',
    primaryUse: 'CREATOR',
    persona: 'Supporting: DJ',
    supporting: true,
    flows: ['Applied to Joel’s DJ gig; sent Kofi a connection request'],
    profile: { bio: 'DJ playing open-air sets and weddings.', location: 'Douala', roles: ['DJ'], genres: ['afrobeats', 'amapiano'] },
    releases: [
      {
        title: 'Open-Air Warm-Up',
        type: 'AUDIO',
        description: 'The first minutes of a sunset set.',
        genres: ['afro_house'],
        credits: 'Mixed by Lena.',
        bpm: 122,
        root: 46,
      },
    ],
  },
  {
    key: 'nadia',
    name: 'Nadia (demo)',
    primaryUse: 'CREATOR',
    persona: 'Supporting: rapper',
    supporting: true,
    flows: ['Collaboration with Amara (accepted); an entry in the finished challenge'],
    profile: {
      bio: 'Rapper and songwriter, bilingual bars.',
      location: 'Bafoussam',
      roles: ['RAPPER', 'SONGWRITER'],
      genres: ['rap', 'hip_hop'],
    },
  },
  {
    key: 'beatdeals',
    name: 'Beat Deals (demo)',
    primaryUse: 'CREATOR',
    persona: 'Supporting: spam account',
    supporting: true,
    flows: ['Posted spam, reported by Sam (moderation demo)'],
    profile: { bio: 'Demo account used to show moderation.', location: 'Douala', roles: ['OTHER'], genres: [] },
  },
];

let created = 0;
let skipped = 0;
const log = (made: boolean, what: string) => {
  if (made) created += 1;
  else skipped += 1;
  console.log(`  ${made ? '+' : '·'} ${what}`);
};

async function main() {
  const password = preflight();
  // Demo addresses can't receive mail: keep sign-up emails in memory instead of printing them.
  setEmailTransport(captureTransport);
  const app = createApp();
  const ctx = await auth.$context;

  async function api<T = unknown>(agent: Agent, method: 'get' | 'post' | 'put' | 'patch', path: string, body?: object): Promise<T> {
    const req = agent[method](path.startsWith('/api/') ? path : `/api/v1${path}`);
    const res = body === undefined ? await req : await req.send(body);
    if (res.status >= 300) throw new Error(`${method.toUpperCase()} ${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`);
    return res.body as T;
  }

  /** Signed upload → Cloudinary → server verification, exactly as the browser does it. */
  async function upload(agent: Agent, kind: 'IMAGE' | 'AUDIO', purpose: string, bytes: Buffer, filename: string): Promise<string> {
    const signed = await api<{ assetId: string; uploadUrl: string; fields: Record<string, string> }>(agent, 'post', '/media/uploads', {
      kind,
      purpose,
      bytes: bytes.length,
    });
    const form = new FormData();
    for (const [k, v] of Object.entries(signed.fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(bytes)], { type: kind === 'IMAGE' ? 'image/png' : 'audio/wav' }), filename);
    const res = await fetch(signed.uploadUrl, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Cloudinary upload of ${filename} → ${res.status}`);
    await api(agent, 'post', `/media/${signed.assetId}/confirm`);
    return signed.assetId;
  }

  // ── People ───────────────────────────────────────────────
  console.log('People');
  const u: Record<string, { agent: Agent; id: string; username: string }> = {};
  for (const [i, p] of PEOPLE.entries()) {
    const username = `${p.key}.demo`;
    const email = `${username}@${DEMO_DOMAIN}`;
    const agent = request.agent(app);
    agent.set('Origin', env.WEB_APP_URL);
    // One documentation-range address per person, so Better Auth's per-IP sign-up limit treats
    // them as different visitors (in-process requests would otherwise share one address).
    agent.set('X-Forwarded-For', `198.51.100.${10 + i}`);

    let user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      const res = await agent.post('/api/auth/sign-up/email').send({ name: p.name, username, email, password, primaryUse: p.primaryUse });
      if (res.status !== 200) throw new Error(`sign-up ${username} → ${res.status} ${JSON.stringify(res.body)}`);
      user = { id: res.body.user.id as string };
      log(true, `account ${email}`);
    } else {
      const account = await prisma.account.findFirst({
        where: { userId: user.id, providerId: 'credential' },
        select: { id: true, password: true },
      });
      if (!account) throw new Error(`${email} has no password sign-in.`);
      const same = account.password ? await ctx.password.verify({ hash: account.password, password }) : false;
      if (!same) {
        await prisma.account.update({ where: { id: account.id }, data: { password: await ctx.password.hash(password) } });
        console.log(`  ~ password updated for ${email}`);
      }
      const { twoFactorEnabled } = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { twoFactorEnabled: true } });
      if (!twoFactorEnabled) {
        const res = await agent.post('/api/auth/sign-in/email').send({ email, password });
        if (res.status !== 200) throw new Error(`sign-in ${username} → ${res.status} ${JSON.stringify(res.body)}`);
      }
      log(false, `account ${email}`);
    }
    const id = user.id;
    u[p.key] = { agent, id, username };

    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { emailVerified: true, platformRole: true, isOrganiser: true, twoFactorEnabled: true },
    });
    // Demo addresses can't receive mail (reserved .test domain): the operator marks them confirmed.
    if (!row.emailVerified) await prisma.user.update({ where: { id }, data: { emailVerified: true } });

    // Profile, picture and banner (an admin with two-factor set up is left as it is).
    if (!row.twoFactorEnabled) {
      await api(agent, 'patch', '/me/profile', p.profile);
      await api(agent, 'post', '/me/onboarding/complete');
      const profile = await prisma.profile.findUniqueOrThrow({
        where: { userId: id },
        select: { avatarAssetId: true, coverAssetId: true },
      });
      if (!profile.avatarAssetId && p.key !== 'beatdeals') {
        const mediaId = await upload(agent, 'IMAGE', 'AVATAR', avatar(p.key), `${p.key}-avatar.png`);
        await api(agent, 'put', '/me/profile/avatar', { mediaId });
        log(true, `${username} profile picture`);
      }
      if (!profile.coverAssetId && !p.supporting && !p.admin) {
        const mediaId = await upload(agent, 'IMAGE', 'COVER', artwork(`${p.key}-banner`, 1500, 500), `${p.key}-banner.png`);
        await api(agent, 'put', '/me/profile/cover', { mediaId });
        log(true, `${username} profile banner`);
      }
    }

    if (p.admin && row.platformRole !== 'ADMIN') {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { platformRole: 'ADMIN' } });
        await writeAudit(tx, {
          actor: { label: 'cli:demo:seed' },
          action: 'user.role.change',
          target: { type: 'USER', id },
          reason: 'Presentation demo administrator (local demo seed; reserved demo domain only)',
          before: { role: row.platformRole },
          after: { role: 'ADMIN' },
        });
      });
      log(true, `${username} → ADMIN (audited)`);
    }
    if (p.organiser && !row.isOrganiser) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { isOrganiser: true, organiserSince: new Date() } });
        await writeAudit(tx, {
          actor: { label: 'cli:demo:seed' },
          action: 'user.organiser.grant',
          target: { type: 'user', id },
          reason: 'Presentation demo organiser (local demo seed; reserved demo domain only)',
          before: { isOrganiser: false },
          after: { isOrganiser: true },
        });
      });
      log(true, `${username} → organiser (audited)`);
    }
  }
  const person = (key: string) => u[key]!;

  async function post(key: string, body: string) {
    const existing = await prisma.post.findFirst({ where: { authorId: person(key).id, body }, select: { id: true } });
    const id = existing?.id ?? (await api<{ id: string }>(person(key).agent, 'post', '/posts', { body })).id;
    log(!existing, `post by ${key}: "${body.slice(0, 40)}…"`);
    return id;
  }
  // The spam example is created first, so it is the oldest item and not the top of the feed.
  console.log('Moderation example');
  const spam = await post('beatdeals', 'Cheap followers and guaranteed streams!!! DM me for packages, 100% real fans, instant results.');

  // ── Releases (portfolio, shared to the feed) ─────────────
  console.log('Releases');
  for (const p of PEOPLE) {
    for (const r of p.releases ?? []) {
      const me = person(p.key);
      const exists = await prisma.portfolioItem.findFirst({ where: { ownerId: me.id, title: r.title }, select: { id: true } });
      if (!exists) {
        const slug = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const mediaId = await upload(me.agent, 'AUDIO', 'PORTFOLIO', beatLoop(slug, { bpm: r.bpm, root: r.root }), `${slug}.wav`);
        const coverId = await upload(me.agent, 'IMAGE', 'PORTFOLIO', artwork(slug), `${slug}-artwork.png`);
        await api(me.agent, 'post', '/portfolio', {
          type: r.type,
          title: r.title,
          description: r.description,
          genres: r.genres,
          credits: r.credits,
          mediaId,
          coverId,
          featured: r.featured ?? false,
          publish: true,
          shareToFeed: true,
        });
      }
      log(!exists, `"${r.title}" by ${me.username}`);
    }
  }

  // ── Network ──────────────────────────────────────────────
  console.log('Network');
  const follows: [string, string][] = [
    ['sam', 'amara'],
    ['sam', 'kofi'],
    ['sam', 'lena'],
    ['sam', 'nadia'],
    ['amara', 'kofi'],
    ['kofi', 'amara'],
    ['lena', 'kofi'],
    ['nadia', 'amara'],
    ['joel', 'kofi'],
    ['joel', 'amara'],
    ['kofi', 'joel'],
  ];
  for (const [a, b] of follows) {
    const exists = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: person(a).id, followingId: person(b).id } },
    });
    if (!exists) await api(person(a).agent, 'put', `/users/${person(b).username}/follow`);
    log(!exists, `${a} follows ${b}`);
  }
  const connections: [string, string, string, boolean][] = [
    ['amara', 'kofi', 'Loved Harbour Lights. Let’s work together.', true],
    ['nadia', 'amara', 'Your hooks would sit perfectly on my verses.', true],
    ['joel', 'kofi', 'Good to connect before the Beat Cup.', true],
    ['lena', 'kofi', 'Would love to play your beats in my sets.', false],
  ];
  for (const [a, b, message, accept] of connections) {
    const pair = [person(a).id, person(b).id];
    const exists = await prisma.connection.findFirst({
      where: { requesterId: { in: pair }, addresseeId: { in: pair }, status: { in: ['PENDING', 'ACCEPTED'] } },
    });
    if (!exists) {
      const c = await api<{ id: string }>(person(a).agent, 'post', '/connections', { username: person(b).username, message });
      if (accept) await api(person(b).agent, 'post', `/connections/${c.id}/accept`);
    }
    log(!exists, `${a} ↔ ${b} connection${accept ? '' : ' (pending)'}`);
  }

  // ── Feed ─────────────────────────────────────────────────
  console.log('Feed');
  async function comment(key: string, postId: string, body: string) {
    const exists = await prisma.comment.findFirst({ where: { postId, authorId: person(key).id, body } });
    if (!exists) await api(person(key).agent, 'post', `/posts/${postId}/comments`, { body });
    log(!exists, `comment by ${key}`);
  }
  async function like(key: string, postId: string) {
    const exists = await prisma.postLike.findUnique({ where: { postId_userId: { postId, userId: person(key).id } } });
    if (!exists) await api(person(key).agent, 'put', `/posts/${postId}/like`);
    log(!exists, `${key} likes a post`);
  }
  const showcase = async (owner: string, title: string) =>
    (await prisma.post.findFirstOrThrow({ where: { authorId: person(owner).id, portfolioItem: { title } }, select: { id: true } })).id;

  const kofiPost = await post('kofi', 'New amapiano sketch tonight. Log drums in, still looking for a vocal hook. Who’s in?');
  const amaraPost = await post('amara', 'Wrote three verses this week for the EP. Studio on Saturday with Kofi.');
  const lenaPost = await post('lena', 'Open-air set at the harbour this weekend. Who’s coming?');
  const joelPost = await post(
    'joel',
    'The Douala Amapiano Beat Cup is open. Original instrumentals only; rules and criteria are on the competition page.',
  );
  const douala = await showcase('amara', 'Douala Nights');
  const harbour = await showcase('kofi', 'Harbour Lights');
  const likes: [string, string][] = [
    ['sam', douala],
    ['kofi', douala],
    ['nadia', douala],
    ['sam', harbour],
    ['amara', harbour],
    ['lena', harbour],
    ['amara', kofiPost],
    ['sam', amaraPost],
    ['kofi', lenaPost],
    ['kofi', joelPost],
  ];
  for (const [k, id] of likes) await like(k, id);
  await comment('sam', douala, 'This is beautiful. When does the EP drop?');
  await comment('kofi', douala, 'Proud of this one. The second verse is going to hit.');
  await comment('amara', harbour, 'I can already hear a hook on this.');
  await comment('lena', kofiPost, 'Send it over, I’ll test it on Saturday.');

  // ── Communities ──────────────────────────────────────────
  console.log('Communities');
  async function community(
    owner: string,
    input: { name: string; description: string; category: string; rules: string },
    members: string[],
  ) {
    const existing = await prisma.community.findFirst({
      where: { name: input.name, createdById: person(owner).id },
      select: { id: true, slug: true },
    });
    const c =
      existing ?? (await api<{ id: string; slug: string }>(person(owner).agent, 'post', '/communities', { ...input, policy: 'OPEN' }));
    log(!existing, `community "${input.name}"`);
    for (const m of members) {
      const exists = await prisma.communityMember.findUnique({
        where: { communityId_userId: { communityId: c.id, userId: person(m).id } },
      });
      if (!exists) await api(person(m).agent, 'post', `/communities/${c.slug}/join`, {});
      log(!exists, `${m} joins ${c.slug}`);
    }
    return c;
  }
  async function discussion(key: string, c: { id: string; slug: string }, kind: string, title: string, body: string) {
    const existing = await prisma.discussion.findFirst({ where: { communityId: c.id, title }, select: { id: true } });
    const id =
      existing?.id ??
      (await api<{ id: string }>(person(key).agent, 'post', `/communities/${c.slug}/discussions`, { kind, title, body })).id;
    log(!existing, `discussion "${title}"`);
    return id;
  }
  async function reply(key: string, discussionId: string, body: string) {
    const exists = await prisma.discussionComment.findFirst({ where: { discussionId, authorId: person(key).id, body } });
    if (!exists) await api(person(key).agent, 'post', `/discussions/${discussionId}/comments`, { body });
    log(!exists, `reply by ${key}`);
  }
  const producers = await community(
    'kofi',
    {
      name: 'Douala Producers Circle',
      description: 'Beatmakers and producers sharing techniques, sessions and honest feedback.',
      category: 'PRODUCTION',
      rules: 'Be kind. Credit samples. Feedback before self-promotion.',
    },
    ['amara', 'lena', 'joel', 'sam'],
  );
  const lowEnd = await discussion(
    'lena',
    producers,
    'QUESTION',
    'How do you keep log drums from muddying the low end?',
    'My amapiano mixes get boomy on club systems. What do you cut, and where?',
  );
  await reply(
    'joel',
    lowEnd,
    'High-pass everything else around 30 Hz and sidechain the bass to the log drum. Check on small speakers too.',
  );
  await reply('kofi', lowEnd, 'Also tune the log drum to the key of the track. Half the mud is two notes fighting.');
  const feedback = await discussion(
    'kofi',
    producers,
    'DISCUSSION',
    'Monthly feedback thread',
    'Share one work-in-progress and give feedback on two others.',
  );
  await reply('amara', feedback, 'Douala Nights is in my portfolio. Is the vocal sitting right in the second verse?');
  const writers = await community(
    'amara',
    {
      name: 'Songwriters’ Room',
      description: 'Lyrics, toplines and co-writes. Bring a verse, leave with a song.',
      category: 'SONGWRITING',
      rules: 'Respect unreleased work. Ask before reusing a line.',
    },
    ['nadia', 'sam'],
  );
  const hooks = await discussion(
    'amara',
    writers,
    'DISCUSSION',
    'Hooks in two languages',
    'How do you write a hook that works in French and English without losing the rhyme?',
  );
  await reply('nadia', hooks, 'I write the rhythm first, then fit both languages to it. Meaning can bend; the bounce can’t.');

  // ── Messages and collaboration ───────────────────────────
  console.log('Messages and collaboration');
  async function conversation(a: string, b: string, lines: [string, string][]) {
    const c = await api<{ id: string }>(person(a).agent, 'post', '/conversations', { username: person(b).username });
    for (const [n, [from, body]] of lines.entries()) {
      const clientId = `demoseed-${a}-${b}-${n + 1}`;
      const exists = await prisma.message.findUnique({ where: { senderId_clientId: { senderId: person(from).id, clientId } } });
      if (!exists) await api(person(from).agent, 'post', `/conversations/${c.id}/messages`, { clientId, body });
      log(!exists, `message ${from} → ${from === a ? b : a}`);
    }
  }
  await conversation('amara', 'kofi', [
    ['amara', 'Hi Kofi! Loved Harbour Lights.'],
    ['kofi', 'Thank you! Are you still looking for beats for the EP?'],
    ['amara', 'Yes. I sent you a collaboration request with the details.'],
  ]);
  await conversation('joel', 'lena', [
    ['joel', 'Thanks for applying to the harbour gig. Can you share a recent set?'],
    ['lena', 'Of course, the warm-up is in my portfolio. Full set on request.'],
  ]);
  async function collab(
    from: string,
    to: string,
    input: { type: string; title: string; description: string; role: string },
    accept?: string,
  ) {
    const existing = await prisma.collaborationRequest.findFirst({
      where: { senderId: person(from).id, recipientId: person(to).id, title: input.title },
      select: { id: true, status: true },
    });
    const r: { id: string; status: string } =
      existing ??
      (await api<{ id: string }>(person(from).agent, 'post', '/collaborations/requests', { username: person(to).username, ...input }).then(
        (res) => ({ id: res.id, status: 'PENDING' }),
      ));
    if (accept && r.status === 'PENDING') await api(person(to).agent, 'post', `/collaborations/requests/${r.id}/accept`, { note: accept });
    log(!existing, `collaboration "${input.title}"${accept ? ' (accepted)' : ' (pending)'}`);
  }
  await collab('amara', 'kofi', {
    type: 'PRODUCTION',
    title: 'Afro-soul single',
    description: 'A slow afro-soul single about Douala nights. I have the topline and the first verse.',
    role: 'Producer',
  });
  await collab(
    'nadia',
    'amara',
    {
      type: 'FEATURE',
      title: 'Bilingual hook',
      description: 'A rap track that needs a sung hook in French and English.',
      role: 'Hook vocals',
    },
    'Yes, let’s do it.',
  );

  // ── Opportunities ────────────────────────────────────────
  console.log('Opportunities');
  const joel = person('joel');
  async function opportunity(input: { type: string; title: string; description: string; requirements?: string; location: string }) {
    const existing = await prisma.opportunity.findFirst({
      where: { organiserId: joel.id, title: input.title },
      select: { id: true, status: true },
    });
    const o: { id: string; status: string } =
      existing ??
      (await api<{ id: string }>(joel.agent, 'post', '/opportunities', {
        ...input,
        deadline: new Date(Date.now() + 30 * DAY).toISOString(),
      }).then((res) => ({ id: res.id, status: 'DRAFT' })));
    if (o.status === 'DRAFT') await api(joel.agent, 'post', `/opportunities/${o.id}/publish`);
    log(!existing, `opportunity "${input.title}"`);
    return o.id;
  }
  const gig = await opportunity({
    type: 'GIG',
    title: 'DJ for a Saturday open-air set',
    description: 'Two-hour open-air set at the harbour. Sound system and transport provided.',
    requirements: 'A recent recorded set and your own controller.',
    location: 'Douala',
  });
  await opportunity({
    type: 'AUDITION',
    title: 'Backing vocalists for a live session',
    description: 'Two backing vocalists for a filmed live session. Harmonies in French and English.',
    location: 'Douala',
  });
  const applied = await prisma.opportunityApplication.findUnique({
    where: { opportunityId_applicantId: { opportunityId: gig, applicantId: person('lena').id } },
  });
  if (!applied) {
    await api(person('lena').agent, 'post', `/opportunities/${gig}/apply`, {
      message: 'I play afro-house and amapiano open-air sets most weekends. My warm-up mix is in my portfolio.',
    });
  }
  log(!applied, 'lena applies to the DJ gig');

  // ── Competitions ─────────────────────────────────────────
  console.log('Competitions');
  const terms = {
    category: 'PRODUCTION',
    eligibility: 'Open to every MuzikHub member.',
    rules: 'One original instrumental per person. Samples must be cleared or royalty-free. Max 3 minutes.',
    prize: 'A mixing and mastering session, offered by the organiser',
    prizePlaces: 2,
    judgingMethod: 'The organiser scores each entry on the published criteria.',
    disqualification: 'Uncleared samples, plagiarism or late submission.',
    disputeProcess: 'Open a dispute within 7 days of results; MuzikHub staff decide.',
    formats: ['AUDIO'],
    criteria: [
      { name: 'Originality', weight: 60 },
      { name: 'Mix', weight: 40 },
    ],
  };
  async function competition(title: string, description: string, closesAt: Date) {
    const existing = await prisma.competition.findFirst({ where: { organiserId: joel.id, title }, select: { id: true } });
    const id =
      existing?.id ??
      (
        await prisma.competition.findUniqueOrThrow({
          where: {
            slug: (
              await api<{ slug: string }>(joel.agent, 'post', '/competitions', {
                ...terms,
                title,
                description,
                opensAt: new Date(Date.now() - 60_000).toISOString(),
                closesAt: closesAt.toISOString(),
              })
            ).slug,
          },
          select: { id: true },
        })
      ).id;
    let c = await prisma.competition.findUniqueOrThrow({ where: { id } });
    if (c.status === 'DRAFT') {
      await api(joel.agent, 'post', `/competitions/${c.slug}/publish`);
      c = await prisma.competition.findUniqueOrThrow({ where: { id } });
    }
    log(!existing, `competition "${title}"`);
    return c;
  }
  async function enter(key: string, c: { id: string; slug: string; rulesVersion: number; closesAt: Date }, title: string) {
    const exists = await prisma.competitionEntry.findUnique({
      where: { competitionId_participantId: { competitionId: c.id, participantId: person(key).id } },
    });
    if (!exists && c.closesAt > new Date()) {
      const slug = `${c.slug}-${key}`;
      const mediaId = await upload(person(key).agent, 'AUDIO', 'COMPETITION', beatLoop(slug, { bpm: 112 }), `${slug}.wav`);
      await api(person(key).agent, 'put', `/competitions/${c.slug}/entry`, { title, mediaId, acceptedRulesVersion: c.rulesVersion });
      log(true, `${key} enters ${c.slug}`);
    } else log(false, `${key} entry in ${c.slug}${exists ? '' : ' (closed, skipped)'}`);
  }
  const cup = await competition(
    'Douala Amapiano Beat Cup',
    'Make an original amapiano instrumental under three minutes. Clear rules, published criteria.',
    new Date(Date.now() + 30 * DAY),
  );
  await enter('kofi', cup, 'Harbour Lights (Cup edit)');

  const flip = await competition(
    'Makossa Flip Challenge',
    'Flip a classic makossa groove into something new. Results are published, so the whole flow can be shown.',
    new Date(Date.now() + 2 * 3_600_000),
  );
  if (flip.status !== 'RESULTS_PUBLISHED') {
    await enter('kofi', flip, 'Wouri Flip');
    await enter('nadia', flip, 'Bars on Makossa');
    // Demo-only shortcut: move this competition into the past so it can be judged now.
    if (flip.closesAt > new Date()) {
      await prisma.competition.update({
        where: { id: flip.id },
        data: { opensAt: new Date(Date.now() - 3 * DAY), closesAt: new Date(Date.now() - DAY) },
      });
    }
    const scores: Record<string, Record<string, number>> = {
      'Wouri Flip': { Originality: 9, Mix: 8 },
      'Bars on Makossa': { Originality: 8, Mix: 7 },
    };
    const entries = await api<{ items: { id: string; title: string }[] }>(joel.agent, 'get', `/competitions/${flip.slug}/entries`);
    for (const e of entries.items) {
      await api(joel.agent, 'put', `/competition-entries/${e.id}/score`, {
        scores: scores[e.title],
        feedback: 'Strong idea; tighten the low end.',
      });
    }
    await api(joel.agent, 'post', `/competitions/${flip.slug}/results`);
    log(true, 'Makossa Flip Challenge judged and results published');
  } else log(false, 'Makossa Flip Challenge results');

  // ── Moderation example ───────────────────────────────────
  console.log('Moderation');
  const reported = await prisma.report.findUnique({
    where: { reporterId_targetType_targetId: { reporterId: person('sam').id, targetType: 'POST', targetId: spam } },
  });
  if (!reported) {
    await api(person('sam').agent, 'post', '/reports', {
      targetType: 'POST',
      targetId: spam,
      reason: 'SPAM',
      details: 'Selling fake followers.',
    });
  }
  log(!reported, 'sam reports the spam post');

  // Sign the seed's own sessions out again.
  for (const { agent } of Object.values(u)) await agent.post('/api/auth/sign-out').send({});

  writeSheet(password);
  console.log(`\nDone: ${created} created, ${skipped} already present.`);
  console.log(`Credential sheet (git-ignored): ${SHEET.pathname}`);
}

function writeSheet(password: string) {
  const rows = PEOPLE.map(
    (p) =>
      `| ${p.persona} | ${p.name} | \`${p.key}.demo@${DEMO_DOMAIN}\` | ${p.admin ? 'ADMIN' : p.organiser ? 'USER + organiser' : 'USER'} |`,
  );
  const flows = PEOPLE.filter((p) => !p.supporting)
    .map((p) => `### ${p.persona}: ${p.name}\n\n${p.flows.map((f) => `- ${f}`).join('\n')}`)
    .join('\n\n');
  writeFileSync(
    SHEET,
    `# MuzikHub presentation accounts (local only: don't commit or share outside the team)

Created by \`npm run demo:seed -w @muzikhub/api\` on ${new Date().toISOString().slice(0, 10)} in the local development
database. Fictional people on the reserved \`${DEMO_DOMAIN}\` domain; every name ends in "(demo)".

**Password (every account):** \`${password}\`

| Persona | Name | Email | Platform role |
|---|---|---|---|
${rows.join('\n')}

Sign in at http://localhost:5173/login with the email and the password.

**Administrator:** staff must use two-factor authentication. On the first visit to /admin you'll be
asked to set it up: scan the QR code with an authenticator app on the presenter's phone and keep the
backup codes. Do this before the presentation. If the phone is lost:
\`npm run admin:reset-two-factor -w @muzikhub/api\`.

## What to show

${flows}
`,
  );
}

try {
  await main();
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
