import { useMemo, useState } from "react";
import EmptyState from "../components/EmptyState.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Tabs from "../components/Tabs.jsx";
import { deleteLocalDraft, listLocalDrafts } from "../services/draftsStore.js";

function normalize(value) {
  return String(value || "").trim();
}

function typeLabel(type) {
  const t = String(type || "").trim();
  if (t === "bulkLinks") return "Bulk links";
  if (t === "bulkSend") return "Bulk send";
  return "Request";
}

function typeTone(type) {
  const t = String(type || "").trim();
  if (t === "bulkLinks") return "gray";
  if (t === "bulkSend") return "blue";
  return "yellow";
}

export default function SendDrafts({ session, busy, onOpenRequests, onOpenBulkSend, onOpenBulkLinks }) {
  const [tab, setTab] = useState("all"); // all | request | bulkSend | bulkLinks
  const [query, setQuery] = useState("");
  const [tick, setTick] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteDraft, setDeleteDraft] = useState(null);

  const { drafts, totalInTab } = useMemo(() => {
    const list = listLocalDrafts(session);
    const filteredByTab =
      tab === "request" ? list.filter((d) => d.type === "request") : tab === "bulkSend" ? list.filter((d) => d.type === "bulkSend") : tab === "bulkLinks" ? list.filter((d) => d.type === "bulkLinks") : list;

    const q = normalize(query).toLowerCase();
    const filtered = q
      ? filteredByTab.filter((d) => {
          const hay = `${normalize(d.title)} ${normalize(d.payload?.templateTitle)} ${normalize(d.payload?.kind)}`.toLowerCase();
          return hay.includes(q);
        })
      : filteredByTab;

    return { drafts: filtered, totalInTab: filteredByTab.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, session, tab, tick]);

  const tabItems = useMemo(
    () => [
      { id: "all", label: "All" },
      { id: "request", label: "Requests" },
      { id: "bulkSend", label: "Bulk send" },
      { id: "bulkLinks", label: "Bulk links" }
    ],
    []
  );

  const openDraft = (draft) => {
    const type = String(draft?.type || "request");
    const payload = draft?.payload && typeof draft.payload === "object" ? draft.payload : {};
    if (type === "bulkSend") {
      onOpenBulkSend?.();
      setTimeout(() => window.dispatchEvent(new CustomEvent("portal:bulkSendLoadDraft", { detail: { payload } })), 0);
      return;
    }
    if (type === "bulkLinks") {
      onOpenBulkLinks?.();
      setTimeout(() => window.dispatchEvent(new CustomEvent("portal:bulkLinksLoadDraft", { detail: { payload } })), 0);
      return;
    }
    onOpenRequests?.();
    setTimeout(() => window.dispatchEvent(new CustomEvent("portal:requestsLoadDraft", { detail: { payload } })), 0);
  };

  const removeDraft = (draft) => {
    setDeleteDraft(draft || null);
    setDeleteOpen(true);
  };

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <h2>Drafts</h2>
          <p className="muted">Saved locally in this browser. Create drafts with “Save draft” in Requests / Bulk tools.</p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => setTick((n) => n + 1)} disabled={busy}>
            Refresh
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onOpenRequests?.();
              setTimeout(() => window.dispatchEvent(new CustomEvent("portal:requestsNewRequest")), 0);
            }}
            disabled={busy}
          >
            Start new request
          </button>
        </div>
      </header>

      <section className="card page-card">
        <div className="card-header compact">
          <div>
            <h3>Saved drafts</h3>
            <p className="muted">Stored locally in your browser.</p>
          </div>
          <div className="card-header-actions">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." disabled={busy} style={{ maxWidth: 260 }} />
            <span className="muted">{drafts.length} shown</span>
          </div>
        </div>

        <div className="request-filters">
          <Tabs value={tab} onChange={setTab} items={tabItems} ariaLabel="Draft type" />
        </div>

        {!drafts.length ? (
          <EmptyState
            title={normalize(query) ? "Nothing found" : "No drafts yet"}
            description={
              normalize(query)
                ? `No drafts match "${normalize(query)}".`
                : "Drafts are created when you start an action (Request / Bulk send / Bulk links) and click Save draft."
            }
            actions={
              normalize(query) ? (
                <button type="button" onClick={() => setQuery("")} disabled={busy}>
                  Clear search
                </button>
              ) : totalInTab ? null : (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      onOpenRequests?.();
                      setTimeout(() => window.dispatchEvent(new CustomEvent("portal:requestsNewRequest")), 0);
                    }}
                    disabled={busy}
                  >
                    Start request
                  </button>
                  <button type="button" onClick={() => onOpenBulkSend?.()} disabled={busy}>
                    Open Bulk send
                  </button>
                  <button type="button" onClick={() => onOpenBulkLinks?.()} disabled={busy}>
                    Open Bulk links
                  </button>
                </div>
              )
            }
          />
        ) : (
          <div className="list scroll-area">
            {drafts.map((d) => {
              const type = String(d.type || "request");
              const templateTitle = normalize(d.payload?.templateTitle);
              const kind = normalize(d.payload?.kind);
              const updated = normalize(d.updatedAt || d.createdAt).slice(0, 19).replace("T", " ");
              const recipientsCount = Array.isArray(d.payload?.recipients) ? d.payload.recipients.length : Array.isArray(d.payload?.emails) ? d.payload.emails.length : 0;
              return (
                <div key={d.id} className="list-row request-row">
                  <div className="list-main">
                    <strong className="truncate">{d.title}</strong>
                    <span className="muted request-row-meta">
                      <StatusPill tone={typeTone(type)}>{typeLabel(type)}</StatusPill>{" "}
                      {templateTitle ? <StatusPill tone="gray">{templateTitle}</StatusPill> : null}{" "}
                      {kind ? <StatusPill tone="gray">{kind}</StatusPill> : null}{" "}
                      {recipientsCount ? <StatusPill tone="gray">{`${recipientsCount} recipient(s)`}</StatusPill> : null}{" "}
                      <span className="muted">Saved {updated || "-"}</span>
                    </span>
                  </div>
                  <div className="list-actions">
                    <button type="button" className="primary" onClick={() => openDraft(d)} disabled={busy}>
                      Continue
                    </button>
                    <button type="button" className="danger" onClick={() => removeDraft(d)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <ConfirmModal
        open={deleteOpen}
        title="Delete draft?"
        message={`Delete draft "${normalize(deleteDraft?.title) || "Draft"}"? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        busy={busy}
        onClose={() => {
          if (busy) return;
          setDeleteOpen(false);
          setDeleteDraft(null);
        }}
        onConfirm={() => {
          if (!deleteDraft?.id) return;
          deleteLocalDraft(session, deleteDraft.id);
          setTick((n) => n + 1);
          setDeleteOpen(false);
          setDeleteDraft(null);
        }}
      />
    </div>
  );
}
