import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { assertDatabaseConfigured, prisma } from "../../db/prisma";
import { HttpError } from "../../utils/httpError";
import { computeStreaks, toDayKey } from "../../utils/streaks";
import type {
  CreatedInvitationDto,
  InvitationPreviewDto,
  RoomDetailsDto,
  RoomDto,
  RoomInvitationDto,
  RoomMemberDto,
  RoomMemberProgressDto,
  RoomRole,
} from "@codepulse/shared";
import type { CreateInvitationInput, CreateRoomInput, UpdateRoomInput } from "./schemas";

/**
 * Private rooms (Module 13).
 *
 * Ownership is structural: every mutating operation re-checks membership
 * (and ownership where required) inside the request, never trusting the
 * frontend. Non-members get 404 for any room-scoped read so private room
 * existence cannot be enumerated. Disconnect-style cascades apply: deleting
 * a room removes memberships and invitations with it.
 */

export const MAX_ROOM_MEMBERS = 100;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function memberDto(m: {
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  role: string;
  joinedAt: Date;
}): RoomMemberDto {
  return {
    user: {
      id: m.user.id,
      username: m.user.username,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl,
    },
    role: m.role as RoomRole,
    joinedAt: m.joinedAt.toISOString(),
  };
}

function toRoomDto(
  room: { id: string; name: string; description: string | null; createdAt: Date; updatedAt: Date },
  myRole: RoomRole,
  memberCount: number
): RoomDto {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    myRole,
    memberCount,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}

async function membershipOf(roomId: string, userId: string) {
  return prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
  });
}

/** 404 for non-members so room existence stays private. */
async function requireMember(roomId: string, userId: string) {
  const membership = await membershipOf(roomId, userId);
  if (!membership) {
    throw new HttpError(404, "Room not found.");
  }
  return membership;
}

async function requireOwner(roomId: string, userId: string) {
  const membership = await requireMember(roomId, userId);
  if (membership.role !== "OWNER") {
    throw new HttpError(403, "Only the room owner can do that.");
  }
  return membership;
}

function invitationDto(
  invitation: {
    id: string;
    roomId: string;
    expiresAt: Date;
    maxUses: number;
    useCount: number;
    revokedAt: Date | null;
    usedAt: Date | null;
    createdAt: Date;
  },
  roomName: string,
  createdByUsername: string,
  invitedUsername: string | null = null
): RoomInvitationDto {
  return {
    id: invitation.id,
    roomId: invitation.roomId,
    roomName,
    expiresAt: invitation.expiresAt.toISOString(),
    maxUses: invitation.maxUses,
    useCount: invitation.useCount,
    revokedAt: invitation.revokedAt ? invitation.revokedAt.toISOString() : null,
    usedAt: invitation.usedAt ? invitation.usedAt.toISOString() : null,
    createdAt: invitation.createdAt.toISOString(),
    createdByUsername,
    invitedUsername,
  };
}

function invitedName(
  invitation: { invitedUser: { username: string } | null }
): string | null {
  return invitation.invitedUser ? invitation.invitedUser.username : null;
}

function invitationUsable(invitation: { revokedAt: Date | null; expiresAt: Date; useCount: number; maxUses: number }, now: Date): boolean {
  return (
    invitation.revokedAt === null &&
    invitation.expiresAt.getTime() > now.getTime() &&
    invitation.useCount < invitation.maxUses
  );
}

export async function createRoom(ownerId: string, input: CreateRoomInput): Promise<RoomDto> {
  assertDatabaseConfigured();
  const created = await prisma.$transaction(async (tx) => {
    const room = await tx.room.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        // Legacy required column, unused by the token invitation system.
        inviteCode: randomBytes(9).toString("base64url"),
        ownerId,
      },
    });
    await tx.roomMember.create({
      data: { roomId: room.id, userId: ownerId, role: "OWNER" },
    });
    return room;
  });
  return toRoomDto(created, "OWNER", 1);
}

