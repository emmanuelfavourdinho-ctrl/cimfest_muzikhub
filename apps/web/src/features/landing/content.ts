/**
 * Every word on the landing page. Edit copy here, not in components.
 *
 * Honesty rules (landing brief §3, CLAUDE.md §1.1): features are described as available only
 * if they exist in the product today; everything else is in `roadmap`. No numbers, people,
 * testimonials, partners or prices. Sample names in previews are fictional and labelled.
 */

export type SectionId = 'how-it-works' | 'who-its-for' | 'features' | 'trust' | 'faq' | 'roadmap';

export const nav: { id: SectionId; label: string }[] = [
  { id: 'how-it-works', label: 'How it works' },
  { id: 'who-its-for', label: "Who it's for" },
  { id: 'features', label: 'Features' },
  { id: 'trust', label: 'Trust' },
  { id: 'faq', label: 'FAQ' },
];

export const meta = {
  title: 'MuzikHub — Discover talent. Create together. Grow together.',
  description:
    'MuzikHub is the music-industry ecosystem for artists, producers, DJs, engineers, fans and industry professionals: one profile for every role, a playable portfolio, discovery and a network built around craft.',
};

export const hero = {
  eyebrow: 'The music-industry ecosystem',
  headline: ['Discover talent.', 'Create together.', 'Grow together.'] as const,
  lead: 'One profile for every role you play. Share your music, get found by the people who book, produce and champion talent, and build your network in one place.',
  primary: 'Join MuzikHub',
  secondary: 'See how it works',
  previewLabel: 'Illustrative preview',
  previewAlt:
    'Illustrative preview of MuzikHub: a creator profile card with roles and genres, a track playing in the built-in player, and role chips. Names are fictional.',
};

/** Fictional sample content for previews. Obviously invented; never real people or numbers that imply traction. */
export const sample = {
  creator: { name: 'Lumi Okafor-Vale', handle: 'lumi.sample', roles: ['Producer', 'Songwriter'], genres: ['Afrobeats', 'Neo-soul'], location: 'Douala' },
  track: { title: 'Harmattan Lights', kind: 'Beat · demo', elapsed: '1:24', length: '3:41' },
  roleChips: ['Artist', 'Producer', 'DJ', 'Engineer', 'Songwriter'],
  second: { name: 'Teo Marchetti-Ba', handle: 'teo.sample', roles: ['Mix engineer'] },
  third: { name: 'Ama Riverstone', handle: 'ama.sample', roles: ['DJ', 'Promoter'] },
};

export const problem = {
  eyebrow: 'Why MuzikHub',
  statement: 'Music careers run on connections. Today they are scattered.',
  situations: [
    { title: 'Your work lives in ten places', text: 'Streaming links, video, social posts and a folder of demos — nowhere that shows the whole picture.' },
    { title: 'One person, several roles', text: 'You produce, write and mix, but most profiles let you be only one thing.' },
    { title: 'Good work gets buried', text: 'The people looking for talent can’t easily find you by what you actually do.' },
    { title: 'Collaborators found by chance', text: 'The right producer or engineer is usually a friend of a friend, not someone you could search for.' },
  ],
};

export const value = {
  eyebrow: 'What changes',
  heading: 'One place for your work, your people and your next step.',
  points: [
    {
      title: 'A profile for every role you play',
      text: 'Choose all the roles you work in — artist, producer, DJ, engineer and more — with your genres, location, bio and links to where your music lives, shown with each platform’s own icon.',
    },
    {
      title: 'A portfolio people can play',
      text: 'Publish songs, beats, videos and artwork, or link to where they already live. Visitors can listen right on the page. Keep anything private until it’s ready.',
    },
    {
      title: 'Discovery and a network built around craft',
      text: 'Find people by role, genre and location. Follow the ones you admire, send connection requests to the ones you want to work with, and share updates in your feed.',
    },
  ],
};

