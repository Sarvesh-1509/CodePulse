import { z } from "zod";

const PLATFORM_IDS = [
  "CODEFORCES",
  "LEETCODE",
  "CODECHEF",
  "GEEKSFORGEEKS",
  "HACKERRANK",
] as const;

/** Case-insensitive platform identifiers: `/codeforces/connect` works. */
export const platformParamSchema = z
  .string()
  .trim()
  .min(1, "Platform is required.")
  .toUpperCase()
  .pipe(z.enum(PLATFORM_IDS));

export const connectAccountSchema = z
  .object({
    username: z
      .string()
      .min(1, "Platform username is required.")
      .max(50, "Platform username is too long."),
  })
  .strict();

export type PlatformParam = z.infer<typeof platformParamSchema>;
export type ConnectAccountInput = z.infer<typeof connectAccountSchema>;
