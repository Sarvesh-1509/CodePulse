import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "../utils/httpError";

export function errorHandler(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const status = err instanceof HttpError ? err.status : 500;
  const message =
    err instanceof Error ? err.message : "Internal server error";

  if (env.NODE_ENV !== "production") {
    console.error(err);
  }

  // Never leak stack traces, SQL internals, or secrets. 4xx messages are
  // safe (crafted in services); 500s are generic in production.
  res.status(status).json({
    success: false,
    message:
      status < 500
        ? message
        : env.NODE_ENV === "production"
          ? "Internal server error"
          : message,
  });
}
