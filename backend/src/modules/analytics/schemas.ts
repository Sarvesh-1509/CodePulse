import { z } from "zod";

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "1y"] as const;
export type AnalyticsRangeParam = (typeof ANALYTICS_RANGES)[number];

export const RANGE_DAYS: Record<AnalyticsRangeParam, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

const MAX_CUSTOM_SPAN_DAYS = 366;

function validTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneQuery = z
  .string()
  .trim()
  .min(1, "Timezone must not be empty.")
  .max(64, "Timezone is too long.")
  .refine(validTimezone, "Enter a valid IANA timezone (e.g. UTC, Europe/Berlin).")
  .optional();

const dayKey = z
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

/**
 * Either a preset range or an explicit custom window — never both, so
 * period boundaries stay unambiguous. Custom windows cap at 366 days and
 * may not end in the future.
 */
export const rangeQuerySchema = z
  .object({
    range: z.enum(ANALYTICS_RANGES).optional(),
    start: dayKey.optional(),
    end: dayKey.optional(),
    timezone: timezoneQuery,
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasPreset = value.range !== undefined;
    const hasCustom = value.start !== undefined || value.end !== undefined;
    if (hasPreset && hasCustom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either a preset range or start/end dates, not both.",
      });
      return;
    }
    if ((value.start === undefined) !== (value.end === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Custom ranges need both start and end dates.",
      });
      return;
    }
    if (value.start !== undefined && value.end !== undefined) {
      if (value.start > value.end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The start date must be on or before the end date.",
        });
        return;
      }
      const span =
        (Date.parse(`${value.end}T00:00:00Z`) - Date.parse(`${value.start}T00:00:00Z`)) /
          86_400_000 +
        1;
      if (span > MAX_CUSTOM_SPAN_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Custom ranges cover at most ${MAX_CUSTOM_SPAN_DAYS} days.`,
        });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (value.end > today) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "The end date cannot be in the future.",
        });
      }
    }
  });

export type RangeQuery = z.infer<typeof rangeQuerySchema>;

export const contestHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

export type ContestHistoryQuery = z.infer<typeof contestHistoryQuerySchema>;
