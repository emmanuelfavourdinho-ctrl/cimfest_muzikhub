/**
 * Live payments gate (owner instruction, Phase 3): PAYMENTS_MODE=live refuses to start while
 * this is false. Flipping it is a reviewed code change made only after the owner approves live
 * payments in writing AND Notch Pay has answered the open questions (decisions-and-risks §8.1).
 * An environment variable alone can never enable real money.
 */
export const LIVE_PAYMENTS_APPROVED = false;
