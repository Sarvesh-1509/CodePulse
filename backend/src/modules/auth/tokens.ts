import jwt from "jsonwebtoken";
import { jwtSecret } from "../../config/env";

// ---------------------------------------------------------------------------
// Security model: stateless signed JWT in an HttpOnly cookie.
// - Short lifetime (24h). Clearing the cookie on logout does NOT revoke an
//   already-issued token; the window is bounded by the short expiration.
// - No refresh tokens, no server-side session store in this module.
// ---------------------------------------------------------------------------

export const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const SESSION_COOKIE_NAME = "codepulse_session";

interface SessionClaims {
  sub: string; // user id
}

export function signSessionToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies SessionClaims, jwtSecret, {
    algorithm: "HS256",
    expiresIn: SESSION_TTL_SECONDS,
  });
}

/** Returns the user id when the token is valid, otherwise null. */
export function verifySessionToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, jwtSecret, {
      algorithms: ["HS256"],
    }) as SessionClaims;
    return typeof payload.sub === "string" && payload.sub.length > 0
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}
