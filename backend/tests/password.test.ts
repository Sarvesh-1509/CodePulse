import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword } from "../src/modules/auth/password";

describe("password hashing", () => {
  it("hashes passwords (never stores plaintext)", async () => {
    const hash = await hashPassword("supersecretpassword123");
    expect(hash).not.toContain("supersecretpassword123");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("verifies correct passwords and rejects wrong ones", async () => {
    const hash = await hashPassword("anothersecretpassword!");
    expect(await verifyPassword("anothersecretpassword!", hash)).toBe(true);
    expect(await verifyPassword("wrongpassword1234", hash)).toBe(false);
  });

  it("produces different hashes for the same password (salting)", async () => {
    const a = await hashPassword("samesecretpassword1");
    const b = await hashPassword("samesecretpassword1");
    expect(a).not.toBe(b);
    expect(bcrypt.compareSync("samesecretpassword1", a)).toBe(true);
  });
});
