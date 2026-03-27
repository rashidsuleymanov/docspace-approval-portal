import { useEffect, useMemo, useState } from "react";
import DocSpaceModal from "../components/DocSpaceModal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import Modal from "../components/Modal.jsx";
import StatusPill from "../components/StatusPill.jsx";
import StepsCard from "../components/StepsCard.jsx";
import Tabs from "../components/Tabs.jsx";
import {
  createDraft,
  deleteDraftTemplate,
  deleteSharedTemplate,
  getProjectTemplatesRoom,
  listSharedTemplates,
  createFlowFromTemplate,
  getProjectsPermissions,
  getProjectsSidebar,
  listDrafts,
  publishDraft,
} from "../services/portalApi.js";
import { toast } from "../utils/toast.js";

function normalize(value) {
  return String(value || "").trim();
}

function ensurePdfTitle(value) {
  const title = normalize(value);
  if (!title) return "Template.pdf";
  const lower = title.toLowerCase();
  if (lower.endsWith(".pdf")) return title;
  const dot = title.lastIndexOf(".");
  if (dot > 0) return `${title.slice(0, dot)}.pdf`;
  return `${title}.pdf`;
}

export default function Drafts({ session, busy, onOpenProject, onOpenProjects, onOpenSettings }) {
  const token = session?.token || "";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [tab, setTab] = useState("drafts");

  const [drafts, setDrafts] = useState([]);
  const [query, setQuery] = useState("");
  const [sharedQuery, setSharedQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("Template.pdf");

  const [publishOpen, setPublishOpen] = useState(false);
  const [publishFile, setPublishFile] = useState(null);
  const [publishDestination, setPublishDestination] = useState("project");
  const [projects, setProjects] = useState([]);
  const [projectPermissions, setProjectPermissions] = useState({});
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [templatesRoom, setTemplatesRoom] = useState(null);
  const [templatesRoomLoading, setTemplatesRoomLoading] = useState(false);
  const [sharedTemplates, setSharedTemplates] = useState([]);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState(null);
  const [deleteDraftOpen, setDeleteDraftOpen] = useState(false);
  const [deleteDraftEntry, setDeleteDraftEntry] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestTemplate, setRequestTemplate] = useState(null);
  const [requestProjects, setRequestProjects] = useState([]);
  const [requestActiveRoomId, setRequestActiveRoomId] = useState("");
  const [requestProjectId, setRequestProjectId] = useState("");
  const [requestDueDate, setRequestDueDate] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);

  const [docModal, setDocModal] = useState({ open: false, title: "", url: "" });

  const refresh = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await listDrafts({ token });
      setDrafts(Array.isArray(data?.drafts) ? data.drafts : []);
    } catch (e) {
      const msg = String(e?.message || "Failed to load templates");
      setError(msg);
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  };

  const loadProjects = async () => {
    if (!token) return;
    const [sidebar, perms] = await Promise.all([
      getProjectsSidebar({ token }).catch(() => null),
      getProjectsPermissions({ token }).catch(() => null)
    ]);
    setProjects(Array.isArray(sidebar?.projects) ? sidebar.projects : []);
    setProjectPermissions(perms?.permissions && typeof perms.permissions === "object" ? perms.permissions : {});
  };

  const refreshTemplatesRoom = async () => {
    if (!token) return null;
    setTemplatesRoomLoading(true);
    try {
      const data = await getProjectTemplatesRoom({ token });
      const room = data?.room ? { ...data.room, hasAccess: Boolean(data?.hasAccess), isOwner: Boolean(data?.isOwner) } : null;
      setTemplatesRoom(room);
      return room;
    } catch {
      setTemplatesRoom(null);
      return null;
    } finally {
      setTemplatesRoomLoading(false);
    }
  };

  const refreshSharedTemplates = async () => {
    if (!token) return;
    setSharedLoading(true);
    try {
      const data = await listSharedTemplates({ token });
      setSharedTemplates(Array.isArray(data?.templates) ? data.templates : []);
    } catch {
      setSharedTemplates([]);
    } finally {
      setSharedLoading(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => null);
    refreshTemplatesRoom().catch(() => null);
    refreshSharedTemplates().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const tabItems = useMemo(
    () => [
      { id: "drafts", label: "Drafts" },
      { id: "published", label: "Published" }
    ],
    []
  );

  const filtered = useMemo(() => {
    const q = normalize(query).toLowerCase();
    const items = Array.isArray(drafts) ? drafts : [];
    const pdfOnly = items.filter((d) => {
      const ext = String(d?.fileExst || "").trim().toLowerCase();
      const title = String(d?.title || "").trim().toLowerCase();
      return ext === "pdf" || ext === ".pdf" || title.endsWith(".pdf");
    });
    if (!q) return pdfOnly;
    return pdfOnly.filter((d) => String(d.title || d.id || "").toLowerCase().includes(q));
  }, [drafts, query]);

  const filteredShared = useMemo(() => {
    const q = normalize(sharedQuery).toLowerCase();
    const list = Array.isArray(sharedTemplates) ? sharedTemplates : [];
    if (!q) return list;
    return list.filter((t) => String(t?.title || t?.id || "").toLowerCase().includes(q));
  }, [sharedQuery, sharedTemplates]);

  const onCreate = async () => {
    const title = ensurePdfTitle(createTitle);
    if (!title) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (!token) return;
      await createDraft({ token, title });
      setCreateOpen(false);
      setNotice("Template created.");
      toast(`Template created\n${title}`, "success");
      await refresh();
      window.dispatchEvent(new CustomEvent("portal:draftsChanged"));
    } catch (e) {
      setError(e?.message || "Create failed");
    } finally {
      setLoading(false);
    }
  };

  const openPublish = async (file) => {
    setPublishFile(file || null);
    setSelectedProjectId("");
    setPublishDestination("project");
    setPublishOpen(true);
    setError("");
    setNotice("");
    try {
      await Promise.all([loadProjects(), refreshTemplatesRoom()]);
    } catch (e) {
      setError(e?.message || "Failed to load projects");
    }
  };

  const onPublish = async () => {
    const fileId = normalize(publishFile?.id);
    const projectId = normalize(selectedProjectId);
    const destination = normalize(publishDestination) || "project";
    if (!fileId) return;
    if (destination !== "templatesRoom" && !projectId) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (destination === "templatesRoom") {
        if (!templatesRoom?.id) {
          throw new Error("Shared templates room is not available. Open Settings and add an Admin token.");
        }
        const result = token
          ? await publishDraft({ token, fileId, destination: "templatesRoom", activate: false })
          : null;
        if (!result) throw new Error("Authorization token is required");
        setPublishOpen(false);
        setNotice(
          result?.warning
            ? `Published to "${templatesRoom?.title || "Projects Templates"}". ${result.warning}`
            : `Published to "${templatesRoom?.title || "Projects Templates"}".`
        );
        toast(`Published\n${normalize(publishFile?.title) || "Template"} → ${templatesRoom?.title || "Projects Templates"}`, "success");
        return;
      }

      const project = (projects || []).find((p) => String(p.id) === projectId) || null;
      if (!project?.roomId) throw new Error("Project room is missing");

      if (!projectPermissions?.[String(projectId)]) {
        throw new Error("Only the project admin can publish templates to this project.");
      }

      const result = token ? await publishDraft({ token, fileId, projectId, destination: "project", activate: true }) : null;
      if (!result) throw new Error("Authorization token is required");
      setPublishOpen(false);
      window.dispatchEvent(new CustomEvent("portal:projectChanged"));
      window.dispatchEvent(new CustomEvent("portal:templatesChanged"));
      setNotice(
        result?.warning
          ? `Published to project and set as current. ${result.warning}`
          : "Published to project and set as current."
      );
      toast(`Published\n${normalize(publishFile?.title) || "Template"} → ${project?.title || "Project"}`, "success");
    } catch (e) {
      setError(e?.message || "Publish failed");
    } finally {
      setLoading(false);
    }
  };

  const openDoc = (draft) => {
    const url = String(draft?.webUrl || "").trim();
    if (!url) return;
    setDocModal({ open: true, title: draft?.title || "Template", url });
  };

  const startRequestFromSharedTemplate = async (template) => {
    if (!template?.id) return;
    setRequestTemplate(template);
    setRequestOpen(true);
    setRequestBusy(true);
    setRequestDueDate("");
    setError("");
    setNotice("");
    try {
      if (!token) throw new Error("Authorization token is required");
      const sidebar = await getProjectsSidebar({ token }).catch(() => null);
      const list = Array.isArray(sidebar?.projects) ? sidebar.projects : [];
      const activeRoomId = String(sidebar?.activeRoomId || "").trim();
      setRequestProjects(list);
      setRequestActiveRoomId(activeRoomId);
      const activeProject = activeRoomId ? list.find((p) => String(p?.roomId || "").trim() === activeRoomId) : null;
      const defaultProjectId = String(activeProject?.id || list?.[0]?.id || "").trim();
      setRequestProjectId(defaultProjectId);
    } catch (e) {
      setError(e?.message || "Failed to load projects");
    } finally {
      setRequestBusy(false);
    }
  };

  const onCreateRequest = async () => {
    const templateId = normalize(requestTemplate?.id);
    const projectId = normalize(requestProjectId);
    if (!templateId || !projectId) return;
    setRequestBusy(true);
    setError("");
    setNotice("");
    try {
      if (!token) throw new Error("Authorization token is required");
      const result = await createFlowFromTemplate({
        token,
        templateFileId: templateId,
        projectId,
        dueDate: normalize(requestDueDate) || undefined,
      });
      const flow = result?.flow || null;
      setRequestOpen(false);
      setRequestTemplate(null);
      setRequestDueDate("");
      setNotice(flow ? `Request created: ${flow.fileTitle || flow.templateTitle || flow.id}` : "Request created.");
      toast(`Request created\n${flow?.fileTitle || flow?.templateTitle || flow?.id || ""}`.trim(), "success");
      window.dispatchEvent(new CustomEvent("portal:projectChanged"));
    } catch (e) {
      setError(e?.message || "Failed to create request");
    } finally {
      setRequestBusy(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all([
      refresh().catch(() => null),
      refreshTemplatesRoom().catch(() => null),
      refreshSharedTemplates().catch(() => null)
    ]);
  };

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <h2>Templates</h2>
          <p className="muted">Create templates, publish them to projects, then start approval requests.</p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={onOpenProjects} disabled={busy || loading}>
            Projects
          </button>
          <button type="button" onClick={refreshAll} disabled={busy || loading || templatesRoomLoading || sharedLoading}>
            Refresh
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => setCreateOpen(true)}
            disabled={busy || loading || !token}
            data-tour="templates:new"
          >
            New template
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <section className="card compact templates-switch">
        <div className="templates-switch-row">
          <Tabs value={tab} onChange={setTab} items={tabItems} ariaLabel="Templates view" />
          <input
            value={tab === "published" ? sharedQuery : query}
            onChange={(e) => (tab === "published" ? setSharedQuery(e.target.value) : setQuery(e.target.value))}
            placeholder={tab === "published" ? "Search published templates..." : "Search drafts..."}
            disabled={busy || loading || (tab === "published" && sharedLoading)}
            className="templates-search"
          />
        </div>
      </section>

      {tab === "published" ? (
        <>
          {templatesRoom?.id ? (
            <p className="muted" style={{ marginTop: -6 }}>
              Shared templates room: <strong>{templatesRoom?.title || "Projects Templates"}</strong>{" "}
              {templatesRoom?.roomUrl ? (
                <a className="btn link" href={templatesRoom.roomUrl} target="_blank" rel="noreferrer">
                  Open room
                </a>
              ) : null}
            </p>
          ) : templatesRoomLoading ? (
            <p className="muted" style={{ marginTop: -6 }}>Checking shared templates room...</p>
          ) : null}

          <section className="card page-card">
            <div className="card-header compact">
              <div>
                <h3>Published templates</h3>
                <p className="muted">PDF forms available to everyone in this portal.</p>
              </div>
              <div className="card-header-actions">
                <button type="button" onClick={refreshSharedTemplates} disabled={busy || loading || sharedLoading || !token}>
                  Refresh
                </button>
                <span className="muted">{filteredShared.length} shown</span>
              </div>
            </div>

            <div className="list scroll-area">
              {sharedLoading ? (
                <EmptyState title="Loading..." />
              ) : !templatesRoom?.id ? (
                <EmptyState
                  title="Shared room is not available"
                  description="Open Settings and add an Admin token so the portal can create/share the room."
                  actions={
                    typeof onOpenSettings === "function" ? (
                      <button type="button" onClick={onOpenSettings} disabled={busy || loading}>
                        Open Settings
                      </button>
                    ) : null
                  }
                />
              ) : filteredShared.length === 0 ? (
                <EmptyState
                  title={normalize(sharedQuery) ? "Nothing found" : "No published templates yet"}
                  description={
                    normalize(sharedQuery)
                      ? `No published templates match "${normalize(sharedQuery)}".`
                      : "Publish a PDF template to the shared room to make it available for everyone."
                  }
                  actions={
                    normalize(sharedQuery) ? (
                      <button type="button" onClick={() => setSharedQuery("")} disabled={busy || loading || sharedLoading}>
                        Clear search
                      </button>
                    ) : null
                  }
                />
              ) : (
                filteredShared.slice(0, 12).map((t) => (
                  <div key={t.id} className="list-row">
                    <div className="list-main">
                      <strong className="truncate">{t.title || `File ${t.id}`}</strong>
                      <span className="muted truncate">
                        <StatusPill tone={t.isForm ? "green" : "gray"}>{t.isForm ? "Form" : t.fileExst || "File"}</StatusPill>
                      </span>
                    </div>
                    <div className="list-actions">
                      {t.webUrl ? (
                        <a className="btn" href={t.webUrl} target="_blank" rel="noreferrer">
                          Open in new tab
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          if (!templatesRoom?.isOwner) {
                            toast("Only the shared room owner can unpublish templates.", "error");
                            return;
                          }
                          setDeleteEntry(t);
                          setDeleteOpen(true);
                        }}
                        disabled={busy || loading || !token || !templatesRoom?.id}
                        title={
                          templatesRoom?.isOwner
                            ? "Remove this template from the published list (shared room)"
                            : "Only the shared room owner can unpublish templates"
                        }
                      >
                        Unpublish
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => startRequestFromSharedTemplate(t)}
                        disabled={busy || loading || !token}
                        title="Choose a project for this request"
                      >
                        Create request
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {filteredShared.length > 12 ? (
              <p className="muted" style={{ marginTop: 10 }}>
                Showing 12 of {filteredShared.length}. Open the room to browse all templates.
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      {tab === "drafts" ? (
        <>
          {!loading && !error && filtered.length === 0 && !normalize(query) ? (
            <StepsCard
              title="Quick start"
              subtitle="Create a draft template, publish it, then start a request."
              steps={[
                {
                  title: "Create a PDF template",
                  description: 'Click "New template" to create a PDF, or upload an existing PDF form in your files.',
                  hint: "PDF"
                },
                {
                  title: "Publish to a project",
                  description: 'Use "Publish" on a template to copy it into a project room or to the shared room.',
                  hint: "Admin only"
                },
                {
                  title: "Start a request",
                  description: 'Go to Requests and click "New request", then pick a published template.'
                }
              ]}
            />
          ) : null}

          <section className="card page-card">
            <div className="card-header compact">
              <div>
                <h3>Draft templates</h3>
                <p className="muted">PDF forms in your files.</p>
              </div>
              <div className="card-header-actions">
                <span className="muted">{filtered.length} shown</span>
              </div>
            </div>

            <div className="list scroll-area">
              {!filtered.length ? (
                <EmptyState
                  title={normalize(query) ? "Nothing found" : "No draft templates yet"}
                  description={
                    normalize(query)
                      ? `No draft templates match "${normalize(query)}".`
                      : "Create a new template, or upload files in your files."
                  }
                  actions={
                    normalize(query) ? (
                      <button type="button" onClick={() => setQuery("")} disabled={busy || loading}>
                        Clear search
                      </button>
                    ) : (
                      <button type="button" className="primary" onClick={() => setCreateOpen(true)} disabled={busy || loading || !token}>
                        New template
                      </button>
                    )
                  }
                />
              ) : (
                filtered.map((d) => (
                  <div key={d.id} className="list-row">
                    <div className="list-main">
                      <strong className="truncate">{d.title || `File ${d.id}`}</strong>
                      <span className="muted truncate">
                        <StatusPill tone={d.isForm ? "green" : "gray"}>{d.isForm ? "Form" : d.fileExst || "File"}</StatusPill>
                      </span>
                    </div>
                    <div className="list-actions">
                      <button type="button" onClick={() => openDoc(d)} disabled={!d.webUrl || busy || loading}>
                        Edit
                      </button>
                      <button type="button" className="primary" onClick={() => openPublish(d)} disabled={busy || loading}>
                        Publish
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setDeleteDraftEntry(d);
                          setDeleteDraftOpen(true);
                        }}
                        disabled={busy || loading || !token}
                        title="Delete this template from My documents"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}

      <Modal
        open={createOpen}
        title="Create template"
        onClose={() => {
          if (loading) return;
          setCreateOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setCreateOpen(false)} disabled={busy || loading}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={onCreate}
              disabled={
                busy ||
                loading ||
                !normalize(createTitle) ||
                !token
              }
            >
              {loading ? "Loading..." : "Create"}
            </button>
          </>
        }
      >
        <form className="auth-form" onSubmit={(e) => e.preventDefault()} style={{ marginTop: 0 }}>
          <label>
            <span>File name</span>
            <input value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} disabled={busy || loading} />
          </label>
        </form>
      </Modal>

      <Modal
        open={publishOpen}
        title={publishFile?.title ? `Publish "${publishFile.title}"` : "Publish"}
        onClose={() => {
          if (loading) return;
          setPublishOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setPublishOpen(false)} disabled={busy || loading}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={onPublish}
              disabled={
                busy ||
                loading ||
                !publishFile?.id ||
                (publishDestination !== "templatesRoom" &&
                  (!normalize(selectedProjectId) || !projectPermissions?.[String(selectedProjectId)])) ||
                (publishDestination === "templatesRoom" && !templatesRoom?.id)
              }
            >
              {loading
                ? "Loading..."
                : publishDestination === "templatesRoom"
                  ? "Send to shared room"
                  : "Send to project"}
            </button>
          </>
        }
      >
        <form className="auth-form" onSubmit={(e) => e.preventDefault()} style={{ marginTop: 0 }}>
          <label>
            <span>Destination</span>
            <select value={publishDestination} onChange={(e) => setPublishDestination(e.target.value)} disabled={busy || loading}>
              <option value="project">Project room</option>
              <option value="templatesRoom">Shared room: {templatesRoom?.title || "Projects Templates"}</option>
            </select>
          </label>

          {publishDestination === "templatesRoom" ? (
            <EmptyState
              title={templatesRoom?.id ? "Shared room selected" : "Shared room is not available"}
              description={
                templatesRoom?.id
                  ? "The PDF will be copied into the shared room Templates folder. Everyone registered in this portal gets access."
                  : "Open Settings and add an Admin token so the portal can create/share the room."
              }
              actions={
                typeof onOpenSettings === "function" && !templatesRoom?.id ? (
                  <button type="button" onClick={onOpenSettings} disabled={busy || loading}>
                    Open Settings
                  </button>
                ) : null
              }
            />
          ) : (
            <>
              <label>
                <span>Project</span>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={busy || loading}
                >
                  <option value="">Select a project...</option>
                  {(projects || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}{!projectPermissions?.[String(p.id)] ? " (admin only)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {normalize(selectedProjectId) && !projectPermissions?.[String(selectedProjectId)] ? (
                <p className="muted" style={{ marginTop: 0 }}>
                  Only the project admin can publish templates to this project.
                </p>
              ) : null}
                <div className="row-actions" style={{ justifyContent: "space-between" }}>
                  <button
                    type="button"
                    onClick={() => {
                      const base = `${window.location.origin}${window.location.pathname}`;
                      window.open(`${base}#projects`, "_blank", "noopener,noreferrer");
                    }}
                    disabled={busy || loading}
                    title="Opens Projects in a new tab"
                  >
                    Open Projects
                  </button>
                  <span className="muted" style={{ fontSize: 13 }}>
                    A copy will be added to the selected project room.
                  </span>
                </div>
            </>
          )}
        </form>
      </Modal>

      <Modal
        open={requestOpen}
        title={requestTemplate?.title ? `Create request: ${requestTemplate.title}` : "Create request"}
        onClose={() => {
          if (requestBusy) return;
          setRequestOpen(false);
          setRequestTemplate(null);
          setRequestDueDate("");
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setRequestOpen(false);
                setRequestTemplate(null);
                setRequestDueDate("");
              }}
              disabled={busy || requestBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={onCreateRequest}
              disabled={busy || requestBusy || !normalize(requestProjectId) || !requestTemplate?.id}
            >
              {requestBusy ? "Loading..." : "Create request"}
            </button>
          </>
        }
      >
        <form className="auth-form" onSubmit={(e) => e.preventDefault()} style={{ marginTop: 0 }}>
          {!requestProjects.length ? (
            <EmptyState
              title="No projects"
              description="Create a project first, then try again."
              actions={
                <button type="button" className="primary" onClick={() => onOpenProjects?.({ create: true })} disabled={busy || requestBusy}>
                  Create project
                </button>
              }
            />
          ) : (
            <>
              <label>
                <span>Project</span>
                <select
                  value={requestProjectId}
                  onChange={(e) => setRequestProjectId(e.target.value)}
                  disabled={busy || requestBusy}
                >
                  <option value="">Select a project...</option>
                  {(requestProjects || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                      {requestActiveRoomId && String(p.roomId) === String(requestActiveRoomId) ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ marginTop: 12 }}>
                <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                  <strong>Due date (optional)</strong>
                  <span className="muted">Helps track overdue requests.</span>
                </div>
                <div className="request-due">
                  <input
                    type="date"
                    value={requestDueDate}
                    onChange={(e) => setRequestDueDate(e.target.value)}
                    disabled={busy || requestBusy}
                  />
                  <div className="chip-row">
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        setRequestDueDate(d.toISOString().slice(0, 10));
                      }}
                      disabled={busy || requestBusy}
                    >
                      Tomorrow
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 7);
                        setRequestDueDate(d.toISOString().slice(0, 10));
                      }}
                      disabled={busy || requestBusy}
                    >
                      7 days
                    </button>
                    {requestDueDate ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => setRequestDueDate("")}
                        disabled={busy || requestBusy}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          )}
          <p className="muted" style={{ marginTop: 0 }}>
            We will create a fill-out link for this template and track the request in the selected project.
          </p>
        </form>
      </Modal>

      <Modal
        open={deleteOpen}
        title={deleteEntry?.title ? `Unpublish "${deleteEntry.title}"?` : "Unpublish template?"}
        onClose={() => {
          if (loading) return;
          setDeleteOpen(false);
          setDeleteEntry(null);
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setDeleteOpen(false);
                setDeleteEntry(null);
              }}
              disabled={busy || loading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const fid = normalize(deleteEntry?.id);
                if (!fid) return;
                setLoading(true);
                setError("");
                setNotice("");
                try {
                  if (!token) throw new Error("Authorization token is required");
                  await deleteSharedTemplate({ token, fileId: fid });
                  setDeleteOpen(false);
                  setDeleteEntry(null);
                  await refreshSharedTemplates();
                  setNotice("Template unpublished.");
                  toast("Template unpublished", "success");
                } catch (e) {
                  setError(e?.message || "Delete failed");
                } finally {
                  setLoading(false);
                }
              }}
              disabled={busy || loading || !token || !templatesRoom?.isOwner || !deleteEntry?.id}
            >
              {loading ? "Loading..." : "Unpublish"}
            </button>
          </>
        }
      >
        <EmptyState
          title="Only the room owner can delete published templates."
          description="This removes the file from the shared templates room (published list). Your original draft stays in My documents."
        />
      </Modal>

      <Modal
        open={deleteDraftOpen}
        title={deleteDraftEntry?.title ? `Delete "${deleteDraftEntry.title}"?` : "Delete template?"}
        onClose={() => {
          if (loading) return;
          setDeleteDraftOpen(false);
          setDeleteDraftEntry(null);
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setDeleteDraftOpen(false);
                setDeleteDraftEntry(null);
              }}
              disabled={busy || loading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                const fid = normalize(deleteDraftEntry?.id);
                if (!fid) return;
                setLoading(true);
                setError("");
                setNotice("");
                try {
                  if (!token) throw new Error("Authorization token is required");
                  await deleteDraftTemplate({ token, fileId: fid });
                  setDeleteDraftOpen(false);
                  setDeleteDraftEntry(null);
                  await refresh();
                  setNotice("Template deleted.");
                  toast("Template deleted", "success");
                } catch (e) {
                  setError(e?.message || "Delete failed");
                } finally {
                  setLoading(false);
                }
              }}
              disabled={busy || loading || !token || !deleteDraftEntry?.id}
            >
              {loading ? "Loading..." : "Delete"}
            </button>
          </>
        }
      >
        <EmptyState
          title="This will delete the file from My documents."
          description="Published copies in projects or the shared room will not be removed automatically."
        />
      </Modal>

      <DocSpaceModal
        open={docModal.open}
        title={docModal.title}
        url={docModal.url}
        onClose={() => setDocModal({ open: false, title: "", url: "" })}
      />
    </div>
  );
}
