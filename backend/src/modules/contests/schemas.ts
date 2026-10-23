import { z } from "zod";
import type { ContestDifficulty } from "@codepulse/shared";

const CONTEST_DIFFICULTIES = ["EASY", "MEDIUM", "HARD", "MIXED"] as const;

const TOPIC_MAX = 30;

/** Name of a personal contest. */
export const contestNameSchema = z
  .string()
  .trim()
  .min(1, "Contest name must not be empty.")
  .max(100, "Contest name must be at most 100 characters.");

export const createContestSchema = z
  .object({
    roomId: z.string().uuid("Invalid room id."),
    name: contestNameSchema,
    description: z
      .string()
      .trim()
      .max(1000, "Description must be at most 1000 characters.")
      .nullable()
      .optional(),
    difficulty: z
      .enum(CONTEST_DIFFICULTIES)
      .default("MIXED")
      .refine(
        (value) => CONTEST_DIFFICULTIES.includes(value as ContestDifficulty),
        "Difficulty must be Easy, Medium, Hard, or Mixed."
      ),
    topics: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Topic must not be empty.")
          .max(TOPIC_MAX, `Topic must be at most ${TOPIC_MAX} characters.`)
      )
      .max(8, "Select at most 8 topics.")
      .optional(),
  })
  .strict();

export const publishContestSchema = z.object({}).strict();

export const completeProblemSchema = z.object({}).strict();

export type CreateContestInput = z.infer<typeof createContestSchema>;
export type PublishContestInput = z.infer<typeof publishContestSchema>;
export type CompleteProblemInput = z.infer<typeof completeProblemSchema>;
