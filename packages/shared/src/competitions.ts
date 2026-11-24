import { z } from 'zod';
import { normaliseHttpsUrl } from './links.js';
import { personSummarySchema } from './portfolio.js';

/** Competitions (FR-30–33, COMP-001–009). */
export const COMPETITION_CATEGORIES = {
  SONGWRITING: 'Songwriting',
  PRODUCTION: 'Production / beats',
  VOCALS: 'Vocals',
  PERFORMANCE: 'Live performance',
  DJ: 'DJ mix',
  REMIX: 'Remix',
  VIDEO: 'Music video',
  OTHER: 'Other',
} as const;
export type CompetitionCategory = keyof typeof COMPETITION_CATEGORIES;
export const COMPETITION_CATEGORY_KEYS = Object.keys(COMPETITION_CATEGORIES) as [CompetitionCategory, ...CompetitionCategory[]];
export const ENTRY_FORMATS = { AUDIO: 'Audio upload', VIDEO: 'Video upload', IMAGE: 'Image upload', LINK: 'Link (https)' } as const;
export type EntryFormat = keyof typeof ENTRY_FORMATS;
export const ENTRY_FORMAT_KEYS = Object.keys(ENTRY_FORMATS) as [EntryFormat, ...EntryFormat[]];

/** Days after results during which an entrant may open a dispute. */
export const DISPUTE_WINDOW_DAYS = 7;
export const SCORE_MAX = 10;

export type CompetitionPhase = 'DRAFT' | 'UPCOMING' | 'OPEN' | 'JUDGING' | 'RESULTS' | 'CANCELLED';
export const PHASE_LABELS: Record<CompetitionPhase, string> = {
  DRAFT: 'Draft',
  UPCOMING: 'Opens soon',
  OPEN: 'Open for entries',
  JUDGING: 'Closed · judging',
  RESULTS: 'Results published',
  CANCELLED: 'Cancelled',
};

/** The phase at a given (database) time. An authorised extension replaces the closing date. */
export function competitionPhase(
  c: { status: 'DRAFT' | 'PUBLISHED' | 'RESULTS_PUBLISHED' | 'CANCELLED'; opensAt: Date; closesAt: Date; extendedUntil: Date | null },
  now: Date,
): CompetitionPhase {
  if (c.status === 'DRAFT') return 'DRAFT';
  if (c.status === 'CANCELLED') return 'CANCELLED';
  if (c.status === 'RESULTS_PUBLISHED') return 'RESULTS';
  if (now < c.opensAt) return 'UPCOMING';
  return now < (c.extendedUntil ?? c.closesAt) ? 'OPEN' : 'JUDGING';
}

