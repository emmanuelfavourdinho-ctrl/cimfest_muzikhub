/**
 * Local demo data for development and demos ONLY. Never production.
 *
 *   npm run demo:seed -w @muzikhub/api
 *
 * - Refuses unless NODE_ENV is "development" and DATABASE_URL points at a local database
 *   (localhost / 127.0.0.1 / the docker-compose "db" host). Supabase or any remote host is refused.
 * - Everything is created through the real API in-process (validation, permissions,
 *   notifications and audit all apply), never by inventing rows. The one exception is
 *   noted below: a finished competition's dates are moved into the past so judging and
 *   results can be shown without waiting.
 * - Demo accounts are labelled "(demo)" and use the reserved .test domain, which can never
 *   receive email. Idempotent: if demo accounts exist it prints them and stops.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

const DOMAIN = 'demo.muzikhub.test';
const PASSWORD = 'muzikhub-demo-2026';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);

function refuseUnlessLocal() {
  const host = new URL(env.DATABASE_URL).hostname;
  if (env.NODE_ENV !== 'development') throw new Error(`demo:seed runs only with NODE_ENV=development (got ${env.NODE_ENV}).`);
  if (!LOCAL_HOSTS.has(host)) throw new Error(`demo:seed refuses non-local databases (host "${host}"). It is for local development only.`);
}

type Agent = ReturnType<typeof request.agent>;
const PEOPLE = [
  {
    key: 'amara',
    name: 'Amara (demo)',
    primaryUse: 'CREATOR',
    profile: {
      bio: 'Afro-soul singer and songwriter. Writing my first EP.',
      location: 'Douala',
      roles: ['SINGER', 'SONGWRITER'],
      genres: ['afro_pop', 'makossa'],
    },
  },
  {
    key: 'kofi',
    name: 'Kofi (demo)',
    primaryUse: 'CREATOR',
    profile: {
      bio: 'Producer and beatmaker. Amapiano and afrobeats, mostly at night.',
      location: 'Yaoundé',
      roles: ['PRODUCER', 'BEATMAKER'],
      genres: ['amapiano', 'afrobeats'],
    },
  },
  {
    key: 'lena',
    name: 'Lena (demo)',
    primaryUse: 'CREATOR',
    profile: { bio: 'DJ playing open-air sets and weddings.', location: 'Douala', roles: ['DJ'], genres: ['afrobeats', 'amapiano'] },
  },
  {
    key: 'joel',
    name: 'Joel (demo)',
    primaryUse: 'PROFESSIONAL',
    profile: {
      bio: 'Mixing and mastering engineer; I run beat competitions for new producers.',
      location: 'Douala',
      roles: ['MIXING_MASTERING_ENGINEER', 'EVENT_ORGANIZER'],
      genres: ['afrobeats', 'hip_hop'],
    },
  },
  {
    key: 'nadia',
    name: 'Nadia (demo)',
    primaryUse: 'CREATOR',
    profile: {
      bio: 'Rapper and songwriter, bilingual bars.',
      location: 'Bafoussam',
      roles: ['RAPPER', 'SONGWRITER'],
      genres: ['rap', 'hip_hop'],
    },
  },
] as const;
type Key = (typeof PEOPLE)[number]['key'];

async function main() {
  refuseUnlessLocal();
  const existing = await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { username: true } });
  if (existing.length) {
    printAccounts(existing.map((u) => u.username ?? ''));
    console.log('\nDemo data already exists; nothing changed.');
    return;
  }

  const app = createApp();
  const origin = env.WEB_APP_URL;
  const call = async (agent: Agent, method: 'post' | 'put' | 'patch', path: string, body: object = {}, expected = [200, 201]) => {
    const res = await agent[method](`/api/v1${path}`).set('Origin', origin).send(body);
    if (!expected.includes(res.status)) throw new Error(`${method.toUpperCase()} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };

  // ── People ──
  const u = {} as Record<Key, { agent: Agent; username: string; id: string }>;
  for (const p of PEOPLE) {
    const agent = request.agent(app);
    const username = `${p.key}.demo`;
    const res = await agent
      .post('/api/auth/sign-up/email')
      .set('Origin', origin)
      .send({ name: p.name, username, email: `${username}@${DOMAIN}`, password: PASSWORD, primaryUse: p.primaryUse });
    if (res.status !== 200) throw new Error(`sign-up ${username} → ${res.status} ${JSON.stringify(res.body)}`);
    u[p.key] = { agent, username, id: res.body.user.id };
    await prisma.user.update({ where: { id: res.body.user.id }, data: { emailVerified: true } });
    await call(agent, 'patch', '/me/profile', p.profile);
    await call(agent, 'post', '/me/onboarding/complete');
  }
  // Organiser access is granted by an admin in the product (decision D7); the seed stands in for that admin.
  await prisma.user.update({ where: { id: u.joel.id }, data: { isOrganiser: true } });

  // ── Network and feed ──
  for (const [a, b] of [
    ['amara', 'kofi'],
    ['lena', 'kofi'],
    ['nadia', 'amara'],
    ['kofi', 'amara'],
    ['joel', 'kofi'],
  ] as [Key, Key][]) {
    await call(u[a].agent, 'put', `/users/${u[b].username}/follow`);
  }
  await call(u.kofi.agent, 'post', '/posts', { body: 'New amapiano sketch tonight. Log drums in, still looking for a vocal hook.' });
  await call(u.amara.agent, 'post', '/posts', { body: 'Wrote three verses this week for the EP. Studio on Saturday.' });
  await call(u.lena.agent, 'post', '/posts', { body: 'Open-air set at the harbour this weekend. Who’s coming?' });

  // ── Community with discussions ──
  const community = await call(u.kofi.agent, 'post', '/communities', {
    name: 'Douala Producers Circle',
    description: 'Beatmakers and producers sharing techniques, sessions and honest feedback.',
    category: 'PRODUCTION',
    rules: 'Be kind. Credit samples. Feedback before self-promotion.',
    policy: 'OPEN',
  });
  for (const k of ['amara', 'lena', 'joel'] as Key[]) await call(u[k].agent, 'post', `/communities/${community.slug}/join`);
  const question = await call(u.lena.agent, 'post', `/communities/${community.slug}/discussions`, {
    kind: 'QUESTION',
    title: 'How do you keep log drums from muddying the low end?',
    body: 'My amapiano mixes get boomy on club systems. What do you cut, and where?',
  });
  await call(u.joel.agent, 'post', `/discussions/${question.id}/comments`, {
    body: 'High-pass everything else around 30 Hz and sidechain the bass to the log drum. Check on small speakers too.',
  });
  await call(u.kofi.agent, 'post', `/communities/${community.slug}/discussions`, {
    kind: 'DISCUSSION',
    title: 'Monthly feedback thread',
    body: 'Share one work-in-progress and give feedback on two others.',
  });

  // ── Messaging and collaboration ──
  const convo = await call(u.amara.agent, 'post', '/conversations', { username: u.kofi.username });
  await call(u.amara.agent, 'post', `/conversations/${convo.id}/messages`, {
    clientId: randomUUID(),
    body: 'Hi Kofi! Loved your amapiano sketch.',
  });
  await call(u.kofi.agent, 'post', `/conversations/${convo.id}/messages`, {
    clientId: randomUUID(),
    body: 'Thank you! Are you looking for beats for the EP?',
  });
  await call(u.amara.agent, 'post', '/collaborations/requests', {
    username: u.kofi.username,
    type: 'FEATURE',
    title: 'Afro-soul single',
    description: 'A slow afro-soul single about Douala nights. I have the topline and first verse.',
    role: 'Producer',
  });
  const req = await call(u.nadia.agent, 'post', '/collaborations/requests', {
    username: u.amara.username,
    type: 'FEATURE',
    title: 'Bilingual hook',
    description: 'A rap track that needs a sung hook in French and English.',
    role: 'Hook vocals',
  });
  await call(u.amara.agent, 'post', `/collaborations/requests/${req.id}/accept`, { note: 'Yes, let’s do it.' });

  // ── Opportunity ──
  const opp = await call(u.joel.agent, 'post', '/opportunities', {
    type: 'GIG',
    title: 'DJ for a Saturday open-air set',
    description: 'Two-hour open-air set at the harbour; sound system and transport provided.',
    location: 'Douala',
    deadline: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  });
  await call(u.joel.agent, 'post', `/opportunities/${opp.id}/publish`);

  // ── Competitions: one open for entries, one finished with published results ──
  const terms = {
    category: 'PRODUCTION',
    eligibility: 'Open to every MuzikHub member.',
    rules: 'One original instrumental per person. Samples must be cleared or royalty-free. Max 3 minutes.',
    prize: 'A mixing and mastering session, offered by the organiser',
    prizePlaces: 2,
    judgingMethod: 'The organiser scores each entry on the criteria below.',
    disqualification: 'Uncleared samples, plagiarism or late submission.',
    disputeProcess: 'Open a dispute within 7 days of results; MuzikHub staff decide.',
    formats: ['LINK'],
    criteria: [
      { name: 'Originality', weight: 60 },
      { name: 'Mix', weight: 40 },
    ],
  };
  const open = await call(u.joel.agent, 'post', '/competitions', {
    ...terms,
    title: 'Douala Amapiano Beat Cup',
    description: 'Make an original amapiano instrumental under three minutes. Clear rules, published criteria.',
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  });
  await call(u.joel.agent, 'post', `/competitions/${open.slug}/publish`);
  await call(u.kofi.agent, 'put', `/competitions/${open.slug}/entry`, {
    title: 'Harbour Lights',
    externalUrl: 'https://soundcloud.com/example/harbour-lights',
    acceptedRulesVersion: 1,
  });

  const done = await call(u.joel.agent, 'post', '/competitions', {
    ...terms,
    title: 'Makossa Flip Challenge',
    description: 'Flip a classic makossa groove into something new. Results are published so you can see the whole flow.',
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  });
  await call(u.joel.agent, 'post', `/competitions/${done.slug}/publish`);
  for (const [k, title] of [
    ['kofi', 'Wouri Flip'],
    ['nadia', 'Bars on Makossa'],
  ] as [Key, string][]) {
    await call(u[k].agent, 'put', `/competitions/${done.slug}/entry`, {
      title,
      externalUrl: `https://soundcloud.com/example/${k}-flip`,
      acceptedRulesVersion: 1,
    });
  }
  // Demo-only shortcut: move this competition's dates into the past so it can be judged now.
  await prisma.competition.update({
    where: { slug: done.slug },
    data: { opensAt: new Date(Date.now() - 3 * 86_400_000), closesAt: new Date(Date.now() - 86_400_000) },
  });
  const listed = await u.joel.agent.get(`/api/v1/competitions/${done.slug}/entries`);
  const scores: Record<string, Record<string, number>> = {
    'Wouri Flip': { Originality: 9, Mix: 8 },
    'Bars on Makossa': { Originality: 8, Mix: 7 },
  };
  for (const e of listed.body.items as { id: string; title: string }[]) {
    await call(u.joel.agent, 'put', `/competition-entries/${e.id}/score`, {
      scores: scores[e.title],
      feedback: 'Strong idea; tighten the low end.',
    });
  }
  await call(u.joel.agent, 'post', `/competitions/${done.slug}/results`);

  printAccounts(PEOPLE.map((p) => `${p.key}.demo`));
  console.log('\nDemo data created.');
}

function printAccounts(usernames: string[]) {
  console.log(`Demo accounts (local only), password "${PASSWORD}":`);
  for (const name of usernames) console.log(`  ${name}@${DOMAIN}`);
  console.log('  joel.demo is an approved organiser (competitions, opportunities).');
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
