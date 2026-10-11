import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { requireSameOrigin } from "./middleware/csrf";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFound";
import { createAuthRouter } from "./modules/auth/routes";
import { createUsersRouter } from "./modules/users/routes";
import {
  createPlatformAccountsRouter,
  createPlatformsRouter,
} from "./modules/platforms/routes";
import { createActivityRouter } from "./modules/activity/routes";
import { createAnalyticsRouter } from "./modules/analytics/routes";
import { createRatingRouter } from "./modules/rating/routes";
import { createRoomsRouter } from "./modules/rooms/routes";
import { createLeaderboardsRouter } from "./modules/leaderboards/routes";
import type { AdapterMap } from "./modules/platforms/service";
import healthRouter from "./routes/health";

export interface CreateAppOptions {
  /**
   * Override platform adapters (tests inject mocks; production uses live
   * Codeforces/LeetCode adapters). Undefined entries fall back per call.
   */
  platformAdapters?: AdapterMap;
}

export function createApp(options?: CreateAppOptions) {
  const app = express();

  // Trust the first proxy (production deployments behind a reverse proxy)
  // so Secure cookies and client IPs behave. Never set to `true`.
  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(cookieParser());
  app.use(
    cors({
      // Explicit origin + credentials. Never a wildcard with credentials.
      origin: env.FRONTEND_URL,
      credentials: true,
    })
  );

  app.use("/api", healthRouter);

  // CSRF check for cookie-authenticated state changes (allows requests
  // without Origin/Referer from curl/tests; browsers must match origin).
  app.use("/api/auth", requireSameOrigin, createAuthRouter());
  app.use("/api/users", requireSameOrigin, createUsersRouter());
  app.use("/api/platforms", createPlatformsRouter());
  app.use(
    "/api/platform-accounts",
    requireSameOrigin,
    createPlatformAccountsRouter(
      options?.platformAdapters ? { adapters: options.platformAdapters } : undefined
    )
  );
  app.use("/api/activity", requireSameOrigin, createActivityRouter());
  app.use("/api/rating", requireSameOrigin, createRatingRouter());
  app.use("/api/analytics", requireSameOrigin, createAnalyticsRouter());
  app.use("/api/rooms", requireSameOrigin, createRoomsRouter());
  // Leaderboards: global board is public (opted-in rows only); the room
  // board enforces membership inside its router. Same mounting convention
  // as the public /api/platforms router.
  app.use("/api/leaderboards", createLeaderboardsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
