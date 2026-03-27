import { useEffect, useMemo, useState } from "react";
import EmptyState from "./EmptyState.jsx";
import Modal from "./Modal.jsx";
import { getFlowAudit } from "../services/portalApi.js";

function toCsvValue(value) {
  const s = String(value ?? "");
  if (s.includes("\"") || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll("\"", "\"\"")}"`;
  }
  return s;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AuditModal({ open, onClose, token, flowId, title = "Activity" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [events, setEvents] = useState([]);
  const [flow, setFlow] = useState(null);

  useEffect(() => {
    if (!open) return;
    const id = String(flowId || "").trim();
    if (!token || !id) return;
    setLoading(true);
    setError("");
    getFlowAudit({ token, flowId: id })
      .then((data) => {
        setFlow(data?.flow || null);
        setEvents(Array.isArray(data?.events) ? data.events : []);
      })
      .catch((e) => setError(e?.message || "Failed to load activity"))
      .finally(() => setLoading(false));
  }, [open, token, flowId]);

  const sorted = useMemo(() => {
    const list = Array.isArray(events) ? events : [];
    return [...list].sort((a, b) => String(b?.ts || "").localeCompare(String(a?.ts || "")));
  }, [events]);

  const csvRows = useMemo(() => {
    const header = ["timestamp", "type", "method", "actor", "details"];
    const rows = sorted.map((e) => {
      const actor = String(e?.actorName || e?.actorUserId || "");
      const details = e?.type === "completed" ? `result=${String(e?.resultFileTitle || e?.resultFileId || "")}` : "";
      return [toCsvValue(e?.ts), toCsvValue(e?.type), toCsvValue(e?.method || ""), toCsvValue(actor), toCsvValue(details)];
    });
    return [header, ...rows];
  }, [sorted]);

  const canDownload = csvRows.length > 1 && !loading;
  const fileLabel = String(flow?.fileTitle || flow?.templateTitle || "request").trim() || "request";

  return (
    <Modal
      open={open}
      title={title}
      onClose={() => {
        if (loading) return;
        onClose?.();
      }}
      footer={
        <>
          <button type="button" onClick={() => onClose?.()} disabled={loading}>
            Close
          </button>
          <button
            type="button"
            onClick={() => downloadCsv(`activity-${fileLabel}.csv`, csvRows)}
            disabled={!canDownload}
            title={!canDownload ? "No activity yet" : ""}
          >
            Download CSV
          </button>
        </>
      }
    >
      {error ? <p className="error">{error}</p> : null}
      {loading ? (
        <EmptyState title="Loading activity..." description="Just a moment." />
      ) : sorted.length === 0 ? (
        <EmptyState title="No activity yet" description="Actions like create, cancel, and complete will appear here." />
      ) : (
        <div className="audit-list">
          {sorted.map((e, idx) => {
            const ts = e?.ts ? new Date(String(e.ts)).toLocaleString() : "";
            const type = String(e?.type || "event");
            const actor = String(e?.actorName || "");
            const method = String(e?.method || "");
            const detail =
              type === "completed" && (e?.resultFileTitle || e?.resultFileId) ? `Result: ${String(e.resultFileTitle || e.resultFileId)}` : "";
            return (
              <div key={`${type}-${idx}-${e?.ts || ""}`} className="audit-row">
                <div className="audit-main">
                  <strong className="audit-title">
                    {type === "created"
                      ? "Request created"
                      : type === "canceled"
                        ? "Request canceled"
                        : type === "completed"
                          ? method === "auto"
                            ? "Request completed (auto)"
                            : "Request completed"
                          : type}
                  </strong>
                  <span className="muted">
                    {ts}
                    {actor ? ` \u00B7 ${actor}` : ""}
                  </span>
                  {detail ? (
                    <span className="muted" style={{ marginTop: 4, display: "block" }}>
                      {detail}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
