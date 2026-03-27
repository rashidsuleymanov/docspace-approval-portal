import Modal from "./Modal.jsx";
import StatusPill from "./StatusPill.jsx";

function normalize(value) {
  return String(value || "").trim();
}

function statusTone(status) {
  const s = String(status || "");
  if (s === "Completed") return "green";
  if (s === "Canceled") return "red";
  if (s === "InProgress") return "yellow";
  if (s === "Queued") return "gray";
  return "gray";
}

function kindLabel(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "fillsign") return "Fill & Sign";
  if (k === "sharedsign") return "Contract";
  return "Approval";
}

function isCopyableLink(kind) {
  const k = String(kind || "").toLowerCase();
  return k !== "fillsign";
}

function uniqueRecipientsFromFlows(flows) {
  const map = new Map(); // email -> flow
  for (const flow of flows || []) {
    const emails = Array.isArray(flow?.recipientEmails) ? flow.recipientEmails : [];
    const email = emails.length === 1 ? normalize(emails[0]).toLowerCase() : "";
    if (!email) continue;
    if (!map.has(email)) map.set(email, flow);
  }
  return Array.from(map.entries()).map(([email, flow]) => ({ email, flow }));
}

export default function RequestDetailsModal({
  open,
  onClose,
  group,
  roomTitleById,
  busy = false,
  onOpen,
  onCopyLink,
  onActivity,
  onCancel,
  onComplete,
  onNotify,
  onRemind,
  canCancel = false,
  canComplete = false
}) {
  const flows = Array.isArray(group?.flows) ? group.flows : [];
  const flow = group?.primaryFlow || flows[0] || null;
  const title = flow?.fileTitle || flow?.templateTitle || "Request";
  const status = String(group?.status || flow?.status || "");
  const kind = String(flow?.kind || "");
  const createdAt = String(group?.createdAt || flow?.createdAt || "");
  const todayIso = new Date().toISOString().slice(0, 10);
  const dueDate =
    normalize(flow?.dueDate) ||
    normalize(flows.find((f) => normalize(f?.dueDate))?.dueDate) ||
    "";
  const isOverdue = Boolean(status === "InProgress" && dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate < todayIso);

  const projectRoomId = normalize(flow?.projectRoomId);
  const projectTitle =
    projectRoomId && roomTitleById && typeof roomTitleById.get === "function" ? roomTitleById.get(projectRoomId) : "";

  const counts = group?.counts || { total: flows.length || 1, completed: 0, canceled: 0 };
  const recipients = uniqueRecipientsFromFlows(flows);

  const linkLabel = status === "Completed" && (flow?.resultFileUrl || flow?.resultFileId) ? "Result" : "Link";
  const linkValue =
    status === "Completed"
      ? String(flow?.resultFileUrl || flow?.openUrl || "")
      : String(flow?.openUrl || "");

  return (
    <Modal
      open={open}
      title={title}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
          {typeof onActivity === "function" && flow?.id ? (
            <button type="button" onClick={() => onActivity(flow)} disabled={busy}>
              Activity
            </button>
          ) : null}
          {typeof onNotify === "function" && status !== "Completed" && status !== "Canceled" ? (
            <button type="button" onClick={() => onNotify(group)} disabled={busy}>
              Notify
            </button>
          ) : null}
          {typeof onRemind === "function" && status === "InProgress" ? (
            <button type="button" onClick={() => onRemind(group)} disabled={busy}>
              Remind
            </button>
          ) : null}
          {typeof onCopyLink === "function" && isCopyableLink(kind) ? (
            <button type="button" onClick={() => onCopyLink(linkValue)} disabled={busy || !normalize(linkValue)}>
              Copy link
            </button>
          ) : null}
          {typeof onComplete === "function" && canComplete ? (
            <button type="button" onClick={() => onComplete(flow)} className="primary" disabled={busy}>
              Complete
            </button>
          ) : typeof onOpen === "function" ? (
            <button
              type="button"
              className="primary"
              onClick={() => onOpen(flow)}
              disabled={busy || status === "Canceled" || !normalize(flow?.openUrl) || (status === "Completed" && !normalize(flow?.resultFileUrl) && !normalize(flow?.openUrl))}
              title={status === "Canceled" ? "Canceled requests cannot be opened" : ""}
            >
              Open
            </button>
          ) : null}
          {typeof onCancel === "function" && canCancel ? (
            <button type="button" className="danger" onClick={() => onCancel(group)} disabled={busy}>
              Cancel request
            </button>
          ) : null}
        </>
      }
    >
      <div className="request-details">
        <div className="request-details-head">
          <div className="request-details-title">
            <strong className="truncate">{title}</strong>
            <div className="request-details-badges">
              <StatusPill tone={statusTone(status)}>{status === "InProgress" ? "In progress" : status || "-"}</StatusPill>
              <StatusPill tone="gray">{kindLabel(kind)}</StatusPill>
              {counts?.total > 1 ? <StatusPill tone="gray">{`${counts.completed || 0}/${counts.total} completed`}</StatusPill> : null}
              {dueDate ? <StatusPill tone={isOverdue ? "red" : "gray"}>{isOverdue ? `Overdue: ${dueDate}` : `Due: ${dueDate}`}</StatusPill> : null}
            </div>
          </div>
        </div>

        <div className="request-details-meta">
          <div className="request-meta-item">
            <span className="muted">Project</span>
            <strong className="truncate">{projectTitle || "Current project"}</strong>
          </div>
          <div className="request-meta-item">
            <span className="muted">Created</span>
            <strong>{createdAt ? createdAt.slice(0, 19).replace("T", " ") : "-"}</strong>
          </div>
          <div className="request-meta-item">
            <span className="muted">Created by</span>
            <strong className="truncate">{flow?.createdByName || flow?.createdByUserId || "-"}</strong>
          </div>
          <div className="request-meta-item">
            <span className="muted">Recipients</span>
            <strong>{recipients.length || 0}</strong>
          </div>
          <div className="request-meta-item">
            <span className="muted">Due date</span>
            <strong>{dueDate || "-"}</strong>
          </div>
        </div>

        <div className="request-details-section">
          <div className="request-details-section-head">
            <strong>Recipients</strong>
            {recipients.length ? <span className="muted">{recipients.length} total</span> : null}
          </div>
          {!recipients.length ? (
            <div className="empty-state">
              <strong>No recipients</strong>
              <p className="muted">This request does not have a recipient list.</p>
            </div>
          ) : (
            <div className="request-details-recipients">
              {recipients.map((r) => {
                const rf = r.flow || {};
                const st = String(rf?.status || "");
                const stage = Number.isFinite(Number(rf?.stageIndex)) ? Number(rf.stageIndex) + 1 : null;
                return (
                  <div key={r.email} className="request-recipient-chip" title={r.email}>
                    <span className="truncate" style={{ minWidth: 0 }}>
                      {r.email}
                    </span>
                    {stage ? <StatusPill tone="gray">{`Step ${stage}`}</StatusPill> : null}
                    <StatusPill tone={statusTone(st)}>{st === "InProgress" ? "In progress" : st || "-"}</StatusPill>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="request-details-section">
          <div className="request-details-section-head">
            <strong>{linkLabel}</strong>
            <span className="muted">{isCopyableLink(kind) ? "Shareable link" : "Open from inbox"}</span>
          </div>
          {isCopyableLink(kind) ? (
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Requires sign-in. Access depends on workspace permissions (typically limited to the recipients listed above). For completed requests, this link opens the result file when available.
            </p>
          ) : (
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Recipients can open this request from their Requests inbox after signing in.
            </p>
          )}
          {normalize(linkValue) ? (
            <div className="request-details-link">
              <input value={linkValue} readOnly />
              {typeof onCopyLink === "function" && isCopyableLink(kind) ? (
                <button type="button" onClick={() => onCopyLink(linkValue)} disabled={busy}>
                  Copy
                </button>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">
              <strong>No link available</strong>
              <p className="muted">This request does not expose a link (or it has not been created yet).</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
