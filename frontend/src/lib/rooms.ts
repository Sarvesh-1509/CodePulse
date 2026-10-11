import type { RoomDto, RoomInvitationDto } from "@codepulse/shared";

/**
 * Pure rooms helpers (Module 13). No DOM, no fetch: safe to unit test in
 * the node environment and safe to use from client components.
 */

/** Absolute shareable link from an origin and the backend accept path. */
export function toInvitationLink(origin: string, acceptPath: string): string {
  const base = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  const path = acceptPath.startsWith("/") ? acceptPath : `/${acceptPath}`;
  return `${base}${path}`;
}

export type InvitationStatus = "active" | "revoked" | "expired" | "exhausted";

/** Client-side mirror of the backend usability rule (display only). */
export function invitationStatus(
  invitation: Pick<RoomInvitationDto, "revokedAt" | "expiresAt" | "useCount" | "maxUses">,
  now: Date = new Date()
): InvitationStatus {
  if (invitation.revokedAt !== null) return "revoked";
  if (Date.parse(invitation.expiresAt) <= now.getTime()) return "expired";
  if (invitation.useCount >= invitation.maxUses) return "exhausted";
  return "active";
}

export function invitationStatusLabel(status: InvitationStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "revoked":
      return "Revoked";
    case "expired":
      return "Expired";
    case "exhausted":
      return "Used up";
  }
}

export function isRoomOwner(room: Pick<RoomDto, "myRole">): boolean {
  return room.myRole === "OWNER";
}

/** Display name with username fallback. Never touches private fields. */
export function memberDisplayName(member: {
  user: { username: string; displayName: string | null };
}): string {
  return member.user.displayName ?? member.user.username;
}