export type Audience = { id: string; tab: string; joinLabel: string; summary: string; today: [string, string, string] };

export const audiences: Audience[] = [
  {
    id: 'artists',
    tab: 'Artists',
    joinLabel: 'Join as an artist',
    summary: 'Show the full picture of your music — releases, live performances and visuals — in a profile built for how artists actually work.',
    today: ['Publish songs, videos and artwork to your portfolio', 'Link Spotify, YouTube, SoundCloud and more', 'Get found by role, genre and location in Discover'],
  },
  {
    id: 'producers',
    tab: 'Producers',
    joinLabel: 'Join as a producer',
    summary: 'Let artists hear what you make. Your beats play directly on your profile, next to the other roles you take on.',
    today: ['Upload beats and instrumentals that play on the page', 'List producer alongside songwriter, engineer or artist', 'Connect with artists you want to work with'],
  },
  {
    id: 'djs',
    tab: 'DJs',
    joinLabel: 'Join as a DJ',
    summary: 'Put your mixes, sets and performance clips in one place that promoters and fans can find.',
    today: ['Share mixes and performance videos', 'Post updates about sets in your feed', 'Follow promoters and fellow DJs'],
  },
  {
    id: 'engineers',
    tab: 'Engineers',
    joinLabel: 'Join as an engineer',
    summary: 'Recording, mixing and mastering work deserves to be heard. Show before-and-after work and the genres you know best.',
    today: ['Showcase recordings and mixes in your portfolio', 'Be discoverable as a recording, mixing or mastering engineer', 'Send connection requests to artists and producers'],
  },
  {
    id: 'fans',
    tab: 'Fans',
    joinLabel: 'Join as a fan',
    summary: 'Find new music by the people making it, follow them, and take part in the conversation around their work.',
    today: ['Discover creators by genre and location', 'Follow artists and see their posts in your feed', 'Like and comment on posts'],
  },
  {
    id: 'industry',
    tab: 'Industry professionals',
    joinLabel: 'Join as an industry professional',
    summary: 'Managers, labels, promoters and organisers can find talent by what people actually do, and see their work first.',
    today: ['Search talent by role, genre and location', 'Listen to and watch portfolios before reaching out', 'Connect with the people you want to work with'],
  },
];

export const steps = {
  eyebrow: 'How it works',
  heading: 'From sign-up to your first connection',
  items: [
    { title: 'Create your profile', text: 'Sign up, pick your primary use, then add your roles, genres, location and links during onboarding.', fragment: 'roles' },
    { title: 'Add your work', text: 'Open Studio to upload a track, video or artwork — or link to it — then publish it to your portfolio.', fragment: 'upload' },
    { title: 'Get discovered', text: 'Your public profile and published work appear in Discover, filtered by role, genre and location.', fragment: 'search' },
    { title: 'Connect and grow', text: 'Follow people, send and accept connection requests, and keep up through your feed.', fragment: 'connect' },
  ] as const,
};

export const capabilities = {
  eyebrow: 'Features',
  heading: 'Built for the way music gets made',
  modules: {
    profile: { title: 'Profile and portfolio', text: 'Roles, genres, location, bio and platform links, with the work itself on the same page.' },
    player: { title: 'Built-in player', text: 'Audio plays right on profiles, portfolios and posts — no detour to another app.' },
    discover: { title: 'Discover', text: 'Filter real profiles by role, genre and location.' },
    network: { title: 'Network and feed', text: 'Follow, connect, and share updates with likes and comments.' },
  },
};

export const trust = {
  eyebrow: 'Trust',
  heading: 'How we’re building trust',
  principles: [
    { title: 'Your work and links stay yours', text: 'You decide what goes in your portfolio and which links appear on your profile. Portfolio items can stay private until you publish them.' },
    { title: 'Secure sign-in', text: 'Passwords are hashed, never stored in plain text, and sessions use secure, HTTP-only cookies that page scripts can’t read.' },
    { title: 'Report what’s wrong', text: 'Anyone signed in can report a post, a piece of work or a profile. Reports go to MuzikHub moderators.' },
    { title: 'Accountable moderation', text: 'Moderator actions need a reason and are recorded in an audit log that can’t be edited. Staff accounts require two-step verification.' },
  ],
  later: 'Data export and self-service account deletion are on the roadmap.',
};

