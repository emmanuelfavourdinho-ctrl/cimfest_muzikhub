import { z } from 'zod';
import { pageQuerySchema, pageSchema, personSummarySchema } from './portfolio.js';

/** FR-34..37. Organisers need admin approval (decision D7). */
export const OPPORTUNITY_TYPES = {
  GIG: 'Gig',
  AUDITION: 'Audition',
  EVENT: 'Event',
  JOB: 'Job',
  COLLABORATION: 'Collaboration',
} as const;
export type OpportunityType = keyof typeof OPPORTUNITY_TYPES;
export const OPPORTUNITY_TYPE_KEYS = Object.keys(OPPORTUNITY_TYPES) as [OpportunityType, ...OpportunityType[]];

export const OPPORTUNITY_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;
export const APPLICATION_STATUSES = ['SUBMITTED', 'SHORTLISTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
/** Decisions an organiser can make about an application. */
export const ORGANISER_DECISIONS = ['SHORTLISTED', 'ACCEPTED', 'REJECTED'] as const;

const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be at most ${max} characters`);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

const opportunityFields = {
  type: z.enum(OPPORTUNITY_TYPE_KEYS),
  title: text(3, 120, 'Title'),
  description: text(20, 5000, 'Description'),
  requirements: optionalText(2000),
  location: optionalText(120),
  remote: z.boolean(),
  /** ISO date-time. Must be in the future when publishing (checked on the server). */
  deadline: z.iso.datetime({ offset: true }),
};

export const createOpportunitySchema = z.strictObject({ ...opportunityFields, remote: opportunityFields.remote.default(false) });
export type CreateOpportunityInput = z.input<typeof createOpportunitySchema>;
export const updateOpportunitySchema = z.strictObject(opportunityFields).partial();
export type UpdateOpportunityInput = z.input<typeof updateOpportunitySchema>;

export const listOpportunitiesQuerySchema = pageQuerySchema.extend({
  type: z.enum(OPPORTUNITY_TYPE_KEYS).optional(),
  location: z.string().trim().max(120).optional(),
  /** Default: only opportunities still accepting applications. */
  open: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export const applySchema = z.strictObject({ message: text(1, 2000, 'Message') });
export const applicationDecisionSchema = z.strictObject({ status: z.enum(ORGANISER_DECISIONS) });
export const grantOrganiserSchema = z.strictObject({ grant: z.boolean(), reason: text(5, 500, 'Reason') });

export const myApplicationSchema = z.object({
  id: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  message: z.string(),
  createdAt: z.string(),
});

export const opportunitySchema = z.object({
  id: z.string(),
  type: z.enum(OPPORTUNITY_TYPE_KEYS),
  title: z.string(),
  description: z.string(),
  requirements: z.string().nullable(),
  location: z.string().nullable(),
  remote: z.boolean(),
  deadline: z.string(),
  status: z.enum(OPPORTUNITY_STATUSES),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  organiser: personSummarySchema,
  /** True while PUBLISHED and before the deadline. */
  acceptingApplications: z.boolean(),
  isOwner: z.boolean(),
  /** Owner only. */
  applicationCount: z.number().int().nullable(),
  myApplication: myApplicationSchema.nullable(),
});
export type OpportunityView = z.infer<typeof opportunitySchema>;
export const opportunityPageSchema = pageSchema(opportunitySchema);

export const applicationSchema = z.object({
  id: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  message: z.string(),
  createdAt: z.string(),
  applicant: personSummarySchema,
});
export type ApplicationView = z.infer<typeof applicationSchema>;
export const applicationPageSchema = pageSchema(applicationSchema);

/** Whether the signed-in user may create opportunities, and if not, why (shown honestly in the UI). */
export const organiserStatusSchema = z.object({
  canOrganise: z.boolean(),
  missing: z.array(z.enum(['ADMIN_APPROVAL', 'VERIFIED_EMAIL', 'PROFESSIONAL_ACCOUNT'])),
});
export type OrganiserStatus = z.infer<typeof organiserStatusSchema>;
