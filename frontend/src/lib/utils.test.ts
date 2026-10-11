import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn utility", () => {
  it("merges class names", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });

  it("resolves tailwind conflicts with tailwind-merge", () => {
    expect(cn("px-4", "px-6")).toBe("px-6");
  });

  it("ignores falsy values", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });
});
