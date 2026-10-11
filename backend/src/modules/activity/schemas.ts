import { z } from "zod";

const PLATFORM_IDS = [
  "CODEFORCES",
  "LEETCODE",
  "CODECHEF",
  "GEEKSFORGEEKS",
  "HACKERRANK",
] as const;

const ACTIVITY_TYPES = ["PROBLEM_SOLVED", "CONTEST_PARTICIPATION", "SUBMISSION"] as const;

const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Timezone must not be empty.")
  .max(64, "Timezone is too long.")
  .refine((value) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Enter a valid IANA timezone (e.g. UTC, Europe/Berlin).");

const dayKeySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD dates.")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const check = new Date(Date.UTC(y, m - 1, d, 12));
    return (
      check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d
    );
  }, "Enter a real calendar date.");

export const streakQuerySchema = z
  .object({
    timezone: timezoneSchema.optional(),
  })
  .strict();

/** Heatmap/timeline window: trailing `days` ending at `end` (default today). */
export const daysQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(732).default(90),
    end: dayKeySchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict();

export const recentQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    platform: z.enum(PLATFORM_IDS).optional(),
    type: z.enum(ACTIVITY_TYPES).optional(),
  })
  .strict();

export type StreakQuery = z.infer<typeof streakQuerySchema>;
export type DaysQuery = z.infer<typeof daysQuerySchema>;
export type RecentQuery = z.infer<typeof recentQuerySchema>;
