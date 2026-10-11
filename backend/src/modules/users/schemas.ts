import { z } from "zod";

function validTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// PATCH /api/users/me. Strict: unknown or forbidden fields (email,
// passwordHash, id, ...) are rejected with 400 instead of silently ignored.
export const updateProfileSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "Username must be at least 3 characters.")
      .max(30, "Username must be at most 30 characters.")
      .regex(
        /^[A-Za-z0-9_-]+$/,
        "Username may only contain letters, numbers, underscores and hyphens."
      )
      .optional(),
    displayName: z
      .string()
      .trim()
      .min(1, "Display name must not be empty.")
      .max(50, "Display name must be at most 50 characters.")
      .nullable()
      .optional(),
    avatarUrl: z
      .string()
      .trim()
      .max(2048, "Avatar URL is too long.")
      .refine(
        (value) => value === "" || /^https?:\/\/.+/.test(value),
        "Avatar URL must be an http(s) URL."
      )
      .nullable()
      .optional(),
    timezone: z
      .string()
      .trim()
      .min(1, "Timezone must not be empty.")
      .max(64, "Timezone is too long.")
      .refine(validTimezone, "Enter a valid IANA timezone (e.g. UTC, Europe/Berlin).")
      .optional(),
    showOnLeaderboard: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