export async function listRooms(userId: string): Promise<RoomDto[]> {
  assertDatabaseConfigured();
  const memberships = await prisma.roomMember.findMany({
    where: { userId },
    include: { room: { include: { _count: { select: { members: true } } } } },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => toRoomDto(m.room, m.role as RoomRole, m.room._count.members));
}

export async function getRoomDetails(userId: string, roomId: string): Promise<RoomDetailsDto> {
  assertDatabaseConfigured();
  const membership = await requireMember(roomId, userId);
  const room = await prisma.room.findUniqueOrThrow({
    where: { id: roomId },
    include: {
      members: {
        include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        orderBy: { joinedAt: "asc" },
      },
    },
  });
  return {
    ...toRoomDto(room, membership.role as RoomRole, room.members.length),
    members: room.members.map(memberDto),
  };
}

export async function updateRoom(
  userId: string,
  roomId: string,
  input: UpdateRoomInput
): Promise<RoomDto> {
  assertDatabaseConfigured();
  await requireOwner(roomId, userId);
  const room = await prisma.room.update({
    where: { id: roomId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description === "" ? null : input.description }
        : {}),
    },
    include: { _count: { select: { members: true } } },
  });
  return toRoomDto(room, "OWNER", room._count.members);
}

export async function deleteRoom(userId: string, roomId: string): Promise<void> {
  assertDatabaseConfigured();
  await requireOwner(roomId, userId);
  await prisma.room.delete({ where: { id: roomId } });
}

export interface LeaveResult {
  left: boolean;
  roomDeleted: boolean;
  transferredToUsername: string | null;
}

export async function leaveRoom(userId: string, roomId: string): Promise<LeaveResult> {
  assertDatabaseConfigured();
  return prisma.$transaction(async (tx) => {
    const membership = await tx.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!membership) {
      throw new HttpError(404, "Room not found.");
    }
    if (membership.role !== "OWNER") {
      await tx.roomMember.delete({ where: { id: membership.id } });
      return { left: true, roomDeleted: false, transferredToUsername: null };
    }
    const others = await tx.roomMember.findMany({
      where: { roomId, userId: { not: userId } },
      include: { user: { select: { username: true } } },
      orderBy: { joinedAt: "asc" },
    });
    if (others.length === 0) {
      await tx.room.delete({ where: { id: roomId } });
      return { left: true, roomDeleted: true, transferredToUsername: null };
    }
    // Ownership must never dangle: the longest-tenured member inherits it.
    await tx.roomMember.update({
      where: { id: others[0].id },
      data: { role: "OWNER" },
    });
    await tx.room.update({ where: { id: roomId }, data: { ownerId: others[0].userId } });
    await tx.roomMember.delete({ where: { id: membership.id } });
    return { left: true, roomDeleted: false, transferredToUsername: others[0].user.username };
  });
}

export async function listMembers(userId: string, roomId: string): Promise<RoomMemberDto[]> {
  assertDatabaseConfigured();
  await requireMember(roomId, userId);
  const members = await prisma.roomMember.findMany({
    where: { roomId },
    include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return members.map(memberDto);
}

export async function removeMember(
  ownerId: string,
  roomId: string,
  targetUserId: string
): Promise<void> {
  assertDatabaseConfigured();
  await requireOwner(roomId, ownerId);
  if (targetUserId === ownerId) {
    throw new HttpError(400, "Leave the room instead of removing yourself.");
  }
  const target = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: targetUserId } },
  });
  if (!target || target.role !== "MEMBER") {
    throw new HttpError(404, "Member not found in this room.");
  }
  await prisma.roomMember.delete({ where: { id: target.id } });
}

