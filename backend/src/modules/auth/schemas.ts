import { z } from "zod";
import { normalizeEmail } from "./email";

const usernameRule = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters.")
  .max(30, "Username must be at most 30 characters.")
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Username may only contain letters, numbers, underscores and hyphens."
  );

// bcrypt silently truncates past 72 bytes, so enforce a byte cap instead of
// silently truncating. Minimum 12 characters per the module requirements.
const passwordRule = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must be at most 128 characters.")
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must be at most 72 bytes.",
  });

const emailRule = z
  .string()
  .trim()
  .max(254, "Email must be at most 254 characters.")
  .email("Enter a valid email address.")
  .transform(normalizeEmail);

export const registerSchema = z
  .object({
    username: usernameRule,
    email: emailRule,
    password: passwordRule,
    displayName: z
      .string()
      .trim()
      .min(1, "Display name must not be empty.")
      .max(50, "Display name must be at most 50 characters.")
      .optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailRule,
    // Login accepts any non-empty password: strength was enforced at
    // registration, and failures return a generic credentials error.
    password: z.string().min(1, "Password is required.").max(128),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
