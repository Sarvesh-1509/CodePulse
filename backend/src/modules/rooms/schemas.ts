import { z } from "zod";

export const roomIdParam = z.string().trim().uuid("Invalid room id.");
export const userIdParam = z.string().trim().uuid("Invalid user id.");

/** Raw invitation tokens are 32 random bytes, base64url-encoded (43 chars). */
export const tokenParam = z
  .string()
  .trim()
  .min(32, "Invalid invitation token.")
  .max(64, "Invalid invitation token.")
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid invitation token.");

export const createRoomSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Room name must not be empty.")
      .max(60, "Room name must be at most 60 characters."),
    description: z
      .string()
      .trim()
      .max(500, "Description must be at most 500 characters.")
      .nullable()
      .optional(),
  })
  .strict();

export const updateRoomSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Room name must not be empty.")
      .max(60, "Room name must be at most 60 characters.")
      .optional(),
    description: z
      .string()
      .trim()
      .max(500, "Description must be at most 500 characters.")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  });

export const createInvitationSchema = z
  .object({
    expiresInHours: z.coerce.number().int().min(1).max(720).default(168),
    maxUses: z.coerce.number().int().min(1).max(100).default(1),
    // Optional in-app recipient: when present, the invitation is addressed
    // to exactly this registered username (same rules as profile usernames)
    // instead of being a shareable link.
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
  })
  .strict();

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
