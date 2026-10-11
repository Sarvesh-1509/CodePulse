import { Router, type Request, type Response } from "express";
import { clearSessionCookie, setSessionCookie } from "./cookies";
import { requireAuth } from "./middleware";
import { createLoginLimiter, createRegisterLimiter } from "./rateLimit";
import { loginSchema, registerSchema } from "./schemas";
import { authenticateUser, registerUser } from "./service";
import { signSessionToken } from "./tokens";

/**
 * Factory (not a singleton router) so every createApp() call gets fresh
 * rate-limiter counters. Mounted at /api/auth.
 */
export function createAuthRouter() {
  const router = Router();

  router.post(
    "/register",
    createRegisterLimiter(),
    async (req: Request, res: Response, next) => {
      try {
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            success: false,
            message: "Invalid registration details.",
            issues: parsed.error.flatten().fieldErrors,
          });
          return;
        }

        const user = await registerUser(parsed.data);
        setSessionCookie(res, signSessionToken(user.id));
        res.status(201).json({
          success: true,
          message: "Account created.",
          data: { user },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post(
    "/login",
    createLoginLimiter(),
    async (req: Request, res: Response, next) => {
      try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            success: false,
            message: "Invalid login details.",
            issues: parsed.error.flatten().fieldErrors,
          });
          return;
        }

        const user = await authenticateUser(parsed.data);
        setSessionCookie(res, signSessionToken(user.id));
        res.status(200).json({
          success: true,
          message: "Logged in.",
          data: { user },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post("/logout", (req: Request, res: Response) => {
    clearSessionCookie(res);
    res.status(200).json({ success: true, message: "Logged out." });
  });

  router.get("/me", requireAuth, (req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: "Current user.",
      data: { user: req.authUser },
    });
  });

  return router;
}
