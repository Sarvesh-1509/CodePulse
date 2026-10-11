import type { PlatformId, PlatformInfo } from "@codepulse/shared";
import { HttpError } from "../../utils/httpError";

/**
 * Centralized platform registry (Modules 3-8).
 *
 * Single source of truth for platform identifiers, display names,
 * capabilities, integration availability, and username rules.
 *
 * Availability is honest, not aspirational: Codeforces and LeetCode are
 * fully integrated; CodeChef, GeeksforGeeks, and HackerRank expose profile
 * + aggregate statistics through best-effort public-page adapters WITHOUT
 * reliable dated activity (no "activity" capability) and, for GFG/HackerRank,
 * without contest history (no "contests" capability). A missing capability
 * means the frontend hides that section rather than showing empty data.
 * No platform-specific conditionals should live outside this file and the
 * per-platform adapters.
 */
export const PLATFORM_ORDER: PlatformId[] = [
  "CODEFORCES",
  "LEETCODE",
  "CODECHEF",
  "GEEKSFORGEEKS",
  "HACKERRANK",
];

const REGISTRY: Record<PlatformId, PlatformInfo> = {
  CODEFORCES: {
    id: "CODEFORCES",
    displayName: "Codeforces",
    available: true,
    capabilities: ["profile", "stats", "activity", "contests", "sync"],
    usernameHint: "e.g. tourist",
  },
  LEETCODE: {
    id: "LEETCODE",
    displayName: "LeetCode",
    available: true,
    capabilities: ["profile", "stats", "activity", "contests", "sync"],
    usernameHint: "e.g. your LeetCode username",
  },
  CODECHEF: {
    id: "CODECHEF",
    displayName: "CodeChef",
    available: true,
    capabilities: ["profile", "stats", "contests", "sync"],
    usernameHint: "e.g. gennady.korotkevich",
  },
  GEEKSFORGEEKS: {
    id: "GEEKSFORGEEKS",
    displayName: "GeeksforGeeks",
    available: true,
    capabilities: ["profile", "stats", "sync"],
    usernameHint: "e.g. your GFG profile name",
  },
  HACKERRANK: {
    id: "HACKERRANK",
    displayName: "HackerRank",
    available: true,
    capabilities: ["profile", "stats", "sync"],
    usernameHint: "e.g. your HackerRank username",
  },
};

export function listPlatforms(): PlatformInfo[] {
  return PLATFORM_ORDER.map((id) => REGISTRY[id]);
}

export function getPlatform(id: PlatformId): PlatformInfo {
  return REGISTRY[id];
}

export function isPlatformAvailable(id: PlatformId): boolean {
  return REGISTRY[id].available;
}

/**
 * Validate + normalize a username per the target platform's documented
 * behavior. Codeforces handles are 3-24 chars of letters/digits/underscore
 * (best-effort rule from observed handle constraints). LeetCode validation
 * is intentionally permissive (no whitespace, bounded length) so genuinely
 * valid usernames are never rejected here — the profile lookup is the real
 * check. Case is preserved; adapters compare/store per platform behavior.
 */
export function normalizePlatformUsername(
  platform: PlatformId,
  raw: string
): string {
  const username = raw.trim();
  if (platform === "CODEFORCES") {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      throw new HttpError(
        400,
        "Enter a valid Codeforces handle (3-24 letters, digits or underscores)."
      );
    }
    return username;
  }
  if (platform === "LEETCODE") {
    if (username.length < 1 || username.length > 50 || /\s/.test(username)) {
      throw new HttpError(400, "Enter a valid LeetCode username.");
    }
    return username;
  }
  if (platform === "CODECHEF") {
    // CodeChef handles observed in the wild contain letters, digits,
    // underscores, hyphens, and dots (e.g. "gennady.korotkevich").
    // Permissive here; the profile lookup is the real check.
    if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) {
      throw new HttpError(400, "Enter a valid CodeChef username.");
    }
    return username;
  }
  if (platform === "GEEKSFORGEEKS") {
    // GFG profile slugs are lowercase; normalize so "User" and "user"
    // resolve identically. The lookup remains the real check.
    if (username.length < 1 || username.length > 50 || /\s/.test(username)) {
      throw new HttpError(400, "Enter a valid GeeksforGeeks username.");
    }
    return username.toLowerCase();
  }
  if (platform === "HACKERRANK") {
    if (!/^[A-Za-z0-9_]{1,50}$/.test(username)) {
      throw new HttpError(400, "Enter a valid HackerRank username.");
    }
    return username;
  }
  throw new HttpError(400, "This platform integration is not available yet.");
}
