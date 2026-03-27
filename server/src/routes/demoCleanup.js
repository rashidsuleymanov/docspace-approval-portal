import { terminateUsers, deleteUser, deleteRoom } from "../docspaceClient.js";
import { purgeDemoData } from "../store.js";

export async function cleanupDemoSession(session) {
  const sid = String(session?.id || "").trim();
  if (!sid) return { ok: true, errors: [] };
  const errors = [];

  const projectRoomId = session?.requester?.projectRoomId ? String(session.requester.projectRoomId) : "";
  const requesterUserId = session?.requester?.userId ? String(session.requester.userId) : "";
  const recipientUserId = session?.recipient?.userId ? String(session.recipient.userId) : "";

  try {
    purgeDemoData({ projectRoomId, requesterUserId });
  } catch (e) {
    errors.push(`purge:${e?.message || e}`);
    console.warn("[demo-cleanup] purge store failed", sid, e?.message || e);
  }

  if (projectRoomId) {
    await deleteRoom(projectRoomId).catch((e) => {
      errors.push(`deleteRoom:${projectRoomId}:${e?.message || e}`);
      console.warn("[demo-cleanup] deleteRoom failed", sid, projectRoomId, e?.message || e);
    });
  }

  const userIds = [requesterUserId, recipientUserId].filter(Boolean);
  if (userIds.length) {
    await terminateUsers(userIds).catch((e) => {
      errors.push(`terminate:${e?.message || e}`);
      console.warn("[demo-cleanup] terminateUsers failed", sid, userIds.join(","), e?.message || e);
    });
    for (const uid of userIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteUser(uid).catch((e) => {
        errors.push(`deleteUser:${uid}:${e?.message || e}`);
        console.warn("[demo-cleanup] deleteUser failed", sid, uid, e?.message || e);
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
