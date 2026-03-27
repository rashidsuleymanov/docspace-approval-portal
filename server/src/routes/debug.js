import { Router } from "express";
import { getAdminProfile, getTokenClaims, getFormsRoomFolders, requireFormsRoom } from "../docspaceClient.js";

const router = Router();

router.get("/admin-claims", async (_req, res) => {
  try {
    const [profile, claims] = await Promise.all([getAdminProfile(), getTokenClaims()]);
    res.json({
      profile: {
        id: profile?.id,
        displayName: profile?.displayName,
        email: profile?.email,
        isAdmin: profile?.isAdmin,
        isOwner: profile?.isOwner,
        isRoomAdmin: profile?.isRoomAdmin,
        isCollaborator: profile?.isCollaborator
      },
      claims
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

router.get("/forms-room", async (_req, res) => {
  try {
    const room = await requireFormsRoom();
    const folders = await getFormsRoomFolders(room.id).catch(() => null);
    res.json({ room, folders });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

export default router;

