import type { Response } from "express";
import { isProduction } from "../../config/env";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./tokens";

function cookieOptions() {
  return {
    httpOnly: true,
    // Required for cross-site cookies, but ours are same-site; Secure only in
    // production so plain-HTTP localhost development keeps working.
    secure: isProduction,
    sameSite: "lax" as const,
    // Narrowest sensible scope: host-only (no Domain), root path.
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  // clearCookie must repeat path/sameSite so browsers actually drop it.
  res.clearCookie(SESSION_COOKIE_NAME, {
    ...cookieOptions(),
    maxAge: undefined,
  });
}
