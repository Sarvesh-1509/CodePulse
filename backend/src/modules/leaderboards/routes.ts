import { Router, type Request, type Response } from "express";
import { getSessionToken, requireAuth } from "../auth/middleware";
import { verifySessionToken } from "../auth/tokens";
import { createReadLimiter } from "../auth/rateLimit";
import { leaderboardQuerySchema, roomIdParam } from "./schemas";
import { getBoard } from "./service";

/**
 * Factory (not a singleton router) matching the codebase convention.
 * Mounted at /api/leaderboards.
 *
 * - GET /global is public (opted-in public rows only) with a read limiter
 *   against scraping. No auth needed; `me` is null without a session... but
 *   sessions require cookies, so the route stays cookie-friendly: when a
 *   valid session cookie is present, `me` resolves; otherwise null.
 * - GET /rooms/:roomId requires authentication AND room membership.
 */
export function createLeaderboardsRouter() {
  const router = Router();

  function badRequest(res: Response, message: string, issues?: unknown): void {
    res.status(400).json({ success: false, message, ...(issues ? { issues } : {}) });
  }

  router.get("/global", createReadLimiter(), async (req: Request, res: Response, next) => {
    try {
      const parsed = leaderboardQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Invalid leaderboard query.", parsed.error.flatten().fieldErrors);
        return;
      }
      // Optional session: resolve the viewer without requiring auth. A
      // missing/invalid token simply means me:null, never a 401 here.
      const token = getSessionToken(req);
      const viewerId = token ? verifySessionToken(token) : null;
      const page = await getBoard({ type: "global" }, viewerId, parsed.data);
      res.status(200).json({ success: true, message: "Global leaderboard.", data: page });
    } catch (err) {
      next(err);
    }
  });

  const roomRouter = Router();
  roomRouter.use(requireAuth);

  roomRouter.get("/:roomId", async (req: Request, res: Response, next) => {
    try {
      const id = roomIdParam.safeParse(req.params.roomId);
      if (!id.success) {
        badRequest(res, "Invalid room id.", id.error.flatten().fieldErrors);
        return;
      }
      const parsed = leaderboardQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Invalid leaderboard query.", parsed.error.flatten().fieldErrors);
        return;
      }
      const page = await getBoard(
        { type: "room", roomId: id.data },
        req.authUser!.id,
        parsed.data
      );
      res.status(200).json({ success: true, message: "Room leaderboard.", data: page });
    } catch (err) {
      next(err);
    }
  });

  router.use("/rooms", roomRouter);
  return router;
}
