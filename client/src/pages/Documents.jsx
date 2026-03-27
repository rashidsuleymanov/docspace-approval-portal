import { useEffect, useMemo, useState } from "react";
import DocSpaceModal from "../components/DocSpaceModal.jsx";
import AuditModal from "../components/AuditModal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import RequestDetailsModal from "../components/RequestDetailsModal.jsx";
import StatusPill from "../components/StatusPill.jsx";
import StepsCard from "../components/StepsCard.jsx";
import Tabs from "../components/Tabs.jsx";
import { getProjectsPermissions, listFlows, listProjectFlows, trashFlow, untrashFlow } from "../services/portalApi.js";
import { toast } from "../utils/toast.js";

function normalize(value) {
  return String(value || "").trim();
}

function flowTitle(flow) {
  return (
    String(flow?.resultFileTitle || "").trim() ||
    String(flow?.fileTitle || "").trim() ||
    String(flow?.templateTitle || "").trim() ||
    "Document"
  );
}

function statusTone(status) {
  const s = String(status || "");
  if (s === "Completed") return "green";
  if (s === "Canceled") return "red";
  if (s === "InProgress") return "yellow";
  return "gray";
}

export default function Documents({ session, busy, projects = [], onOpenRequests, onOpenProjects, onOpenTemplates }) {
  const token = normalize(session?.token);
  const meId = normalize(session?.user?.id);
  const meEmail = normalize(session?.user?.email).toLowerCase();
  const displayName = session?.user?.displayName || session?.user?.email || "User";

  const [tab, setTab] = useState("my"); // my | team | trash
  const [who, setWho] = useState("all"); // all | assigned | created
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [flows, setFlows] = useState([]);
  const [permsLoaded, setPermsLoaded] = useState(false);
  const [projectPerms, setProjectPerms] = useState({});
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [teamFlows, setTeamFlows] = useState([]);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsGroup, setDetailsGroup] = useState(null);
  const [docOpen, setDocOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("Document");
  const [docUrl, setDocUrl] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditFlowId, setAuditFlowId] = useState("");
  const [auditTitle, setAuditTitle] = useState("Activity");

  // Personal workspace was removed from Documents; use Projects to create and manage projects.

  const roomTitleById = useMemo(() => {
    const list = Array.isArray(projects) ? projects : [];
    const map = new Map();
    for (const p of list) {
      const rid = normalize(p?.roomId);
      if (!rid) continue;
      map.set(rid, String(p?.title || "").trim() || "Project");
    }
    return map;
  }, [projects]);

  const projectIdByRoomId = useMemo(() => {
    const list = Array.isArray(projects) ? projects : [];
    const map = new Map();
    for (const p of list) {
      const rid = normalize(p?.roomId);
      const pid = normalize(p?.id);
      if (!rid || !pid) continue;
      map.set(rid, pid);
    }
    return map;
  }, [projects]);

  const canManageFlow = (flow) => {
    const perms = projectPerms && typeof projectPerms === "object" ? projectPerms : {};
    const rid = normalize(flow?.projectRoomId);
    const pid = rid ? projectIdByRoomId.get(rid) : "";
    if (!pid) return false;
    return Boolean(perms?.[String(pid)]);
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError("");
    listFlows({ token, includeArchived: true, includeTrashed: true })
      .then((data) => setFlows(Array.isArray(data?.flows) ? data.flows : []))
      .catch((e) => {
        setFlows([]);
        setError(e?.message || "Failed to load documents");
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token || permsLoaded) return;
    getProjectsPermissions({ token })
      .catch(() => null)
      .then((permsRes) => {
        setProjectPerms(permsRes?.permissions && typeof permsRes.permissions === "object" ? permsRes.permissions : {});
      })
      .finally(() => setPermsLoaded(true));
  }, [permsLoaded, token]);

  const manageableProjects = useMemo(() => {
    const list = Array.isArray(projects) ? projects : [];
    const perms = projectPerms && typeof projectPerms === "object" ? projectPerms : {};
    return list.filter((p) => Boolean(perms?.[String(p?.id || "")]));
  }, [projectPerms, projects]);

  const refreshTeam = useMemo(
    () => async () => {
      if (!token) return;
      const list = manageableProjects;
      if (!list.length) {
        setTeamFlows([]);
        return;
      }
      setTeamLoading(true);
      setTeamError("");
      try {
        const results = await Promise.all(
          list.map((p) =>
            listProjectFlows({
              token,
              projectId: String(p.id),
              includeArchived: true,
              includeTrashed: true
            }).catch(() => ({ flows: [] }))
          )
        );
        const merged = [];
        for (const r of results) {
          if (Array.isArray(r?.flows)) merged.push(...r.flows);
        }
        setTeamFlows(merged);
      } catch (e) {
        setTeamFlows([]);
        setTeamError(e?.message || "Failed to load team documents");
      } finally {
        setTeamLoading(false);
      }
    },
    [manageableProjects, token]
  );

  useEffect(() => {
    if (tab !== "team") return;
    refreshTeam().catch(() => null);
  }, [refreshTeam, tab]);

  const docs = useMemo(() => {
    const items = Array.isArray(flows) ? flows : [];
    const completed = items.filter((f) => String(f?.status || "") === "Completed" && normalize(f?.resultFileUrl || f?.openUrl));

    const byKey = new Map();
    for (const flow of completed) {
      const key = normalize(flow?.resultFileId) || normalize(flow?.fileId) || normalize(flow?.id);
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, flow);
        continue;
      }
      const a = String(existing?.completedAt || existing?.updatedAt || existing?.createdAt || "");
      const b = String(flow?.completedAt || flow?.updatedAt || flow?.createdAt || "");
      if (String(b).localeCompare(String(a)) > 0) byKey.set(key, flow);
    }

    const list = Array.from(byKey.values());
    list.sort((a, b) => String(b?.completedAt || b?.updatedAt || b?.createdAt || "").localeCompare(String(a?.completedAt || a?.updatedAt || a?.createdAt || "")));
    return list;
  }, [flows]);

  const teamDocs = useMemo(() => {
    const items = Array.isArray(teamFlows) ? teamFlows : [];
    const completed = items.filter((f) => String(f?.status || "") === "Completed" && normalize(f?.resultFileUrl || f?.openUrl));

    const byKey = new Map();
    for (const flow of completed) {
      const key = normalize(flow?.resultFileId) || normalize(flow?.fileId) || normalize(flow?.id);
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, flow);
        continue;
      }
      const a = String(existing?.completedAt || existing?.updatedAt || existing?.createdAt || "");
      const b = String(flow?.completedAt || flow?.updatedAt || flow?.createdAt || "");
      if (String(b).localeCompare(String(a)) > 0) byKey.set(key, flow);
    }

    const list = Array.from(byKey.values());
    list.sort((a, b) => String(b?.completedAt || b?.updatedAt || b?.createdAt || "").localeCompare(String(a?.completedAt || a?.updatedAt || a?.createdAt || "")));
    return list;
  }, [teamFlows]);

  const filtered = useMemo(() => {
    const q = normalize(query).toLowerCase();
    const baseDocs = tab === "team" ? teamDocs : docs;
    const notTrashed = baseDocs.filter((f) => !normalize(f?.trashedAt));
    const trashed = baseDocs.filter((f) => Boolean(normalize(f?.trashedAt)));
    const base =
      tab === "trash"
        ? trashed
        : tab === "team"
          ? notTrashed
        : notTrashed;

    const scoped =
      who === "created"
        ? base.filter((f) => normalize(f?.createdByUserId) === meId)
        : who === "assigned"
          ? base.filter((f) => {
              const recipients = Array.isArray(f?.recipientEmails) ? f.recipientEmails : [];
              return meEmail && recipients.map((e) => normalize(e).toLowerCase()).includes(meEmail);
            })
          : base;

    if (!q) return scoped;
    return scoped.filter((f) => {
      const rid = normalize(f?.projectRoomId);
      const project = rid ? roomTitleById.get(rid) || "" : "";
      const hay = `${flowTitle(f)} ${project}`.toLowerCase();
      return hay.includes(q);
    });
  }, [docs, meEmail, meId, query, roomTitleById, tab, teamDocs, who]);

  const groupsById = useMemo(() => {
    const items = Array.isArray(flows) ? flows : [];
    const map = new Map();
    for (const f of items) {
      if (!f?.id) continue;
      const gid = normalize(f?.groupId || f.id) || normalize(f.id);
      const entry = map.get(gid) || { id: gid, flows: [] };
      entry.flows.push(f);
      map.set(gid, entry);
    }
    for (const entry of map.values()) {
      entry.flows.sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
      entry.primaryFlow = entry.flows[0] || null;
      const total = entry.flows.length;
      const completed = entry.flows.filter((x) => String(x?.status || "") === "Completed").length;
      const canceled = entry.flows.filter((x) => String(x?.status || "") === "Canceled").length;
      entry.counts = { total, completed, canceled };
      entry.status = total > 0 && completed === total ? "Completed" : total > 0 && canceled === total ? "Canceled" : "InProgress";
      entry.projectRoomId = entry.primaryFlow?.projectRoomId || null;
      entry.createdAt = entry.primaryFlow?.createdAt || null;
    }
    return map;
  }, [flows]);

  const openDoc = (flow) => {
    const url = normalize(flow?.resultFileUrl || flow?.openUrl);
    if (!url) return;
    setDocTitle(flowTitle(flow));
    setDocUrl(url);
    setDocOpen(true);
  };

  const copy = async (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast("Link copied", "success");
    } catch {
      // ignore
    }
  };

  const openDetailsFromFlow = (flow) => {
    const gid = normalize(flow?.groupId || flow?.id);
    const group = gid ? groupsById.get(gid) : null;
    if (!group) return;
    setDetailsGroup(group);
    setDetailsOpen(true);
  };

  const tabItems = useMemo(
    () => [
      { id: "my", label: "Results" },
      { id: "team", label: "Team" },
      { id: "trash", label: "Trash" }
    ],
    []
  );

  const whoItems = useMemo(
    () => [
      { id: "all", label: "All" },
      { id: "assigned", label: "Assigned to me" },
      { id: "created", label: "Created by me" }
    ],
    []
  );

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <h2>Results</h2>
          <p className="muted">Finished requests generate result files that appear here.</p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => onOpenProjects?.()} disabled={busy || loading}>
            Projects
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onOpenRequests?.();
              setTimeout(() => window.dispatchEvent(new CustomEvent("portal:requestsNew")), 0);
            }}
            disabled={busy || loading}
            data-tour="results:new"
          >
            New request
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {tab === "team" && teamError ? <p className="error">{teamError}</p> : null}

      {token && tab === "my" ? (
        <StepsCard
          title="How to create documents"
          subtitle="This page shows completed results, not drafts. Start a request to generate a result file."
          steps={[
            {
              title: "Prepare a template",
              description: "Create or upload a PDF template in Templates.",
              actionLabel: "Open Templates",
              onAction: () => onOpenTemplates?.(),
              disabled: busy || loading || typeof onOpenTemplates !== "function"
            },
            {
              title: "Start a request",
              description: "Go to Requests and click New request to send it to recipients.",
              actionLabel: "Open Requests",
              actionTone: "primary",
              onAction: () => {
                onOpenRequests?.();
                setTimeout(() => window.dispatchEvent(new CustomEvent("portal:requestsNew")), 0);
              },
              disabled: busy || loading
            },
            {
              title: "Open the result",
              description: "After completion, the result file will appear in Results."
            }
          ]}
        />
      ) : null}

      <section className="card page-card">
        <div className="card-header compact">
          <div>
            <h3>
              {tab === "trash"
                ? "Trash"
                : tab === "team"
                  ? "Team documents"
                  : "My results"}
            </h3>
            <p className="muted">
              {tab === "trash"
                ? "Restore documents you moved to trash."
                : tab === "team"
                  ? "Completed files across projects you manage."
                : "Documents where you participated (created or were assigned)."}
            </p>
          </div>
          <div className="card-header-actions">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              disabled={busy || loading}
              style={{ maxWidth: 260 }}
            />
            {loading || teamLoading ? <span className="muted" style={{ fontSize: 12 }}>Loading...</span> : null}
            <span className="muted">{filtered.length} shown</span>
          </div>
        </div>

        <div className="request-filters">
          <Tabs value={tab} onChange={setTab} items={tabItems} ariaLabel="Documents scope" />
          <Tabs value={who} onChange={setWho} items={whoItems} ariaLabel="Documents filter" />
        </div>

        <div className="list scroll-area">
          {tab === "team" && manageableProjects.length === 0 ? (
            <EmptyState
              title="No team projects yet"
              description="Team documents appear for projects where you are an admin."
              actions={
                <button type="button" onClick={() => onOpenProjects?.()} disabled={busy}>
                  Open Projects
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={query.trim() ? "Nothing found" : tab === "trash" ? "Trash is empty" : "No documents yet"}
              description={
                query.trim()
                  ? `No documents match "${query.trim()}".`
                  : tab === "trash"
                  ? "Move completed documents to trash to hide them from your list."
                  : "Completed requests will appear here. Start a request to generate a signed or filled file."
              }
              actions={
                query.trim() ? (
                  <button type="button" onClick={() => setQuery("")} disabled={busy}>
                    Clear search
                  </button>
                ) : tab === "trash" ? (
                  <button type="button" onClick={() => setTab("my")} disabled={busy}>
                    Back to documents
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      onOpenRequests?.();
                      setTimeout(() => window.dispatchEvent(new CustomEvent("portal:requestsNew")), 0);
                    }}
                    disabled={busy}
                  >
                    New request
                  </button>
                )
              }
            />
          ) : (
            filtered.map((flow) => {
              const title = flowTitle(flow);
              const rid = normalize(flow?.projectRoomId);
              const projectTitle = rid ? roomTitleById.get(rid) || "Project" : "Project";
              const completedAt = String(flow?.completedAt || flow?.updatedAt || flow?.createdAt || "");
              const archivedAt = normalize(flow?.archivedAt);
              const trashedAt = normalize(flow?.trashedAt);
              const canManage = canManageFlow(flow);
              return (
                <div key={normalize(flow?.resultFileId) || normalize(flow?.id)} className="list-row request-row">
                  <div className="list-main">
                    <strong className="truncate">{title}</strong>
                    <span className="muted request-row-meta">
                      <StatusPill tone={statusTone("Completed")}>Completed</StatusPill>{" "}
                      {archivedAt ? <StatusPill tone="gray">{`Archived: ${archivedAt.slice(0, 10)}`}</StatusPill> : null}{" "}
                      {trashedAt ? <StatusPill tone="gray">{`Trashed: ${trashedAt.slice(0, 10)}`}</StatusPill> : null}{" "}
                      <StatusPill tone="gray">{projectTitle}</StatusPill>{" "}
                      <span className="muted">Updated {completedAt ? completedAt.slice(0, 19).replace("T", " ") : "-"}</span>
                    </span>
                  </div>
                  <div className="list-actions">
                    <button type="button" className="primary" onClick={() => openDoc(flow)} disabled={busy || !normalize(flow?.resultFileUrl || flow?.openUrl)}>
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => copy(normalize(flow?.resultFileUrl || flow?.openUrl))}
                      disabled={busy || !normalize(flow?.resultFileUrl || flow?.openUrl)}
                    >
                      Copy link
                    </button>
                    <button type="button" onClick={() => openDetailsFromFlow(flow)} disabled={busy}>
                      Details
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const id = normalize(flow?.id);
                        if (!id) return;
                        setAuditFlowId(id);
                        setAuditTitle(`Activity: ${flowTitle(flow)}`);
                        setAuditOpen(true);
                      }}
                      disabled={busy || loading || !normalize(flow?.id)}
                    >
                      Activity
                    </button>
                    {canManage ? (
                      tab === "trash" ? (
                        <button
                          type="button"
                          onClick={async () => {
                            const id = normalize(flow?.id);
                            if (!id || !token) return;
                            setLoading(true);
                            setError("");
                            try {
                              await untrashFlow({ token, flowId: id });
                              toast("Restored", "success");
                              if (tab === "team") {
                                await refreshTeam().catch(() => null);
                              } else {
                                const data = await listFlows({ token, includeArchived: true, includeTrashed: true }).catch(() => null);
                                setFlows(Array.isArray(data?.flows) ? data.flows : []);
                              }
                            } catch (e) {
                              const msg = e?.message || "Restore failed";
                              setError(msg);
                              toast(msg, "error");
                            } finally {
                              setLoading(false);
                            }
                          }}
                          disabled={busy || loading}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            const id = normalize(flow?.id);
                            if (!id || !token) return;
                            setLoading(true);
                            setError("");
                            try {
                              await trashFlow({ token, flowId: id });
                              toast("Moved to Trash", "success");
                              if (tab === "team") {
                                await refreshTeam().catch(() => null);
                              } else {
                                const data = await listFlows({ token, includeArchived: true, includeTrashed: true }).catch(() => null);
                                setFlows(Array.isArray(data?.flows) ? data.flows : []);
                              }
                            } catch (e) {
                              const msg = e?.message || "Trash failed";
                              setError(msg);
                              toast(msg, "error");
                            } finally {
                              setLoading(false);
                            }
                          }}
                          disabled={busy || loading}
                          title="Admins can hide results by moving them to Trash."
                        >
                          Move to Trash
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <RequestDetailsModal
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setDetailsGroup(null);
        }}
        busy={busy || loading}
        group={detailsGroup}
        roomTitleById={roomTitleById}
        onOpen={(flow) => openDoc(flow)}
        onCopyLink={null}
        onNotify={null}
        onRemind={null}
        onActivity={null}
        onCancel={null}
        onComplete={null}
        canCancel={false}
        canComplete={false}
      />

      <DocSpaceModal open={docOpen} title={docTitle} url={docUrl} onClose={() => setDocOpen(false)} />

      <AuditModal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        token={token}
        flowId={auditFlowId}
        title={auditTitle}
      />
    </div>
  );
}
