import { z } from "zod";

export const ratingHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type RatingHistoryQuery = z.infer<typeof ratingHistoryQuerySchema>;