export const roadmap = {
  eyebrow: 'Roadmap',
  heading: 'What’s coming',
  intro: 'These are part of the plan for MuzikHub and are not available yet.',
  items: [
    { title: 'Communities', text: 'Ongoing discussions, knowledge-sharing and mentorship around shared interests.' },
    { title: 'Collaboration requests', text: 'Structured requests — “artist looking for a producer” — with clear responses.' },
    { title: 'Opportunities', text: 'Gigs, auditions, events and openings from organisers.' },
    { title: 'Competitions and challenges', text: 'Browse, check eligibility and submit entries.' },
    { title: 'Messages and calls', text: 'One-to-one conversations, then audio and video calls.' },
    { title: 'Promotion', text: 'Optional, clearly labelled promotion for your work.' },
    { title: 'Data export and account deletion', text: 'Download your data or close your account yourself.' },
  ],
};

export const faq = {
  eyebrow: 'FAQ',
  heading: 'Questions, answered',
  items: [
    {
      q: 'What is MuzikHub?',
      a: 'A music-industry ecosystem: a professional profile for every role you play, a portfolio people can listen to, discovery by role, genre and location, and a network of follows and connections.',
    },
    {
      q: 'Who can join?',
      a: 'Anyone involved in music — artists, producers, DJs, engineers, songwriters, fans and industry professionals such as managers, labels, promoters and event organisers.',
    },
    {
      q: 'Is it free?',
      // Pricing for optional paid services is not approved (CLAUDE.md §16.1). Do not add prices here.
      a: 'Yes. Creating a profile, showcasing your work, discovery, following and connecting are free. Optional paid services such as promotion may be added later; they will be clearly labelled, and basic participation will stay free.',
    },
    {
      q: 'How do I keep my music links?',
      a: 'Add links to Spotify, YouTube, SoundCloud, Apple Music, Instagram, TikTok and other platforms in your profile settings. Each one shows its platform’s icon, and portfolio items can link to where the work lives too.',
    },
    {
      q: 'Can I delete my account?',
      a: 'Not from the app yet — self-service deletion is on the roadmap. You can already delete your own posts and portfolio items at any time.',
    },
    {
      q: 'What happens to my data?',
      a: 'MuzikHub stores your account details, your profile, the work you upload and your activity so the product can work. Passwords are hashed and uploaded media is stored with our media provider. The draft Privacy notice explains this in more detail.',
    },
  ],
};

export const finalCta = {
  headline: ['Your music deserves', 'to be found.'] as const,
  primary: 'Join MuzikHub',
  secondary: 'Sign in',
};

export const footer = {
  mission: 'Connecting the people who make, move and love music.',
  tagline: 'A music-industry ecosystem',
  groups: [
    {
      label: 'Product',
      links: [
        { label: 'How it works', to: '/#how-it-works' },
        { label: 'Features', to: '/#features' },
        { label: "Who it's for", to: '/#who-its-for' },
        { label: 'FAQ', to: '/#faq' },
        { label: 'Roadmap', to: '/#roadmap' },
      ],
    },
    {
      label: 'For creators',
      links: [
        { label: 'Join MuzikHub', to: '/register' },
        { label: 'Sign in', to: '/login' },
        { label: 'Discover talent', to: '/discover' },
      ],
    },
    {
      label: 'Trust and support',
      links: [
        { label: 'Contact', to: '/contact' },
        { label: 'Safety and trust', to: '/safety' },
        { label: 'Privacy', to: '/privacy' },
        { label: 'Terms', to: '/terms' },
      ],
    },
  ],
};