export interface Criterion {
  name: string;
  weight: number;
}
/** Weighted total 0–100 from per-criterion scores 0–10. Missing criteria score 0. */
export function weightedTotal(criteria: Criterion[], scores: Record<string, number>): number {
  const sum = criteria.reduce((t, c) => t + ((scores[c.name] ?? 0) / SCORE_MAX) * c.weight, 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Ranking: average of the judges' totals, highest first; ties go to the earlier submission
 * (published as the tie-break rule). Disqualified entries are excluded by the caller.
 */
export function rankEntries<T extends { id: string; submittedAt: Date; totals: number[] }>(entries: T[], places: number) {
  return entries
    .filter((e) => e.totals.length > 0)
    .map((e) => ({ ...e, average: Math.round((e.totals.reduce((a, b) => a + b, 0) / e.totals.length) * 100) / 100 }))
    .sort((a, b) => b.average - a.average || a.submittedAt.getTime() - b.submittedAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, places)
    .map((e, i) => ({ id: e.id, placement: i + 1, average: e.average }));
}

const longText = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max);
const criteriaSchema = z
  .array(z.strictObject({ name: z.string().trim().min(2).max(40), weight: z.number().int().min(1).max(100) }))
  .min(1, 'Add at least one judging criterion')
  .max(6, 'Up to 6 criteria')
  .refine((c) => c.reduce((t, x) => t + x.weight, 0) === 100, 'Criteria weights must add up to 100')
  .refine((c) => new Set(c.map((x) => x.name.toLowerCase())).size === c.length, 'Each criterion needs a different name');

export const competitionInputSchema = z.strictObject({
  title: longText(5, 120, 'Title'),
  description: longText(30, 4000, 'Description'),
  category: z.enum(COMPETITION_CATEGORY_KEYS),
  eligibility: longText(10, 2000, 'Eligibility'),
  rules: longText(20, 8000, 'Rules'),
  prize: longText(3, 1000, 'Prize'),
  prizePlaces: z.number().int().min(1).max(10),
  judgingMethod: longText(10, 2000, 'Judging method'),
  disqualification: longText(10, 2000, 'Disqualification'),
  disputeProcess: longText(10, 2000, 'Disputes'),
  formats: z.array(z.enum(ENTRY_FORMAT_KEYS)).min(1, 'Allow at least one kind of entry').max(4),
  criteria: criteriaSchema,
  opensAt: z.iso.datetime(),
  closesAt: z.iso.datetime(),
  coverId: z.string().min(1).nullable().optional(),
});
export type CompetitionInput = z.infer<typeof competitionInputSchema>;
export const updateCompetitionSchema = competitionInputSchema.partial().strict();
export const extendSchema = z.strictObject({ until: z.iso.datetime(), reason: longText(5, 500, 'Reason') });
export const cancelCompetitionSchema = z.strictObject({ reason: longText(5, 500, 'Reason') });
export const judgeSchema = z.strictObject({ username: z.string().trim().toLowerCase().min(1).max(40) });
export const entryInputSchema = z.strictObject({
  title: longText(2, 120, 'Title'),
  description: z.string().trim().max(2000).optional(),
  mediaId: z.string().min(1).optional(),
  externalUrl: z
    .string()
    .trim()
    .max(500)
    .transform((v, ctx) => {
      const u = normaliseHttpsUrl(v);
      if (!u) {
        ctx.addIssue({ code: 'custom', message: 'Use a full https:// link' });
        return z.NEVER;
      }
      return u;
    })
    .optional(),
  /** COMP-004: the rules version you read and accept (must be the current one). */
  acceptedRulesVersion: z.number().int().min(1),
});
export const scoreSchema = z.strictObject({
  scores: z.record(z.string(), z.number().int().min(0).max(SCORE_MAX)),
  feedback: z.string().trim().max(2000).optional(),
});
export const disqualifySchema = z.strictObject({ reason: longText(5, 500, 'Reason') });
export const disputeSchema = z.strictObject({ reason: longText(20, 2000, 'Explain the problem') });
export const resolveDisputeSchema = z.strictObject({
  outcome: z.enum(['UPHELD', 'REJECTED']),
  resolution: longText(10, 2000, 'Resolution'),
});
export const competitionQuerySchema = z.object({
  phase: z.enum(['UPCOMING', 'OPEN', 'JUDGING', 'RESULTS']).optional(),
  category: z.enum(COMPETITION_CATEGORY_KEYS).optional(),
  q: z.string().trim().max(80).optional(),
  mine: z.enum(['organising', 'entered', 'judging']).optional(),
});

export const competitionCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  category: z.enum(COMPETITION_CATEGORY_KEYS),
  phase: z.enum(['DRAFT', 'UPCOMING', 'OPEN', 'JUDGING', 'RESULTS', 'CANCELLED']),
  cover: z.string().nullable(),
  prize: z.string(),
  opensAt: z.string(),
  closesAt: z.string(),
  extendedUntil: z.string().nullable(),
  entryCount: z.number().int(),
  organiser: personSummarySchema,
  featured: z.boolean(),
});
export type CompetitionCard = z.infer<typeof competitionCardSchema>;

export const competitionDetailSchema = competitionCardSchema.extend({
  description: z.string(),
  eligibility: z.string(),
  rules: z.string(),
  rulesVersion: z.number().int(),
  prizePlaces: z.number().int(),
  judgingMethod: z.string(),
  disqualification: z.string(),
  disputeProcess: z.string(),
  formats: z.array(z.enum(ENTRY_FORMAT_KEYS)),
  criteria: z.array(z.object({ name: z.string(), weight: z.number() })),
  extensionReason: z.string().nullable(),
  cancelReason: z.string().nullable(),
  resultsPublishedAt: z.string().nullable(),
  judges: z.array(personSummarySchema),
  viewer: z.object({
    isOrganiser: z.boolean(),
    isJudge: z.boolean(),
    canEnter: z.boolean(),
    cannotEnterReason: z.string().nullable(),
    entryId: z.string().nullable(),
    entryRulesVersion: z.number().int().nullable(),
    canDispute: z.boolean(),
    disputeStatus: z.enum(['OPEN', 'UPHELD', 'REJECTED']).nullable(),
  }),
  results: z.array(
    z.object({
      placement: z.number().int(),
      averageScore: z.number(),
      entry: z.object({
        id: z.string(),
        title: z.string(),
        participant: personSummarySchema,
        externalUrl: z.string().nullable(),
        media: z.unknown().nullable(),
      }),
    }),
  ),
});
export type CompetitionDetail = z.infer<typeof competitionDetailSchema>;

export const entryViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  participant: personSummarySchema,
  externalUrl: z.string().nullable(),
  media: z.unknown().nullable(),
  rulesVersion: z.number().int(),
  status: z.enum(['SUBMITTED', 'WITHDRAWN', 'DISQUALIFIED']),
  disqualifiedReason: z.string().nullable(),
  submittedAt: z.string(),
  updatedAt: z.string(),
  /** Your own judgement (judges), or every judgement (organiser; entrant after results). */
  judgements: z.array(
    z.object({
      judge: personSummarySchema.nullable(),
      scores: z.record(z.string(), z.number()),
      total: z.number(),
      feedback: z.string().nullable(),
    }),
  ),
  averageScore: z.number().nullable(),
});
export type EntryView = z.infer<typeof entryViewSchema>;
