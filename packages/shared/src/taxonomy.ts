/**
 * Fixed vocabularies used by profiles, discovery and onboarding.
 * The keys are stored in the database; labels are for display.
 * Prisma enums in apps/api/prisma/schema.prisma must match the enum keys here.
 */

export const PRIMARY_USES = {
  CREATOR: {
    label: 'Artist or creator',
    description: 'I make, perform or produce music and creative work.',
  },
  FAN: {
    label: 'Fan',
    description: 'I want to discover music, follow creators and join communities.',
  },
  PROFESSIONAL: {
    label: 'Industry professional',
    description: 'I work in management, labels, events, promotion or the business of music.',
  },
} as const;
export type PrimaryUse = keyof typeof PRIMARY_USES;
export const PRIMARY_USE_KEYS = Object.keys(PRIMARY_USES) as [PrimaryUse, ...PrimaryUse[]];

export const CREATIVE_ROLES = {
  ARTIST: 'Artist',
  SINGER: 'Singer / Vocalist',
  RAPPER: 'Rapper',
  SONGWRITER: 'Songwriter',
  PRODUCER: 'Producer',
  BEATMAKER: 'Beatmaker',
  DJ: 'DJ',
  AUDIO_ENGINEER: 'Audio engineer',
  RECORDING_ENGINEER: 'Recording engineer',
  MIXING_MASTERING_ENGINEER: 'Mixing & mastering engineer',
  COMPOSER: 'Composer',
  INSTRUMENTALIST: 'Instrumentalist',
  DANCER: 'Dancer',
  MANAGER: 'Music manager',
  RECORD_LABEL: 'Record label',
  PROMOTER: 'Music promoter',
  EVENT_ORGANIZER: 'Event organiser',
  MARKETER: 'Music marketer',
  TALENT_SCOUT: 'Talent scout',
  OTHER: 'Other music professional',
} as const;
export type CreativeRole = keyof typeof CREATIVE_ROLES;
export const CREATIVE_ROLE_KEYS = Object.keys(CREATIVE_ROLES) as [CreativeRole, ...CreativeRole[]];

/** Roles offered first in onboarding, by primary use. Every role stays selectable. */
export const SUGGESTED_ROLES: Record<PrimaryUse, CreativeRole[]> = {
  CREATOR: ['ARTIST', 'SINGER', 'RAPPER', 'SONGWRITER', 'PRODUCER', 'BEATMAKER', 'DJ', 'INSTRUMENTALIST', 'DANCER', 'COMPOSER'],
  PROFESSIONAL: [
    'MANAGER',
    'RECORD_LABEL',
    'PROMOTER',
    'EVENT_ORGANIZER',
    'MARKETER',
    'TALENT_SCOUT',
    'AUDIO_ENGINEER',
    'RECORDING_ENGINEER',
    'MIXING_MASTERING_ENGINEER',
  ],
  FAN: [],
};

export const GENRES = {
  afrobeats: 'Afrobeats',
  afro_fusion: 'Afro-fusion',
  afro_pop: 'Afro-pop',
  amapiano: 'Amapiano',
  makossa: 'Makossa',
  bikutsi: 'Bikutsi',
  hip_hop: 'Hip-hop',
  rap: 'Rap',
  rnb: 'R&B',
  soul: 'Soul',
  gospel: 'Gospel',
  reggae: 'Reggae',
  dancehall: 'Dancehall',
  afro_house: 'Afro-house',
  electronic: 'Electronic',
  pop: 'Pop',
  jazz: 'Jazz',
  highlife: 'Highlife',
  coupe_decale: 'Coupé-décalé',
  ndombolo: 'Ndombolo',
  rock: 'Rock',
  classical: 'Classical',
  traditional: 'Traditional',
} as const;
export type Genre = keyof typeof GENRES;
export const GENRE_KEYS = Object.keys(GENRES) as [Genre, ...Genre[]];

export const CAREER_STAGES = {
  EMERGING: 'Just getting started',
  DEVELOPING: 'Building momentum',
  ESTABLISHED: 'Established professional',
} as const;
export type CareerStage = keyof typeof CAREER_STAGES;
export const CAREER_STAGE_KEYS = Object.keys(CAREER_STAGES) as [CareerStage, ...CareerStage[]];

export const GOALS = {
  showcase_work: 'Showcase my work',
  find_collaborators: 'Find collaborators',
  discover_music: 'Discover new music',
  find_opportunities: 'Find gigs & opportunities',
  join_communities: 'Join communities',
  learn_and_mentor: 'Learn or mentor',
  discover_talent: 'Discover talent',
} as const;
export type Goal = keyof typeof GOALS;
export const GOAL_KEYS = Object.keys(GOALS) as [Goal, ...Goal[]];
