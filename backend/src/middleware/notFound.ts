/**
 * CodePulse 404 Fallback Middleware
 * Handles unmatched route requests with standard JSON error response.
 */
import type { Request, Response } from "express";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
}
