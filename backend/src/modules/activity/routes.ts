import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth/middleware";
import { daysQuerySchema, recentQuerySchema, streakQuerySchema } from "./schemas";
import {
  getActivityDays,
  getActivityTotals,
  getRecentActivity,
  getStreakSummary,
} from "./service";

function badRequest(res: Response, message: string, issues?: unknown): void {
  res.status(400).json({ success: false, message, ...(issues ? { issues } : {}) });
}

/**
 * Factory (not a singleton router) matching the codebase convention:
 * every createApp() call gets isolated middleware instances.
 * Mounted at /api/activity. All routes require authentication; users can
 * only ever read their own activity (identity comes from the session).
 */
export function createActivityRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get("/streak", async (req: Request, res: Response, next) => {
    try {
      const parsed = streakQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Invalid streak query.", parsed.error.flatten().fieldErrors);
        return;
      }
      const summary = await getStreakSummary(
        req.authUser!.id,
        req.authUser!.timezone,
        parsed.data.timezone
      );
      const totals = await getActivityTotals(req.authUser!.id);
      res.status(200).json({
        success: true,
        message: "Coding streak.",
        data: { ...summary, totals },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/days", async (req: Request, res: Response, next) => {
    try {
      const parsed = daysQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Invalid activity query.", parsed.error.flatten().fieldErrors);
        return;
      }
      const summary = await getActivityDays(
        req.authUser!.id,
        req.authUser!.timezone,
        parsed.data.days,
        parsed.data.end,
        parsed.data.timezone
      );
      res.status(200).json({
        success: true,
        message: "Daily activity.",
        data: summary,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/recent", async (req: Request, res: Response, next) => {
    try {
      const parsed = recentQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Invalid activity query.", parsed.error.flatten().fieldErrors);
        return;
      }
      const summary = await getRecentActivity(
        req.authUser!.id,
        parsed.data.limit,
        parsed.data.offset,
        parsed.data.platform,
        parsed.data.type
      );
      res.status(200).json({
        success: true,
        message: "Recent activity.",
        data: summary,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
