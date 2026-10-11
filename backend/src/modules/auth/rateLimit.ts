import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

/**
 * Fresh limiter instances per application (created inside the auth route
 * factory) so tests and server reloads do not share counters.
 *
 * - Login: 10 attempts per 10 minutes per IP. Counts every attempt, including
 *   unknown accounts, so attackers cannot probe credentials at scale.
 * - Register: 20 accounts per hour per IP. Generous enough for local
 *   development, tight enough to blunt mass-registration abuse.
 */
export function createLoginLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message: "Too many login attempts. Please try again later.",
      });
    },
  });
}

export function createRegisterLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message: "Too many registration attempts. Please try again later.",
      });
    },
  });
}

/**
 * Platform endpoints trigger third-party fetches, so they are rate-limited
 * separately. Fresh instances per application, same as above.
 *
 * - Connect: 30 per hour per IP (each attempt may call Codeforces/LeetCode).
 * - Sync: 20 per hour per IP (each sync may page upstream history).
 */
export function createConnectLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message: "Too many connection attempts. Please try again later.",
      });
    },
  });
}

export function createSyncLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message: "Too many synchronization requests. Please try again later.",
      });
    },
  });
}

/**
 * Room invitation endpoints. Fresh instances per application, same as above.
 *
 * - Create: 20 per hour per IP (each mints a cryptographic token).
 * - Validate: 60 per hour per IP. Strict on purpose: validation is the
 *   only endpoint that answers about token existence, so probing it at
 *   scale must be expensive.
 */
export function createInvitationLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message: "Too many invitation requests. Please try again later.",
      });
    },
  });
}

export function createInvitationValidateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message: "Too many invitation checks. Please try again later.",
      });
    },
  });
}

/**
 * Public read endpoints (global leaderboards). Generous: reads are cheap
 * aggregates, but unauthenticated scraping should still be throttled.
 */
export function createReadLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
      });
    },
  });
}
