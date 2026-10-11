import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth/middleware";
import { updateProfileSchema } from "./schemas";
import { updateProfile } from "./service";

/** Self-service profile only (/me): users can never touch another profile. */
export function createUsersRouter() {
  const router = Router();

  router.use(requireAuth);

  router.get("/me", (req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: "Current profile.",
      data: { user: req.authUser },
    });
  });

  router.patch("/me", async (req: Request, res: Response, next) => {
    try {
      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          message: "Invalid profile details.",
          issues: parsed.error.flatten().fieldErrors,
        });
        return;
      }

      // requireAuth guarantees authUser is set.
      const user = await updateProfile(req.authUser!.id, parsed.data);
      res.status(200).json({
        success: true,
        message: "Profile updated.",
        data: { user },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