export async function createInvitation(
  ownerId: string,
  roomId: string,
  input: CreateInvitationInput,
  now: Date = new Date()
): Promise<CreatedInvitationDto> {
  assertDatabaseConfigured();
  await requireOwner(roomId, ownerId);
  // In-app invite: addressed to exactly one registered username. Usernames
  // are stored verbatim (case-sensitive unique), so this is an exact match.
  let invitedUserId: string | null = null;
  let maxUses = input.maxUses;
  if (input.username !== undefined) {
    const recipient = await prisma.user.findUnique({
      where: { username: input.username },
    });
    if (!recipient) {
      throw new HttpError(404, "No registered user with that username.");
    }
    if (recipient.id === ownerId) {
      throw new HttpError(400, "You cannot invite yourself.");
    }
    if (await membershipOf(roomId, recipient.id)) {
      throw new HttpError(409, "That user is already a member of this room.");
    }
    const candidates = await prisma.roomInvitation.findMany({
      where: { roomId, invitedUserId: recipient.id, revokedAt: null, expiresAt: { gt: now } },
    });
    if (candidates.some((c) => c.useCount < c.maxUses)) {
      throw new HttpError(409, "That user already has a pending invitation to this room.");
    }
    invitedUserId = recipient.id;
    // One recipient, one seat: a targeted invite is single-use by design.
    maxUses = 1;
  }
  const token = randomBytes(32).toString("base64url");
  const created = await prisma.roomInvitation.create({
    data: {
      roomId,
      tokenHash: hashToken(token),
      createdById: ownerId,
      invitedUserId,
      expiresAt: new Date(now.getTime() + input.expiresInHours * 3_600_000),
      maxUses,
    },
    include: {
      room: { select: { name: true } },
      createdBy: { select: { username: true } },
      invitedUser: { select: { username: true } },
    },
  });
  return {
    invitation: invitationDto(created, created.room.name, created.createdBy.username, invitedName(created)),
    token,
    acceptPath: `/invite/${token}`,
  };
}

export async function listInvitations(
  ownerId: string,
  roomId: string
): Promise<RoomInvitationDto[]> {
  assertDatabaseConfigured();
  await requireOwner(roomId, ownerId);
  const rows = await prisma.roomInvitation.findMany({
    where: { roomId },
    include: {
      room: { select: { name: true } },
      createdBy: { select: { username: true } },
      invitedUser: { select: { username: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => invitationDto(r, r.room.name, r.createdBy.username, invitedName(r)));
}

export async function revokeInvitation(
  ownerId: string,
  invitationId: string
): Promise<RoomInvitationDto> {
  assertDatabaseConfigured();
  const invitation = await prisma.roomInvitation.findUnique({
    where: { id: invitationId },
    include: {
      room: { select: { name: true } },
      createdBy: { select: { username: true } },
      invitedUser: { select: { username: true } },
    },
  });
  if (!invitation) {
    throw new HttpError(404, "Invitation not found.");
  }
  await requireOwner(invitation.roomId, ownerId);
  if (invitation.revokedAt !== null) {
    return invitationDto(invitation, invitation.room.name, invitation.createdBy.username, invitedName(invitation));
  }
  const revoked = await prisma.roomInvitation.update({
    where: { id: invitation.id },
    data: { revokedAt: new Date() },
  });
  return invitationDto(revoked, invitation.room.name, invitation.createdBy.username, invitedName(invitation));
}

export async function validateInvitation(
  userId: string,
  token: string,
  now: Date = new Date()
): Promise<InvitationPreviewDto> {
  assertDatabaseConfigured();
  const invitation = await prisma.roomInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      room: { select: { name: true, _count: { select: { members: true } } } },
    },
  });
  if (!invitation || invitation.invitedUserId !== null) {
    // Generic 404: never reveal which tokens exist. Tokens minted for
    // addressed in-app invites are not openable as links — the recipient
    // accepts from their pending list instead.
    throw new HttpError(404, "Invitation not found.");
  }
  const alreadyMember = (await membershipOf(invitation.roomId, userId)) !== null;
  if (!invitationUsable(invitation, now)) {
    // Members re-opening a link they already used (or that has since
    // expired) still get their preview — they already know the room, so
    // nothing private leaks. Outsiders get the same generic 404 as ever.
    if (!alreadyMember) {
      throw new HttpError(404, "Invitation not found.");
    }
  }
  return {
    roomName: invitation.room.name,
    memberCount: invitation.room._count.members,
    expiresAt: invitation.expiresAt.toISOString(),
    alreadyMember,
  };
}

export interface AcceptResult {
  roomId: string;
  alreadyMember: boolean;
}

/** Transaction client type for the shared acceptance core below. */
type InvitationTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Shared membership-granting core for both token-link and in-app
 * invitation acceptance. Assumes the invitation row was already loaded
 * and authorized by the caller. Idempotent: existing members succeed
 * without consuming a use; the @@unique([roomId, userId]) constraint is
 * the final backstop and callers translate P2002 accordingly.
 */
async function acceptInvitationRow(
  tx: InvitationTx,
  invitation: { id: string; roomId: string; revokedAt: Date | null; expiresAt: Date; useCount: number; maxUses: number },
  userId: string,
  now: Date
): Promise<AcceptResult> {
  const existing = await tx.roomMember.findUnique({
    where: { roomId_userId: { roomId: invitation.roomId, userId } },
  });
  if (existing) {
    // Idempotent repeat acceptance: success without consuming a use.
    // Checked before usability so members re-submitting a now-exhausted
    // single-use link still succeed instead of seeing a stale 404.
    return { roomId: invitation.roomId, alreadyMember: true };
  }
  if (!invitationUsable(invitation, now)) {
    throw new HttpError(404, "Invitation not found.");
  }
  const memberCount = await tx.roomMember.count({
    where: { roomId: invitation.roomId },
  });
  if (memberCount >= MAX_ROOM_MEMBERS) {
    throw new HttpError(403, "This room is full.");
  }
  await tx.roomMember.create({
    data: { roomId: invitation.roomId, userId, role: "MEMBER" },
  });
  const useCount = invitation.useCount + 1;
  await tx.roomInvitation.update({
    where: { id: invitation.id },
    data: {
      useCount,
      ...(useCount >= invitation.maxUses ? { usedAt: new Date() } : {}),
    },
  });
  return { roomId: invitation.roomId, alreadyMember: false };
}

export async function acceptInvitation(
  userId: string,
  token: string,
  now: Date = new Date()
): Promise<AcceptResult> {
  assertDatabaseConfigured();
  try {
    return await prisma.$transaction(async (tx) => {
      const invitation = await tx.roomInvitation.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      if (!invitation || invitation.invitedUserId !== null) {
        throw new HttpError(404, "Invitation not found.");
      }
      return acceptInvitationRow(tx, invitation, userId, now);
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Lost a concurrent-acceptance race: the other request won, and this
      // user is now a member. Report success, not an error.
      return { roomId: (await invitationRoomId(token)) ?? "", alreadyMember: true };
    }
    throw err;
  }
}

async function invitationRoomId(token: string): Promise<string | null> {
  const invitation = await prisma.roomInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { roomId: true },
  });
  return invitation?.roomId ?? null;
}

