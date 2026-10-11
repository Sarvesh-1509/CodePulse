import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

describe("GET /api/health", () => {
  it("returns running status with a dynamic timestamp", async () => {
    const app = createApp();
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("CodePulse API is running");
    expect(typeof res.body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it("returns 404 JSON for unknown routes", async () => {
    const app = createApp();
    const res = await request(app).get("/api/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
