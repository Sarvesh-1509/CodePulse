import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth/middleware";
import { contestHistoryQuerySchema, rangeQuerySchema } from "./schemas";
import {
  getCompare,
  getContests,
  getNativeRatings,
  getPlatformsBreakdown,
  getSummary,
  getTrends,
  resolveWindow,
} from "./service";

function badRequest(res: Response, message: string, issues?: unknown): void {
  res.status(400).json({ success: false, message, ...(issues ? { issues } : {}) });
}

/**
 * Factory (not a singleton router) matching the codebase convention.
 * Mounted at /api/analytics. All routes require authentication; users can
 * only ever read their own analytics (identity comes from the session).
 */
export function createAnalyticsRouter() {
  const router = Router();

  router.use(requireAuth);

  function windowFrom(req: Request, res: Response) {
    const parsed = rangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      badRequest(res, "Invalid analytics query.", parsed.error.flatten().fieldErrors);
      return null;
    }
    const q = parsed.data;
    return resolveWindow(q.range, q.start, q.end, q.timezone, req.authUser!.timezone);
  }

  router.get("/summary", async (req: Request, res: Response, next) => {
    try {
      const window = windowFrom(req, res);
      if (!window) return;
      const summary = await getSummary(req.authUser!.id, window);
      res.status(200).json({ success: true, message: "Analytics summary.", data: summary });
    } catch (err) {
      next(err);
    }
  });

  router.get("/trends", async (req: Request, res: Response, next) => {
    try {
      const window = windowFrom(req, res);
      if (!window) return;
      const trends = await getTrends(req.authUser!.id, window);
      res.status(200).json({ success: true, message: "Activity trends.", data: trends });
    } catch (err) {
      next(err);
    }
  });

  router.get("/compare", async (req: Request, res: Response, next) => {
    try {
      const window = windowFrom(req, res);
      if (!window) return;
      const comparison = await getCompare(req.authUser!.id, window);
      res.status(200).json({ success: true, message: "Period comparison.", data: comparison });
    } catch (err) {
      next(err);
    }
  });

  router.get("/platforms", async (req: Request, res: Response, next) => {
    try {
      const window = windowFrom(req, res);
      if (!window) return;
      const breakdown = await getPlatformsBreakdown(req.authUser!.id, window);
      res.status(200).json({ success: true, message: "Platform breakdown.", data: breakdown });
    } catch (err) {
      next(err);
    }
  });

  router.get("/contests", async (req: Request, res: Response, next) => {
    try {
      const parsed = contestHistoryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Invalid analytics query.", parsed.error.flatten().fieldErrors);
        return;
      }
      const contests = await getContests(req.authUser!.id, parsed.data.limit, parsed.data.offset);
      res.status(200).json({ success: true, message: "Contest history.", data: contests });
    } catch (err) {
      next(err);
    }
  });

  router.get("/ratings", async (req: Request, res: Response, next) => {
    try {
      const ratings = await getNativeRatings(req.authUser!.id);
      res.status(200).json({ success: true, message: "Rating histories.", data: ratings });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
