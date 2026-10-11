import { describe, expect, it } from "vitest";
import { fail, ok } from "./index";

describe("shared api response helpers", () => {
  it("builds a success response", () => {
    const res = ok("hello", { a: 1 });
    expect(res.success).toBe(true);
    expect(res.message).toBe("hello");
    expect(res.data).toEqual({ a: 1 });
  });

  it("builds a failure response", () => {
    const res = fail("oops");
    expect(res.success).toBe(false);
    expect(res.message).toBe("oops");
  });
});
