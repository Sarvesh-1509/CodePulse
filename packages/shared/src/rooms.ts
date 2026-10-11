/**
 * Shared room contracts for CodePulse (Module 13).
 *
 * Serializable DTOs shared by the backend API and the Next.js frontend.
 * No server-only imports here: the frontend must be able to use them.
 * Never includes emails, password hashes, invitation token hashes, or
 * raw invitation tokens except in the single creation response.
 */

import type { PlatformId } from "./platforms";

export type RoomRole = "OWNER" | "MEMBER";

/** Public member card: identity + role only, never email or platform logins. */
export interface RoomMemberDto {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  role: RoomRole;
  joinedAt: string;
}

export interface RoomDto {
  id: string;
  name: string;
  description: string | null;
  /** Role of the requesting user in this room. */
  myRole: RoomRole;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoomDetailsDto extends RoomDto {
  members: RoomMemberDto[];
}

export interface CreateRoomRequest {
  name: string;
  description?: string;
}

export interface UpdateRoomRequest {
  name?: string;
  description?: string | null;
}

export interface RoomInvitationDto {
  id: string;
  roomId: string;
  roomName: string;
  /** ISO expiry, always set. */
  expiresAt: string;
  maxUses: number;
  useCount: number;
  revokedAt: string | null;
  usedAt: string | null;
  createdAt: string;
  createdByUsername: string;
  /** Username of the invited recipient, or null for share-link invitations. */
  invitedUsername: string | null;
}

/** Returned once at creation: the only response that carries the raw token. */
export interface CreatedInvitationDto {
  invitation: RoomInvitationDto;
  /** Raw token — shown once, never stored, never logged. */
  token: string;
  /** App-relative accept path, e.g. `/invite/<token>`. */
  acceptPath: string;
}

export interface InvitationPreviewDto {
  roomName: string;
  memberCount: number;
  expiresAt: string;
  alreadyMember: boolean;
}

/** Per-member progress snapshot shown inside a room. */
export interface RoomMemberProgressDto {
  user: RoomMemberDto["user"];
  role: RoomRole;
  joinedAt: string;
  /** Latest CPR or null when the member has no calculated rating. */
  rating: number | null;
  ratingCalculatedAt: string | null;
  currentStreak: number;
  longestStreak: number;
  totalSolved: number;
  contestsAttended: number;
  activeDays30: number;
  connectedPlatforms: PlatformId[];
}
