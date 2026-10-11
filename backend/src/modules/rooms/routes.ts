import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth/middleware";
import {
  createInvitationLimiter,
  createInvitationValidateLimiter,
} from "../auth/rateLimit";
import {
  createInvitationSchema,
  createRoomSchema,
  roomIdParam,
  tokenParam,
  updateRoomSchema,
  userIdParam,
} from "./schemas";
import {
  acceptInvitation,
  acceptInvitationById,
  createInvitation,
  createRoom,
  declineInvitationById,
  deleteRoom,
  getMemberProgress,
  getRoomDetails,
  leaveRoom,
  listInvitations,
  listMembers,
  listReceivedInvitations,
  listRooms,
  removeMember,
  revokeInvitation,
  updateRoom,
  validateInvitation,
} from "./service";

function badRequest(res: Response, message: string, issues?: unknown): void {
  res.status(400).json({ success: false, message, ...(issues ? { issues } : {}) });
}

/**
 * Factory (not a singleton router) matching the codebase convention.
 * Mounted at /api/rooms. Invitation accept/validate live here too so the
 * token never appears in an unrelated module's routes.
 */
export function createRoomsRouter() {
  const router = Router();

  router.use(requireAuth);

  function param(res: Response, schema: typeof roomIdParam, value: unknown) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      badRequest(res, "Invalid request.", parsed.error.flatten().fieldErrors);
      return null;
    }
    return parsed.data;
  }

  router.post("/", createInvitationLimiter(), async (req: Request, res: Response, next) => {
    try {
      const parsed = createRoomSchema.safeParse(req.body);
      if (!parsed.success) {
        badRequest(res, "Invalid room details.", parsed.error.flatten().fieldErrors);
        return;
      }
      const room = await createRoom(req.authUser!.id, parsed.data);
      res.status(201).json({ success: true, message: "Room created.", data: { room } });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req: Request, res: Response, next) => {
    try {
      const rooms = await listRooms(req.authUser!.id);
      res.status(200).json({ success: true, message: "Rooms.", data: { rooms } });
    } catch (err) {
      next(err);
    }
  });

  // Invitation acceptance and validation come before :id routes so a token
  // can never be mistaken for a room id.
  router.get("/invitations/received", async (req, res, next) => {
    try {
      const invitations = await listReceivedInvitations(req.authUser!.id);
      res.status(200).json({ success: true, message: "Received invitations.", data: { invitations } });
    } catch (err) {
      next(err);
    }
  });

  router.post("/invitations/received/:invitationId/accept", async (req, res, next) => {
    try {
      const invitationId = param(res, roomIdParam, req.params.invitationId);
      if (invitationId === null) return;
      const result = await acceptInvitationById(req.authUser!.id, invitationId);
      res.status(result.alreadyMember ? 200 : 201).json({
        success: true,
        message: result.alreadyMember ? "Already a member of this room." : "Joined room.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/invitations/received/:invitationId/decline", async (req, res, next) => {
    try {
      const invitationId = param(res, roomIdParam, req.params.invitationId);
      if (invitationId === null) return;
      const invitation = await declineInvitationById(req.authUser!.id, invitationId);
      res.status(200).json({ success: true, message: "Invitation declined.", data: { invitation } });
    } catch (err) {
      next(err);
    }
  });

  router.get("/invitations/:token/validate", createInvitationValidateLimiter(), async (req, res, next) => {
    try {
      const token = param(res, tokenParam, req.params.token);
      if (token === null) return;
      const preview = await validateInvitation(req.authUser!.id, token);
      res.status(200).json({ success: true, message: "Invitation preview.", data: preview });
    } catch (err) {
      next(err);
    }
  });

  router.post("/invitations/:token/accept", async (req, res, next) => {
    try {
      const token = param(res, tokenParam, req.params.token);
      if (token === null) return;
      const result = await acceptInvitation(req.authUser!.id, token);
      res.status(result.alreadyMember ? 200 : 201).json({
        success: true,
        message: result.alreadyMember ? "Already a member of this room." : "Joined room.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/invitations/:invitationId/revoke", async (req, res, next) => {
    try {
      const invitationId = param(res, roomIdParam, req.params.invitationId);
      if (invitationId === null) return;
      const invitation = await revokeInvitation(req.authUser!.id, invitationId);
      res.status(200).json({ success: true, message: "Invitation revoked.", data: { invitation } });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, roomIdParam, req.params.id);
      if (id === null) return;
      const room = await getRoomDetails(req.authUser!.id, id);
      res.status(200).json({ success: true, message: "Room details.", data: { room } });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, roomIdParam, req.params.id);
      if (id === null) return;
      const parsed = updateRoomSchema.safeParse(req.body);
      if (!parsed.success) {
        badRequest(res, "Invalid room details.", parsed.error.flatten().fieldErrors);
        return;
      }
      const room = await updateRoom(req.authUser!.id, id, parsed.data);
      res.status(200).json({ success: true, message: "Room updated.", data: { room } });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, roomIdParam, req.params.id);
      if (id === null) return;
      await deleteRoom(req.authUser!.id, id);
      res.status(200).json({ success: true, message: "Room deleted.", data: {} });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/leave", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, roomIdParam, req.params.id);
      if (id === null) return;
      const result = await leaveRoom(req.authUser!.id, id);
      res.status(200).json({
        success: true,
        message: result.roomDeleted
          ? "Left and deleted the room."
          : result.transferredToUsername
            ? `Left the room. Ownership transferred to ${result.transferredToUsername}.`
            : "Left the room.",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/members", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, roomIdParam, req.params.id);
      if (id === null) return;
      const members = await listMembers(req.authUser!.id, id);
      res.status(200).json({ success: true, message: "Room members.", data: { members } });
    } catch (err) {
      next(err);
    }
  });

  // Member progress: members-only (enforced in the service). Exposes the
  // privacy-safe RoomMemberProgressDto list — never emails, platform
  // logins, or full activity histories.
  router.get("/:id/progress", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, roomIdParam, req.params.id);
      if (id === null) return;
      const progress = await getMemberProgress(req.authUser!.id, id);
      res.status(200).json({ success: true, message: "Room member progress.", data: { progress } });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id/members/:userId", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, roomIdParam, req.params.id);
      if (id === null) return;
      const target = param(res, userIdParam, req.params.userId);
      if (target === null) return;
      await removeMember(req.authUser!.id, id, target);
      res.status(200).json({ success: true, message: "Member removed.", data: {} });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/invitations", createInvitationLimiter(), async (req, res, next) => {
    try {
      const id = param(res, roomIdParam, req.params.id);
      if (id === null) return;
      const parsed = createInvitationSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        badRequest(res, "Invalid invitation details.", parsed.error.flatten().fieldErrors);
        return;
      }
      const created = await createInvitation(req.authUser!.id, id, parsed.data);
      res.status(201).json({ success: true, message: "Invitation created.", data: created });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/invitations", async (req: Request, res: Response, next) => {
    try {
      const id = param(res, roomIdParam, req.params.id);
      if (id === null) return;
      const invitations = await listInvitations(req.authUser!.id, id);
      res.status(200).json({ success: true, message: "Room invitations.", data: { invitations } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
