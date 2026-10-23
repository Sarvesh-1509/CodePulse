import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { requireSameOrigin } from "../../middleware/csrf";
import {
  createContestSchema,
  publishContestSchema,
  completeProblemSchema,
  type CreateContestInput,
} from "./schemas";
import {
  createContest,
  getContest,
  regenerateContest,
  publishContest,
  startContest,
  getAttempt,
  completeProblem,
  listContests,
  getResults,
} from "./service";

function badRequest(res: Response, message: string, issues?: unknown): void {
  res.status(400).json({ success: false, message, ...(issues ? { issues } : {}) });
}

const zSchema = {
  contestId: z.string().trim().uuid("Invalid contest id."),
  problemId: z.string().trim().uuid("Invalid problem id."),
};

function param(res: Response, schema: (typeof zSchema)["contestId"] | (typeof zSchema)["problemId"], value: unknown): string | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    badRequest(res, "Invalid request.", parsed.error.flatten().fieldErrors);
    return null;
  }
  return parsed.data;
}

/**
 * Personal contests (Module 15).
 *
 * Mounted at /api/contests. Every route requires authentication and room
 * membership (enforced inside the service), so non-members cannot enumerate
 * or access a room's contests. All mutating routes are CSRF-protected like
 * the other cookie-authenticated modules.
 */
export function createContestsRouter() {
  const router = Router();

  router.use(requireAuth);

  // --- List contests -------------------------------------------------------
  router.get("/", async (req: Request, res: Response, next) => {
    try {
      const contests = await listContests(req.authUser!.id, {
        roomId: typeof req.query.roomId === "string" ? req.query.roomId : undefined,
      });
      res.status(200).json({ success: true, message: "Contests.", data: { contests } });
    } catch (err) {
      next(err);
    }
  });

  // --- Create --------------------------------------------------------------
  router.post("/", async (req: Request, res: Response, next) => {
    try {
      const parsed = createContestSchema.safeParse(req.body);
      if (!parsed.success) {
        badRequest(res, "Invalid contest details.", parsed.error.flatten().fieldErrors);
        return;
      }
      const contest = await createContest(req.authUser!.id, {
        ...parsed.data,
        roomId: req.body.roomId,
      } as CreateContestInput & { roomId: string });
      res.status(201).json({ success: true, message: "Draft contest created.", data: { contest } });
    } catch (err) {
      next(err);
    }
  });

  // --- Contest-scoped routes -----------------------------------------------
  router.get("/:id", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, zSchema.contestId, req.params.id);
      if (id === null) return;
      const contest = await getContest(req.authUser!.id, id);
      res.status(200).json({ success: true, message: "Contest.", data: { contest } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/regenerate", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, zSchema.contestId, req.params.id);
      if (id === null) return;
      const contest = await regenerateContest(req.authUser!.id, id);
      res.status(200).json({ success: true, message: "Problems regenerated.", data: { contest } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/publish", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, zSchema.contestId, req.params.id);
      if (id === null) return;
      const parsed = publishContestSchema.safeParse(req.body);
      if (!parsed.success) {
        badRequest(res, "Invalid request.", parsed.error.flatten().fieldErrors);
        return;
      }
      const contest = await publishContest(req.authUser!.id, id);
      res.status(200).json({ success: true, message: "Contest published.", data: { contest } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/start", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, zSchema.contestId, req.params.id);
      if (id === null) return;
      const attempt = await startContest(req.authUser!.id, id);
      res.status(201).json({ success: true, message: "Contest started.", data: { attempt } });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/attempt", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, zSchema.contestId, req.params.id);
      if (id === null) return;
      const attempt = await getAttempt(req.authUser!.id, id);
      res.status(200).json({ success: true, message: "Attempt.", data: { attempt } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/attempt/problems/:problemId/complete", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, zSchema.contestId, req.params.id);
      if (id === null) return;
      const problemId = param(res, zSchema.problemId, req.params.problemId);
      if (problemId === null) return;
      const parsed = completeProblemSchema.safeParse(req.body);
      if (!parsed.success) {
        badRequest(res, "Invalid request.", parsed.error.flatten().fieldErrors);
        return;
      }
      const attempt = await completeProblem(req.authUser!.id, id, problemId);
      res.status(200).json({ success: true, message: "Problem marked complete.", data: { attempt } });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/results", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, zSchema.contestId, req.params.id);
      if (id === null) return;
      const results = await getResults(req.authUser!.id, id);
      res.status(200).json({ success: true, message: "Contest results.", data: { results } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
