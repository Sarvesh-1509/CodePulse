import { z } from "zod";

export const METRICS = ["cpr", "activity", "solved", "streak"] as const;
export const PERIODS = ["7d", "30d", "90d"] as const;

export const PERIOD_DAYS: Record<(typeof PERIODS)[number], number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const roomIdParam = z.string().trim().uuid("Invalid room id.");

export const leaderboardQuerySchema = z
  .object({
    metric: z.enum(METRICS).default("cpr"),
    period: z.enum(PERIODS).default("30d"),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
export type LeaderboardMetricParam = (typeof METRICS)[number];
export type LeaderboardPeriodParam = (typeof PERIODS)[number];
