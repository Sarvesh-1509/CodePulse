<!-- CodePulse Rating (CPR v1.0.0) Specification & Mathematical Formulation -->
# CodePulse Rating (CPR) — Formula v1.0.0

CPR is a **CodePulse-defined** summary metric on a **0–1000 scale**. It is
not an official rating from Codeforces, LeetCode, or any other platform,
and the dashboard must never present it as one.

## Inputs (all server-side, from the CodePulse database)

| Input | Source | Missing-data rule |
|---|---|---|
| Platform ratings | `PlatformStats.contestRating` for Codeforces, LeetCode, CodeChef | Excluded (never zero) |
| Solved totals | `PlatformStats.totalSolved` summed over accounts that report one | Excluded per account (never zero) |
| Activity days | Verified `ActivityEvent.occurredAt` timestamps | See consistency rules |
| Contest counts | `PlatformStats.contestsAttended` summed over accounts that report one | Excluded per account |

GFG coding scores and HackerRank domain points/badges are **scores, not
ratings** (see development guide) and never enter the rating components.
Per-badge solved counts overlap, so HackerRank contributes no solved total.

## Components (each 0–1000 or null)

**contest** — competitive rating, weight 0.40.
Each available native rating is normalized by a fixed per-platform ceiling,
then averaged:

- Codeforces: `min(rating, 4000) / 4000`
- LeetCode: `min(rating, 3500) / 3500`
- CodeChef: `min(rating, 4000) / 4000`

Ceilings approximate each platform's realistic maximum so different scales
are never added raw. `contest = 1000 * (0.75 * mean(normalized) +
0.25 * min(1, totalContests / 50))`, or null when no rating is available.
Participation is capped so grinding contests cannot dominate the component.

**solving** — problem-solving progress, weight 0.35.
`solvedTotal` is the sum of reported per-platform totals (disjoint problem
pools; the same solve is never counted twice because each platform counts
only its own problems).
`solving = 1000 * log10(1 + solvedTotal) / log10(1 + 10000)`, or null when
no account reports a total. The logarithm keeps raw volume from dominating:
10 solves ≈ 260, 364 solves ≈ 641, 10,000 solves = 1000.

**consistency** — activity consistency, weight 0.25.
`consistency = 1000 * (0.6 * min(1, activeDays90 / 45) + 0.4 * min(1,
longestStreak / 30))`, where `activeDays90` counts distinct active days in
the trailing 90 days and `longestStreak` is the all-time longest run.
Null when no connected account can supply dated activity, or when none of
those accounts has ever synced — unknown history is not scored as zero.
A synced-but-quiet history legitimately scores low; coverage says so.

## Total and coverage

`CPR = round2(weighted mean of AVAILABLE components)`, weights
renormalized over the available set (contest 0.40, solving 0.35,
consistency 0.25). Deterministic: identical inputs always produce identical
outputs (pure function; tested with fixed fixtures).

- **0 components available** → no rating is persisted or shown. Status
  `unavailable` with reasons (e.g. "connect a platform").
- **1–2 components** → persisted and shown with `provisional: true` and a
  visible explanation of what is missing.
- **3 components** → status `ready`.

Coverage travels with every response: components available, connected
platforms, platforms with ratings/activity, total events, whether history
is complete, and human-readable notes. A disconnected platform contributes
nothing — never zero.

## Persistence and recalculation

Results persist in `RatingSnapshot` with `formulaVersion = "1.0.0"`,
component scores, `calculatedAt`, and `coverageMetadata` holding coverage
plus a canonical input summary and its SHA-256 hash. Recalculation is
lazy: every read recomputes from current data, and a new snapshot row is
inserted **only when the inputs hash differs** from the latest snapshot —
repeated recalculation never duplicates rows. Failed upstream syncs never
touch snapshots, so previously valid inputs survive outages.

## Worked example (realistic)

CF rating 892/4000 = 0.223; LC rating 1484.12/3500 ≈ 0.424; mean ≈ 0.324;
contests 5 + 3 = 8 → participation 8/50 = 0.16.
contest = 1000 × (0.75 × 0.324 + 0.25 × 0.16) ≈ 283.
solving: total 209 + 27 + 128 = 364 → 1000 × log10(365)/log10(10001) ≈ 641.
consistency: depends on activity (see tests for fixed-fixture values).
CPR ≈ 0.4 × 283 + 0.35 × 641 + 0.25 × consistency (renormalized if absent).

## Versioning

Any change to ceilings, weights, caps, windows, or missing-data rules
requires a new `formulaVersion` (semver bump) and a new docs section here.
Old snapshots keep their version and remain comparable only within it.
