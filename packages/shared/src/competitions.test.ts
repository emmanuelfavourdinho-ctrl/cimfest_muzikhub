import { describe, expect, it } from 'vitest';
import { competitionInputSchema, competitionPhase, rankEntries, weightedTotal } from './competitions.js';

const d = (iso: string) => new Date(iso);
const base = { status: 'PUBLISHED' as const, opensAt: d('2026-12-01T00:00:00Z'), closesAt: d('2026-12-10T00:00:00Z'), extendedUntil: null };

describe('competition phase (database time; extensions recorded)', () => {
  it('boundaries: opens inclusive, closes exclusive', () => {
    expect(competitionPhase(base, d('2026-11-30T23:59:59Z'))).toBe('UPCOMING');
    expect(competitionPhase(base, d('2026-12-01T00:00:00Z'))).toBe('OPEN');
    expect(competitionPhase(base, d('2026-12-09T23:59:59Z'))).toBe('OPEN');
    expect(competitionPhase(base, d('2026-12-10T00:00:00Z'))).toBe('JUDGING');
  });
  it('an extension keeps it open; statuses override dates', () => {
    expect(competitionPhase({ ...base, extendedUntil: d('2026-12-12T00:00:00Z') }, d('2026-12-11T00:00:00Z'))).toBe('OPEN');
    expect(competitionPhase({ ...base, status: 'DRAFT' }, d('2026-12-05T00:00:00Z'))).toBe('DRAFT');
    expect(competitionPhase({ ...base, status: 'CANCELLED' }, d('2026-12-05T00:00:00Z'))).toBe('CANCELLED');
    expect(competitionPhase({ ...base, status: 'RESULTS_PUBLISHED' }, d('2026-12-05T00:00:00Z'))).toBe('RESULTS');
  });
});

describe('scoring and ranking', () => {
  const criteria = [
    { name: 'Originality', weight: 60 },
    { name: 'Mix', weight: 40 },
  ];
  it('weighted total out of 100', () => {
    expect(weightedTotal(criteria, { Originality: 10, Mix: 10 })).toBe(100);
    expect(weightedTotal(criteria, { Originality: 5, Mix: 10 })).toBe(70);
    expect(weightedTotal(criteria, { Originality: 7 })).toBe(42);
  });
  it('average of judges, highest first, ties to the earlier entry, only the prize places', () => {
    const ranked = rankEntries(
      [
        { id: 'a', submittedAt: d('2026-12-02T00:00:00Z'), totals: [80, 90] },
        { id: 'b', submittedAt: d('2026-12-01T00:00:00Z'), totals: [85] },
        { id: 'c', submittedAt: d('2026-12-03T00:00:00Z'), totals: [60] },
        { id: 'd', submittedAt: d('2026-12-03T00:00:00Z'), totals: [] },
      ],
      2,
    );
    expect(ranked).toEqual([
      { id: 'b', placement: 1, average: 85 },
      { id: 'a', placement: 2, average: 85 },
    ]);
  });
});

describe('competition input', () => {
  it('weights must add to 100 and names differ', () => {
    const ok = competitionInputSchema.shape.criteria.safeParse([
      { name: 'Originality', weight: 50 },
      { name: 'Mix', weight: 50 },
    ]);
    expect(ok.success).toBe(true);
    expect(competitionInputSchema.shape.criteria.safeParse([{ name: 'A1', weight: 90 }]).success).toBe(false);
    expect(
      competitionInputSchema.shape.criteria.safeParse([
        { name: 'Mix', weight: 50 },
        { name: 'mix', weight: 50 },
      ]).success,
    ).toBe(false);
  });
});