/**
 * Pending in-app invitations addressed to this user. Only usable rows are
 * returned (not revoked, not expired, uses remaining) and rooms the user
 * already joined are excluded — accepting there would be a no-op.
 * Recipients see only the room name and inviter identity, never tokens.
 */
export async function listReceivedInvitations(
  userId: string,
  now: Date = new Date()
): Promise<RoomInvitationDto[]> {
  assertDatabaseConfigured();
  const [rows, memberships] = await Promise.all([
    prisma.roomInvitation.findMany({
      where: { invitedUserId: userId, revokedAt: null, expiresAt: { gt: now } },
      include: {
        room: { select: { name: true } },
        createdBy: { select: { username: true } },
        invitedUser: { select: { username: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.roomMember.findMany({ where: { userId }, select: { roomId: true } }),
  ]);
  const joined = new Set(memberships.map((m) => m.roomId));
  return rows
    .filter((r) => r.useCount < r.maxUses && !joined.has(r.roomId))
    .map((r) => invitationDto(r, r.room.name, r.createdBy.username, invitedName(r)));
}

/**
 * Accept an addressed invitation by id. Only the recipient can accept;
 * anyone else gets the same generic 404 as for unknown ids so invitation
 * ids cannot be probed. Membership creation reuses the shared core, so
 * double acceptance is idempotent and can never duplicate memberships.
 */
export async function acceptInvitationById(
  userId: string,
  invitationId: string,
  now: Date = new Date()
): Promise<AcceptResult> {
  assertDatabaseConfigured();
  try {
    return await prisma.$transaction(async (tx) => {
      const invitation = await tx.roomInvitation.findUnique({
        where: { id: invitationId },
      });
      if (!invitation || invitation.invitedUserId !== userId) {
        throw new HttpError(404, "Invitation not found.");
      }
      return acceptInvitationRow(tx, invitation, userId, now);
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Lost a concurrent-acceptance race: the other request won, and this
      // user is now a member. Report success, not an error.
      return { roomId: (await invitationRoomIdById(invitationId)) ?? "", alreadyMember: true };
    }
    throw err;
  }
}

async function invitationRoomIdById(invitationId: string): Promise<string | null> {
  const invitation = await prisma.roomInvitation.findUnique({
    where: { id: invitationId },
    select: { roomId: true },
  });
  return invitation?.roomId ?? null;
}

/**
 * Decline an addressed invitation by id. Only the recipient can decline;
 * anyone else gets the generic 404. Marks the invitation revoked so it
 * leaves the pending list; declining twice stays a success.
 */
export async function declineInvitationById(
  userId: string,
  invitationId: string
): Promise<RoomInvitationDto> {
  assertDatabaseConfigured();
  const invitation = await prisma.roomInvitation.findUnique({
    where: { id: invitationId },
    include: {
      room: { select: { name: true } },
      createdBy: { select: { username: true } },
      invitedUser: { select: { username: true } },
    },
  });
  if (!invitation || invitation.invitedUserId !== userId) {
    throw new HttpError(404, "Invitation not found.");
  }
  if (invitation.revokedAt !== null) {
    return invitationDto(invitation, invitation.room.name, invitation.createdBy.username, invitedName(invitation));
  }
  const declined = await prisma.roomInvitation.update({
    where: { id: invitation.id },
    data: { revokedAt: new Date() },
  });
  return invitationDto(declined, invitation.room.name, invitation.createdBy.username, invitedName(invitation));
}

export async function getMemberProgress(
  userId: string,
  roomId: string
): Promise<RoomMemberProgressDto[]> {
  assertDatabaseConfigured();
  await requireMember(roomId, userId);
  const members = await prisma.roomMember.findMany({
    where: { roomId },
    include: {
      user: {
        select: { id: true, username: true, displayName: true, avatarUrl: true, timezone: true },
      },
    },
    orderBy: { joinedAt: "asc" },
  });
  const memberIds = members.map((m) => m.userId);

  const snapshots = await prisma.ratingSnapshot.findMany({
    where: { userId: { in: memberIds } },
    orderBy: { calculatedAt: "desc" },
  });
  const latestSnapshot = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (!latestSnapshot.has(s.userId)) latestSnapshot.set(s.userId, s);
  }

  const events = await prisma.activityEvent.findMany({
    where: { userId: { in: memberIds } },
    select: { userId: true, occurredAt: true },
  });
  const eventsByUser = new Map<string, Date[]>();
  for (const e of events) {
    const list = eventsByUser.get(e.userId) ?? [];
    list.push(e.occurredAt);
    eventsByUser.set(e.userId, list);
  }

  const stats = await prisma.platformStats.findMany({
    where: { linkedAccount: { userId: { in: memberIds } } },
    include: { linkedAccount: { select: { userId: true, platform: true } } },
  });

  return members.map((m) => {
    const snapshot = latestSnapshot.get(m.userId);
    const instants = eventsByUser.get(m.userId) ?? [];
    // Progress windows use each member's own timezone; UTC fallback keeps
    // members without a configured zone comparable.
    const memberTimezone = m.user.timezone ?? "UTC";
    const streak = computeStreaks({
      activeInstants: instants,
      timeZone: memberTimezone,
    });
    const cutoffKey = toDayKey(new Date(Date.now() - 30 * 86_400_000), memberTimezone);
    const activeDays30 = new Set(
      instants
        .map((d) => toDayKey(d, memberTimezone))
        .filter((key) => key >= cutoffKey)
    ).size;
    const mine = stats.filter((s) => s.linkedAccount.userId === m.userId);
    return {
      user: {
        id: m.user.id,
        username: m.user.username,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
      },
      role: m.role as RoomMemberProgressDto["role"],
      joinedAt: m.joinedAt.toISOString(),
      rating: snapshot ? snapshot.rating.toNumber() : null,
      ratingCalculatedAt: snapshot ? snapshot.calculatedAt.toISOString() : null,
      currentStreak: streak.current,
      longestStreak: streak.longest,
      totalSolved: mine.reduce((sum, s) => sum + (s.totalSolved ?? 0), 0),
      contestsAttended: mine.reduce((sum, s) => sum + (s.contestsAttended ?? 0), 0),
      activeDays30,
      connectedPlatforms: [...new Set(mine.map((s) => s.linkedAccount.platform))].sort() as RoomMemberProgressDto["connectedPlatforms"],
    };
  });
}
