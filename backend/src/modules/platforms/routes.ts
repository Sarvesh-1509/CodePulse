import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth/middleware";
import {
  createConnectLimiter,
  createSyncLimiter,
} from "../auth/rateLimit";
import { listPlatforms } from "./registry";
import { connectAccountSchema, platformParamSchema } from "./schemas";
import {
  connectAccount,
  disconnectAccount,
  listLinkedAccounts,
  platformDisplayName,
  syncAccount,
  type AdapterMap,
} from "./service";

/** Public metadata: which platforms exist and which are integrated. */
export function createPlatformsRouter() {
  const router = Router();

  router.get("/", (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: "Supported platforms.",
      data: { platforms: listPlatforms() },
    });
  });

  return router;
}

export interface PlatformAccountsRouterDeps {
  adapters?: AdapterMap;
}

/**
 * Factory (not a singleton router) so tests can inject mock adapters and
 * every createApp() call gets fresh rate-limiter counters.
 * Mounted at /api/platform-accounts. All routes require authentication.
 */
export function createPlatformAccountsRouter(deps?: PlatformAccountsRouterDeps) {
  const router = Router();
  const adapters = deps?.adapters;

  router.use(requireAuth);

  router.get("/", async (req: Request, res: Response, next) => {
    try {
      const accounts = await listLinkedAccounts(req.authUser!.id);
      res.status(200).json({
        success: true,
        message: "Linked platform accounts.",
        data: { accounts },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:platform/connect",
    createConnectLimiter(),
    async (req: Request, res: Response, next) => {
      try {
        const platform = platformParamSchema.safeParse(req.params.platform);
        if (!platform.success) {
          res.status(400).json({
            success: false,
            message: "Unknown platform. Use one of CODEFORCES, LEETCODE, CODECHEF, GEEKSFORGEEKS, HACKERRANK.",
          });
          return;
        }
        const body = connectAccountSchema.safeParse(req.body);
        if (!body.success) {
          res.status(400).json({
            success: false,
            message: "Invalid connection details.",
            issues: body.error.flatten().fieldErrors,
          });
          return;
        }

        const result = await connectAccount(
          req.authUser!.id,
          platform.data,
          body.data.username,
          adapters
        );
        res.status(201).json({
          success: true,
          message: result.truncated
            ? `${platformDisplayName(platform.data)} account connected. History was truncated by upstream limits.`
            : `${platformDisplayName(platform.data)} account connected.`,
          data: { account: result.account },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.delete("/:platform", async (req: Request, res: Response, next) => {
    try {
      const platform = platformParamSchema.safeParse(req.params.platform);
      if (!platform.success) {
        res.status(400).json({
          success: false,
          message: "Unknown platform. Use one of CODEFORCES, LEETCODE, CODECHEF, GEEKSFORGEEKS, HACKERRANK.",
        });
        return;
      }

      const removed = await disconnectAccount(req.authUser!.id, platform.data);
      res.status(200).json({
        success: true,
        message: `${platformDisplayName(platform.data)} account disconnected.`,
        data: { account: removed },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/:platform/sync",
    createSyncLimiter(),
    async (req: Request, res: Response, next) => {
      try {
        const platform = platformParamSchema.safeParse(req.params.platform);
        if (!platform.success) {
          res.status(400).json({
            success: false,
            message: "Unknown platform. Use one of CODEFORCES, LEETCODE, CODECHEF, GEEKSFORGEEKS, HACKERRANK.",
          });
          return;
        }

        const result = await syncAccount(req.authUser!.id, platform.data, adapters);
        res.status(200).json({
          success: true,
          message: result.truncated
            ? "Synchronization complete. History was truncated by upstream limits."
            : "Synchronization complete.",
          data: { account: result.account },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
