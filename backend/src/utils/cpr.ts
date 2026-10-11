/**
 * CodePulse Rating formula version (single source of truth).
 *
 * Lives in utils (not in any feature module) so both the rating module and
 * the leaderboard module can reference the current version without
 * cross-module imports. rating/formula.ts re-exports it as FORMULA_VERSION
 * so existing imports keep working.
 *
 * Bump alongside any formula change (weights, ceilings, caps, windows,
 * missing-data policy) and document the change in docs/cpr-formula.md.
 * Leaderboards only rank snapshots stamped with this version; older
 * snapshots remain readable as history but never mix into one board.
 */
export const CURRENT_CPR_FORMULA_VERSION = "1.0.0";
