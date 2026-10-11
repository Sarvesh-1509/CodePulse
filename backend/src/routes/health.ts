import { Router, type Request, type Response } from "express";
import { checkDatabase } from "../db/prisma";

const router = Router();

// Module 0 contract, unchanged.
router.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "CodePulse API is running",
    timestamp: new Date().toISOString(),
  });
});

// Separate database health: keeps /health stable while giving operators and
// tests an explicit connectivity signal. Never exposes connection strings,
// SQL internals, or stack traces.
router.get("/health/db", async (_req: Request, res: Response) => {
  const status = await checkDatabase();
  if (status.database === "connected") {
    res.status(200).json({
      success: true,
      message: "Database is reachable.",
      data: status,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.status(503).json({
    success: false,
    message: "Database is unreachable. Check DATABASE_URL and PostgreSQL.",
    data: status,
    timestamp: new Date().toISOString(),
  });
});

export default router;
