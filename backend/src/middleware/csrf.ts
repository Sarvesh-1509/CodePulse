import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

/**
 * Lightweight CSRF layer for cookie-authenticated state-changing requests.
 *
 * Defence in depth alongside SameSite=Lax cookies and an explicit CORS
 * origin: state-changing fetch calls from the frontend send
 * `Content-Type: application/json`, which triggers a CORS preflight that a
 * cross-site HTML form cannot satisfy. As an extra check, when a browser
 * supplies Origin/Referer it must match FRONTEND_URL.
 *
 * Requests without Origin/Referer (curl, tests, non-browser clients) are
 * allowed through - the session cookie alone still authenticates them.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requireSameOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get("origin");
  const referer = req.get("referer");
  const expected = new URL(env.FRONTEND_URL).origin;

  const matches = (value: string | undefined): boolean => {
    if (!value) return false;
    try {
      return new URL(value).origin === expected;
    } catch {
      return false;
    }
  };

  if ((origin ?? referer) && !matches(origin) && !matches(referer)) {
    res.status(403).json({ success: false, message: "Forbidden origin." });
    return;
  }

  next();
}
