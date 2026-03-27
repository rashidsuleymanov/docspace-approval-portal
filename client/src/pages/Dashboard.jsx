import { useMemo, useState } from "react";
import DocSpaceModal from "../components/DocSpaceModal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import Modal from "../components/Modal.jsx";
import QuickActions from "../components/QuickActions.jsx";
import RequestDetailsModal from "../components/RequestDetailsModal.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusPill from "../components/StatusPill.jsx";
import StepsCard from "../components/StepsCard.jsx";
import { toast } from "../utils/toast.js";

function isPdfTemplate(t) {
  const ext = String(t?.fileExst || "").trim().toLowerCase();
  const title = String(t?.title || "").trim().toLowerCase();
  return ext === "pdf" || ext === ".pdf" || title.endsWith(".pdf");
}

function withFillAction(url) {
  const raw = String(url || "");
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.searchParams.set("action", "fill");
    return parsed.toString();
  } catch {
    return raw.includes("?") ? `${raw}&action=fill` : `${raw}?action=fill`;
  }
}

export default function Dashboard({
  session,
  busy,
  error,
  flows,
  flowsRefreshing = false,
  flowsUpdatedAt = null,
  activeRoomId,
  activeProject,
  projectsCount = 0,
  projects = [],
  templates,
  draftsPdfCount = 0,
  onRefresh,
  onStartFlow,
  onOpenDrafts,
  onOpenProjects,
  onOpenRequests,
  onOpenProject
}) {
  const userLabel = session?.user?.displayName || session?.user?.email || "User";
  const meEmail = session?.user?.email ? String(session.user.email).trim().toLowerCase() : "";

  const hasCurrentProject = Boolean(String(activeRoomId || "").trim());
  const currentProjectTitle = activeProject?.title || "";
  const currentProjectUrl = activeProject?.roomUrl ? String(activeProject.roomUrl) : "";
  const currentProjectId = activeProject?.id ? String(activeProject.id) : "";
  const updatedLabel = flowsUpdatedAt instanceof Date ? flowsUpdatedAt.toLocaleTimeString() : "";

  const allFlows = useMemo(() => (Array.isArray(flows) ? flows : []), [flows]);

  const assignedFlows = useMemo(() => {
    if (!meEmail) return [];
    return allFlows.filter((f) => {
      const recipients = Array.isArray(f?.recipientEmails) ? f.recipientEmails : [];
      return recipients.map((e) => String(e || "").trim().toLowerCase()).includes(meEmail);
    });
  }, [allFlows, meEmail]);

  const stats = useMemo(() => {
    const inProgress = assignedFlows.filter((f) => f.status === "InProgress").length;
    const completed = assignedFlows.filter((f) => f.status === "Completed").length;
    const other = assignedFlows.length - inProgress - completed;
    return { total: assignedFlows.length, inProgress, completed, other };
  }, [assignedFlows]);

  const roomTitleById = useMemo(() => {
    const list = Array.isArray(projects) ? projects : [];
    const map = new Map();
    for (const p of list) {
      const rid = String(p?.roomId || "").trim();
      if (!rid) continue;
      map.set(rid, String(p?.title || "").trim() || "Project");
    }
    return map;
  }, [projects]);

  const recentRequests = useMemo(() => {
    const items = Array.isArray(assignedFlows) ? assignedFlows : [];
    const byId = new Map();
    for (const flow of items) {
      if (!flow?.id) continue;
      const gid = String(flow?.groupId || flow.id).trim() || String(flow.id);
      const existing = byId.get(gid) || { id: gid, flows: [] };
      existing.flows.push(flow);
      byId.set(gid, existing);
    }

    const groups = Array.from(byId.values()).map((g) => {
      const flows = (g.flows || []).slice().sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
      const first = flows[0] || null;
      return { id: g.id, flows, primaryFlow: first, createdAt: first?.createdAt || null };
    });

    groups.sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
    return groups.slice(0, 3);
  }, [assignedFlows]);

  const pdfTemplateCount = useMemo(() => {
    const list = Array.isArray(templates) ? templates : [];
    return list.filter(isPdfTemplate).length;
  }, [templates]);

  const [sendOpen, setSendOpen] = useState(false);
  const [sendQuery, setSendQuery] = useState("");
  const templateItems = Array.isArray(templates) ? templates : [];
  const filteredSendTemplates = useMemo(() => {
    const q = String(sendQuery || "").trim().toLowerCase();
    const pdfOnly = templateItems.filter(isPdfTemplate);
    if (!q) return pdfOnly;
    return pdfOnly.filter((t) => String(t.title || t.id || "").toLowerCase().includes(q));
  }, [sendQuery, templateItems]);

  const [docOpen, setDocOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("Document");
  const [docUrl, setDocUrl] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsGroup, setDetailsGroup] = useState(null);
  const [creatingTemplateId, setCreatingTemplateId] = useState("");

  const groupFromResult = (result) => {
    const flows = Array.isArray(result?.flows) ? result.flows : result?.flow ? [result.flow] : [];
    if (!flows.length) return null;
    const primaryFlow = flows[0] || null;
    const statuses = flows.map((f) => String(f?.status || "")).filter(Boolean);
    const status = statuses.every((s) => s === "Completed")
      ? "Completed"
      : statuses.every((s) => s === "Canceled")
        ? "Canceled"
        : statuses.some((s) => s === "InProgress")
          ? "InProgress"
          : String(primaryFlow?.status || "InProgress");
    const counts = {
      total: flows.length,
      completed: flows.filter((f) => String(f?.status || "") === "Completed").length,
      canceled: flows.filter((f) => String(f?.status || "") === "Canceled").length
    };
    const id =
      String(primaryFlow?.groupId || result?.groupId || primaryFlow?.id || result?.id || "").trim() ||
      String(primaryFlow?.id || "").trim();
    return { id: id || String(Math.random()), flows, primaryFlow, createdAt: primaryFlow?.createdAt || null, status, counts };
  };

  const openFlow = (flow) => {
    const status = String(flow?.status || "");
    const url = String((status === "Completed" ? flow?.resultFileUrl || flow?.openUrl : flow?.openUrl) || "").trim();
    if (!url) return;
    const kind = String(flow?.kind || "approval").toLowerCase();
    setDocTitle(flow?.fileTitle || flow?.templateTitle || "Document");
    setDocUrl((kind === "fillsign" || kind === "sharedsign") && status !== "Completed" ? withFillAction(url) : url);
    setDocOpen(true);
  };

  const onCopyLink = async (url) => {
    const value = String(url || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast("Link copied", "success");
    } catch {
      // ignore; user can copy from input in Details modal
    }
  };

  const openRequests = (filter = "all") => {
    if (typeof onOpenRequests !== "function") return;
    onOpenRequests(filter, "all");
  };

  const onNewRequest = () => {
    if (!hasCurrentProject) {
      onOpenProjects();
      return;
    }
    setSendOpen(true);
  };

  const quickStartSteps = useMemo(() => {
    const steps = [];
    if (!projectsCount) {
      steps.push({
        title: "Create your first project",
        description: "Projects keep your templates and requests organized.",
        actionLabel: "Create project",
        actionTone: "primary",
        onAction: () => onOpenProjects?.({ create: true })
      });
      steps.push({
        title: "Create a template",
        description: "Templates are PDF forms used to generate requests.",
        actionLabel: "Open Templates",
        onAction: onOpenDrafts
      });
      return steps;
    }

    if (!hasCurrentProject) {
      steps.push({
        title: "Choose a project",
        description: "Select a project to publish templates and create requests.",
        actionLabel: "Open Projects",
        actionTone: "primary",
        onAction: onOpenProjects
      });
    }

    if (!draftsPdfCount) {
      steps.push({
         title: "Create a template",
         description: "Make a PDF template in your files.",
         actionLabel: "New template",
         onAction: onOpenDrafts
       });
    }

    if (hasCurrentProject && pdfTemplateCount === 0) {
      steps.push({
        title: "Publish a template to this project",
        description: "Publishing copies the PDF into the project so it can be used for requests.",
        actionLabel: "Open Templates",
        onAction: onOpenDrafts
      });
    }

    steps.push({
      title: "Create your first request",
      description: "Pick a published template, then share the link and track progress.",
      actionLabel: hasCurrentProject ? "New request" : "Choose project",
      actionTone: "primary",
      onAction: onNewRequest
    });

    return steps.slice(0, 4);
  }, [draftsPdfCount, hasCurrentProject, onNewRequest, onOpenDrafts, onOpenProjects, pdfTemplateCount, projectsCount]);

  const showQuickStart = quickStartSteps.length > 0 && (flows?.length === 0 || !hasCurrentProject || pdfTemplateCount === 0 || !draftsPdfCount);

  return (
    <div className="page-shell">
      <header className="topbar" data-tour="home:header">
        <div>
          <h2>Home</h2>
          <p className="muted">
            Signed in as {userLabel}
          </p>
        </div>
        <div className="topbar-actions">
          {flowsRefreshing ? (
            <span className="muted" style={{ fontSize: 12 }}>
              Updating...
            </span>
          ) : updatedLabel ? (
            <span className="muted" style={{ fontSize: 12 }}>
              Updated {updatedLabel}
            </span>
          ) : null}
          <button type="button" onClick={onRefresh} disabled={busy}>
            Refresh
          </button>
           {hasCurrentProject && currentProjectUrl ? (
             <a className="btn" href={currentProjectUrl} target="_blank" rel="noreferrer">
               Open room
             </a>
           ) : null}
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <div className="dashboard-grid">
        <div className="dashboard-main">
          {showQuickStart ? (
            <div data-tour="home:quickstart">
              <StepsCard
                title="Quick start"
                subtitle="Follow these steps to create your first approval flow."
                steps={quickStartSteps}
              />
            </div>
          ) : null}
          <section className="stats-grid">
            <StatCard title="Projects" value={projectsCount} meta="Project rooms you can access" onClick={onOpenProjects} />
            <StatCard title="Templates" value={draftsPdfCount} meta="PDF templates in My documents" onClick={onOpenDrafts} />
            <StatCard title="In progress" value={stats.inProgress} meta="Requests assigned to you" onClick={() => openRequests("inProgress")} />
            <StatCard title="Completed" value={stats.completed} meta="Requests assigned to you" onClick={() => openRequests("completed")} />
            <StatCard className="stat-total" title="Total" value={stats.total} meta="Requests assigned to you" onClick={() => openRequests("all")} />
          </section>

          <section className="card page-card">
            <div className="card-header compact">
              <div>
                <h3>Recent requests</h3>
                <p className="muted">Requests assigned to you.</p>
              </div>
              <div className="card-header-actions">
                <button type="button" onClick={() => openRequests("all")} disabled={busy}>
                  View all
                </button>
              </div>
            </div>

            <div className="list scroll-area recent-list">
              {!recentRequests.length ? (
                <EmptyState title="No assigned requests yet" description="When someone assigns you a request, it will show up here." />
              ) : (
                recentRequests.map((group) => {
                  const flow = group?.primaryFlow || group?.flows?.[0] || null;
                  if (!flow?.id) return null;
                  const roomId = String(flow?.projectRoomId || "").trim();
                  const roomTitle = roomId ? roomTitleById.get(roomId) || "Project" : "Unassigned";
                  const dueDate =
                    String(flow?.dueDate || "").trim() ||
                    String((Array.isArray(group?.flows) ? group.flows.find((f) => String(f?.dueDate || "").trim())?.dueDate : "") || "").trim();
                  const todayIso = new Date().toISOString().slice(0, 10);
                  const isOverdue =
                    String(flow?.status || "") === "InProgress" && dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate < todayIso;
                  return (
                    <div key={group.id} className="list-row">
                      <div className="list-main">
                        <strong>{flow.fileTitle || flow.templateTitle || `Template ${flow.templateFileId}`}</strong>
                        <span className="muted">
                          {flow.status === "Canceled" ? (
                            <StatusPill tone="red">Canceled</StatusPill>
                          ) : flow.status === "InProgress" ? (
                            <StatusPill tone="yellow">In progress</StatusPill>
                          ) : flow.status === "Completed" ? (
                            <StatusPill tone="green">Completed</StatusPill>
                          ) : (
                            <StatusPill tone="gray">{flow.status || "-"}</StatusPill>
                          )}{" "}
                          <StatusPill tone="gray">{roomTitle}</StatusPill>{" "}
                          {dueDate ? <StatusPill tone={isOverdue ? "red" : "gray"}>{isOverdue ? `Overdue: ${dueDate}` : `Due: ${dueDate}`}</StatusPill> : null}{" "}
                          {(flow.createdAt || "").slice(0, 19).replace("T", " ")}
                        </span>
                      </div>
                      <div className="list-actions">
                        <button
                          type="button"
                          onClick={() => openFlow(flow)}
                          disabled={
                            !(String(flow?.status || "") === "Completed" ? flow?.resultFileUrl || flow?.openUrl : flow?.openUrl) ||
                            busy ||
                            String(flow?.status || "") === "Canceled"
                          }
                          title={String(flow?.status || "") === "Canceled" ? "Canceled requests cannot be opened" : ""}
                        >
                          {String(flow?.status || "") === "Completed" ? "Open result" : "Open"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDetailsGroup(group);
                            setDetailsOpen(true);
                          }}
                          disabled={busy}
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        <div className="dashboard-side">
          <div className="quick-actions">
            <QuickActions
              hasProject={hasCurrentProject}
              projectTitle={currentProjectTitle}
              onOpenProjects={onOpenProjects}
              onOpenTemplates={onOpenDrafts}
              onNewRequest={onNewRequest}
              onOpenCurrentProject={
                typeof onOpenProject === "function" && currentProjectId ? () => onOpenProject(currentProjectId) : null
              }
            />
          </div>
          <section className="card compact">
            <div className="card-header compact">
              <div>
                <h3>Current project</h3>
                <p className="muted">Used for publishing templates and creating requests.</p>
              </div>
              <div className="card-header-actions">
                <button type="button" onClick={onOpenProjects} disabled={busy}>
                  Change
                </button>
              </div>
            </div>
            {hasCurrentProject ? (
              <div className="list" style={{ marginTop: 10 }}>
                <div className="list-row">
                  <div className="list-main">
                    <strong className="truncate">{currentProjectTitle || "Untitled"}</strong>
                    <span className="muted truncate">
                      <StatusPill tone="green">Current</StatusPill>{" "}
                      {pdfTemplateCount ? (
                        <StatusPill tone="gray">{pdfTemplateCount} published template(s)</StatusPill>
                      ) : (
                        <StatusPill tone="gray">No published templates</StatusPill>
                      )}
                    </span>
                  </div>
                  <div className="list-actions">
                    {typeof onOpenProject === "function" && currentProjectId ? (
                      <button type="button" className="primary" onClick={() => onOpenProject(currentProjectId)} disabled={busy}>
                        Open
                      </button>
                    ) : null}
                     {currentProjectUrl ? (
                        <a className="btn" href={currentProjectUrl} target="_blank" rel="noreferrer">
                          Open room
                        </a>
                      ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No project selected"
                description="Pick a project to publish templates and create requests."
                actions={
                  <button type="button" className="primary" onClick={onOpenProjects} disabled={busy}>
                    Open Projects
                  </button>
                }
              />
            )}
          </section>
        </div>
      </div>

      <Modal
        open={sendOpen}
        title={currentProjectTitle ? `New request \u2014 ${currentProjectTitle}` : "New request"}
        onClose={() => setSendOpen(false)}
        footer={
          <>
            <button type="button" onClick={() => setSendOpen(false)} disabled={busy}>
              Close
            </button>
            <button type="button" className="link" onClick={onOpenDrafts} disabled={busy}>
              Templates
            </button>
          </>
        }
      >
        {!templateItems.length ? (
          <EmptyState title="No templates in the current project" description="Open Templates and publish a PDF form to the current project." />
        ) : (
          <div className="auth-form" style={{ marginTop: 0 }}>
            <label>
              <span>Template</span>
              <input value={sendQuery} onChange={(e) => setSendQuery(e.target.value)} placeholder="Search templates..." disabled={busy} />
            </label>
            <div className="list" style={{ marginTop: 0 }}>
              {filteredSendTemplates.slice(0, 10).map((t) => (
                <div key={t.id} className="list-row">
                  <div className="list-main">
                    <strong className="truncate">{t.title || `File ${t.id}`}</strong>
                  </div>
                  <div className="list-actions">
                      <button
                        type="button"
                      className="primary"
                      onClick={async () => {
                        setCreatingTemplateId(String(t.id || ""));
                        try {
                          const result = await onStartFlow?.(t.id, currentProjectId || null);
                          const group = groupFromResult(result);
                          if (group) {
                            setDetailsGroup(group);
                            setDetailsOpen(true);
                          }
                          setSendOpen(false);
                          setSendQuery("");
                        } finally {
                          setCreatingTemplateId("");
                        }
                      }}
                      disabled={busy || String(creatingTemplateId) === String(t.id)}
                    >
                      {String(creatingTemplateId) === String(t.id) ? "Creating..." : "Create request"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <DocSpaceModal open={docOpen} title={docTitle} url={docUrl} onClose={() => setDocOpen(false)} />
      <RequestDetailsModal
        open={detailsOpen}
        onClose={() => {
          setDetailsOpen(false);
          setDetailsGroup(null);
        }}
        busy={busy}
        group={detailsGroup}
        roomTitleById={roomTitleById}
        onOpen={(flow) => {
          setDetailsOpen(false);
          openFlow(flow);
        }}
        onCopyLink={(url) => onCopyLink(url)}
      />
    </div>
  );
}
