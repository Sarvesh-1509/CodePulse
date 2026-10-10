/**
 * CodePulse Rating Routes
 * Exposes endpoints for fetching user CPR ratings and snapshot histories.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth/middleware";
import { ratingHistoryQuerySchema } from "./schemas";
import { getOrRefreshRating, getRatingHistory } from "./service";

/**
 * Factory (not a singleton router) matching the codebase convention.
 * Mounted at /api/rating. All routes require authentication; users can
 * only ever read their own rating (identity comes from the session).
 * Recalculation is a cheap local recompute — identical inputs never write
 * a duplicate snapshot — so no rate limiter is needed.
 */
export function createRatingRouter() {
  const router = Router();

  router.use(requireAuth);

  async function respond(req: Request, res: Response, recalculated: boolean) {
    const result = await getOrRefreshRating(req.authUser!.id, req.authUser!.timezone);
    res.status(200).json({
      success: true,
      message: recalculated
        ? result.snapshotCreated
          ? "CodePulse Rating recalculated."
          : "CodePulse Rating already up to date."
        : "CodePulse Rating.",
      data: { ...result.rating, snapshotCreated: result.snapshotCreated },
    });
  }

  router.get("/", async (req: Request, res: Response, next) => {
    try {
      await respond(req, res, false);
    } catch (err) {
      next(err);
    }
  });

  router.post("/recalculate", async (req: Request, res: Response, next) => {
    try {
      await respond(req, res, true);
    } catch (err) {
      next(err);
    }
  });

  router.get("/history", async (req: Request, res: Response, next) => {
    try {
      const parsed = ratingHistoryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          message: "Invalid rating query.",
          issues: parsed.error.flatten().fieldErrors,
        });
        return;
      }
      const snapshots = await getRatingHistory(req.authUser!.id, parsed.data.limit);
      res.status(200).json({
        success: true,
        message: "CodePulse Rating history.",
        data: { snapshots },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
