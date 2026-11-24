import { competitionCardSchema, competitionDetailSchema, entryViewSchema, type CompetitionInput } from '@muzikhub/shared';
import { z } from 'zod';
import { request } from './api';

export const compKeys = {
  list: (q: Record<string, string | undefined>) => ['competitions', 'list', q] as const,
  detail: (slug: string) => ['competitions', 'detail', slug] as const,
  entry: (slug: string) => ['competitions', 'entry', slug] as const,
  entries: (slug: string) => ['competitions', 'entries', slug] as const,
};
const enc = encodeURIComponent;
const ok = z.object({}).passthrough();

export const compApi = {
  list: (query: { phase?: string; category?: string; q?: string; mine?: string }) =>
    request('/competitions', z.object({ items: z.array(competitionCardSchema) }), { query }),
  detail: (slug: string) => request(`/competitions/${enc(slug)}`, competitionDetailSchema),
  create: (body: CompetitionInput) => request('/competitions', competitionDetailSchema, { method: 'POST', body }),
  update: (slug: string, body: Partial<CompetitionInput>) =>
    request(`/competitions/${enc(slug)}`, competitionDetailSchema, { method: 'PATCH', body }),
  publish: (slug: string) => request(`/competitions/${enc(slug)}/publish`, competitionDetailSchema, { method: 'POST' }),
  extend: (slug: string, until: string, reason: string) =>
    request(`/competitions/${enc(slug)}/extend`, competitionDetailSchema, { method: 'POST', body: { until, reason } }),
  cancel: (slug: string, reason: string) =>
    request(`/competitions/${enc(slug)}/cancel`, competitionDetailSchema, { method: 'POST', body: { reason } }),
  addJudge: (slug: string, username: string) =>
    request(`/competitions/${enc(slug)}/judges`, competitionDetailSchema, { method: 'POST', body: { username } }),
  removeJudge: (slug: string, username: string) =>
    request(`/competitions/${enc(slug)}/judges/${enc(username)}`, competitionDetailSchema, { method: 'DELETE' }),
  myEntry: (slug: string) => request(`/competitions/${enc(slug)}/entry`, entryViewSchema),
  enter: (
    slug: string,
    body: { title: string; description?: string; mediaId?: string; externalUrl?: string; acceptedRulesVersion: number },
  ) => request(`/competitions/${enc(slug)}/entry`, entryViewSchema, { method: 'PUT', body }),
  withdraw: (slug: string) => request(`/competitions/${enc(slug)}/entry`, ok, { method: 'DELETE' }),
  entries: (slug: string) =>
    request(
      `/competitions/${enc(slug)}/entries`,
      z.object({
        phase: z.string(),
        criteria: z.array(z.object({ name: z.string(), weight: z.number() })),
        items: z.array(entryViewSchema),
      }),
    ),
  score: (id: string, scores: Record<string, number>, feedback?: string) =>
    request(`/competition-entries/${enc(id)}/score`, entryViewSchema, {
      method: 'PUT',
      body: feedback ? { scores, feedback } : { scores },
    }),
  disqualify: (id: string, reason: string) =>
    request(`/competition-entries/${enc(id)}/disqualify`, entryViewSchema, { method: 'POST', body: { reason } }),
  results: (slug: string) => request(`/competitions/${enc(slug)}/results`, competitionDetailSchema, { method: 'POST' }),
  dispute: (slug: string, reason: string) => request(`/competitions/${enc(slug)}/disputes`, ok, { method: 'POST', body: { reason } }),
};

export const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
