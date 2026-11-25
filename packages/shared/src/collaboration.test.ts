import { describe, expect, it } from 'vitest';
import { canRequestAction, COLLABORATION_TRANSITIONS, REQUEST_STATUSES, type RequestAction } from './collaboration.js';

const ACTIONS: RequestAction[] = ['accept', 'decline', 'clarify', 'answer', 'cancel'];
/** Independent expectation: [action, actor, allowed statuses]. */
const ALLOWED: Record<string, string[]> = {
  'accept:recipient': ['PENDING', 'CLARIFICATION_REQUESTED'],
  'decline:recipient': ['PENDING', 'CLARIFICATION_REQUESTED'],
  'clarify:recipient': ['PENDING'],
  'answer:sender': ['CLARIFICATION_REQUESTED'],
  'cancel:sender': ['PENDING', 'CLARIFICATION_REQUESTED'],
};

describe('collaboration request lifecycle (every action × actor × status)', () => {
  const cases = ACTIONS.flatMap((a) =>
    (['sender', 'recipient'] as const).flatMap((who) => REQUEST_STATUSES.map((s) => [a, who, s] as const)),
  );
  it.each(cases)('%s by %s from %s', (action, who, status) => {
    expect(canRequestAction(action, status, who)).toBe((ALLOWED[`${action}:${who}`] ?? []).includes(status));
  });
  it('accepted, declined and withdrawn requests are final', () => {
    for (const s of ['ACCEPTED', 'DECLINED', 'CANCELLED'] as const)
      for (const a of ACTIONS) for (const w of ['sender', 'recipient'] as const) expect(canRequestAction(a, s, w)).toBe(false);
  });
  it('completed and closed collaborations are final', () => {
    expect(COLLABORATION_TRANSITIONS.COMPLETED).toEqual([]);
    expect(COLLABORATION_TRANSITIONS.CANCELLED).toEqual([]);
    expect(COLLABORATION_TRANSITIONS.ON_HOLD).toContain('ACTIVE');
  });
});
