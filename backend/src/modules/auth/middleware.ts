/**
 * CodePulse Authentication Middleware
 * Extracts session cookies and attaches authenticated user identity to Request.
 */
import type { NextFunction, Request, Response } from "express";
import { getUserById } from "./service";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./tokens";
import type { SafeUser } from "./serialize";

/** Authenticated identity attached to the request by requireAuth. */
declare global {
  namespace Express {
    interface Request {
      authUser?: SafeUser;
    }
  }
}

export function getSessionToken(req: Request): string | null {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  return typeof token === "string" && token.length > 0 ? token : null;
}

function unauthorized(res: Response): void {
  res.status(401).json({ success: false, message: "Authentication required" });
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = getSessionToken(req);
    if (!token) {
      unauthorized(res);
      return;
    }

    const userId = verifySessionToken(token);
    if (!userId) {
      unauthorized(res);
      return;
    }

    // Never trust ids supplied by the frontend: reload the user from the
    // database on every request so deleted accounts lose access immediately.
    // Database failures propagate to the error handler (500), not a 401.
    const user = await getUserById(userId);
    if (!user) {
      unauthorized(res);
      return;
    }

    req.authUser = user;
    next();
  } catch (err) {
    next(err);
  }
}
