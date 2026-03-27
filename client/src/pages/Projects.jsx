import { useCallback, useEffect, useMemo, useState } from "react";
import ContextMenu from "../components/ContextMenu.jsx";
import EmptyState from "../components/EmptyState.jsx";
import EmailChipsInput from "../components/EmailChipsInput.jsx";
import Modal from "../components/Modal.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { toast } from "../utils/toast.js";
import {
  activateProject,
  archiveProject,
  createProject,
  deleteProject,
  getProjectsPermissions,
  getProjectsList,
  inviteProject,
  unarchiveProject
} from "../services/portalApi.js";

function normalizeTitle(value) {
  return String(value || "").trim();
}

export default function Projects({ session, busy, onOpenProject, onOpenDrafts }) {
  const token = session?.token || "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [projects, setProjects] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("active"); // active | archived
  const [focusId, setFocusId] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");

  const [actionsProjectEntry, setActionsProjectEntry] = useState(null);
  const [actionsAnchorEl, setActionsAnchorEl] = useState(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteProjectEntry, setInviteProjectEntry] = useState(null);
  const [invite, setInvite] = useState({
    emails: "",
    access: "FillForms",
    notify: false,
    message: ""
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState(null);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveEntry, setArchiveEntry] = useState(null);
  const [archiveWarnOpen, setArchiveWarnOpen] = useState(false);
  const [archiveOpenRequests, setArchiveOpenRequests] = useState(0);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreEntry, setRestoreEntry] = useState(null);
  const [setCurrentOpen, setSetCurrentOpen] = useState(false);
  const [setCurrentEntry, setSetCurrentEntry] = useState(null);

  const filtered = useMemo(() => {
    const q = normalizeTitle(query).toLowerCase();
    const list = Array.isArray(projects) ? projects : [];
    const scoped = tab === "archived" ? list.filter((p) => Boolean(p?.archivedAt)) : list.filter((p) => !p?.archivedAt);
    const items = q ? scoped.filter((p) => String(p.title || "").toLowerCase().includes(q)) : scoped.slice();
    items.sort((a, b) => {
      return String(a?.title || "").localeCompare(String(b?.title || ""));
    });
    return items;
  }, [projects, query, tab]);

  const countsForTab = useMemo(() => {
    const list = Array.isArray(projects) ? projects : [];
    const items = tab === "archived" ? list.filter((p) => Boolean(p?.archivedAt)) : list.filter((p) => !p?.archivedAt);
    return items.reduce(
      (acc, p) => {
        acc.total += Number(p?.counts?.total || 0);
        acc.inProgress += Number(p?.counts?.inProgress || 0);
        return acc;
      },
      { total: 0, inProgress: 0 }
    );
  }, [projects, tab]);

  const currentProjectTitle = useMemo(() => {
    const rid = String(activeRoomId || "").trim();
    if (!rid) return "";
    const list = Array.isArray(projects) ? projects : [];
    const found = list.find((p) => String(p?.roomId || "").trim() === rid) || null;
    return String(found?.title || "").trim();
  }, [activeRoomId, projects]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await getProjectsList({ token });
      const list = Array.isArray(res?.projects) ? res.projects : [];
      setProjects(list);
      setActiveRoomId(res?.activeRoomId || null);

      if (token) {
        const perms = await getProjectsPermissions({ token }).catch(() => null);
        setPermissions(perms?.permissions && typeof perms.permissions === "object" ? perms.permissions : {});
      } else {
        setPermissions({});
      }

      return { activeRoomId: res?.activeRoomId || null, projects: list };
    } catch (e) {
      setError(e?.message || "Failed to load projects");
      return { activeRoomId: null, projects: [] };
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id, token]);

  useEffect(() => {
    refresh().catch(() => null);
    const handler = () => refresh().catch(() => null);
    window.addEventListener("portal:projectChanged", handler);
    return () => window.removeEventListener("portal:projectChanged", handler);
  }, [refresh]);

  useEffect(() => {
    const onCreate = () => setCreateOpen(true);
    window.addEventListener("portal:projectsCreate", onCreate);
    return () => window.removeEventListener("portal:projectsCreate", onCreate);
  }, []);

  // Reserved for future deep-linking into Active/Archived tabs.

  const onSetCurrent = async (project) => {
    if (!project?.id) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await activateProject(project.id);
      setActiveRoomId(result?.activeRoomId || project.roomId || null);
      setNotice("Current project changed.");
      toast("Current project changed", "success");
      window.dispatchEvent(new CustomEvent("portal:projectChanged"));
    } catch (e) {
      setError(e?.message || "Failed to switch project");
    } finally {
      setLoading(false);
    }
  };

  const openInvite = (project) => {
    setInviteProjectEntry(project || null);
    setInvite((s) => ({ ...s, emails: "", message: "" }));
    setInviteOpen(true);
    setError("");
    setNotice("");
  };

  const openActions = (project) => {
    setActionsProjectEntry(project || null);
    setActionsMenuOpen(true);
    setError("");
    setNotice("");
  };

  const closeActions = () => {
    setActionsMenuOpen(false);
    setActionsAnchorEl(null);
  };

  const onInvite = async () => {
    const project = inviteProjectEntry;
    const emails = normalizeTitle(invite.emails);
    if (!project?.id || !emails) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await inviteProject({
        token,
        projectId: project.id,
        emails,
        access: invite.access,
        notify: invite.notify,
        message: invite.message
      });
      setInviteOpen(false);
      setNotice(`Invited ${data?.invited || 0} user(s).`);
      toast("Invites sent", "success");
    } catch (e) {
      setError(e?.message || "Invite failed");
    } finally {
      setLoading(false);
    }
  };

  const onCreate = async () => {
    const title = normalizeTitle(createTitle);
    if (!title) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await createProject({ token, title });
      setCreateOpen(false);
      setCreateTitle("");
      await refresh();
      setNotice("Project created and set as current.");
      toast("Project created", "success");
      window.dispatchEvent(new CustomEvent("portal:projectChanged"));
    } catch (e) {
      setError(e?.message || "Create failed");
    } finally {
      setLoading(false);
    }
  };

  const openDelete = (project) => {
    setDeleteEntry(project || null);
    setDeleteOpen(true);
    setError("");
    setNotice("");
  };

  const openArchive = (project) => {
    setArchiveEntry(project || null);
    setArchiveOpen(true);
    setArchiveWarnOpen(false);
    setArchiveOpenRequests(0);
    setError("");
    setNotice("");
  };

  const openRestore = (project) => {
    setRestoreEntry(project || null);
    setRestoreOpen(true);
    setError("");
    setNotice("");
  };

 	  const doArchive = async ({ cancelOpenRequests } = {}) => {
 	    const project = archiveEntry;
 	    if (!project?.id) return;
 	    setLoading(true);
 	    setError("");
 	    setNotice("");
 	    try {
 	      const res = await archiveProject({ token, projectId: project.id, cancelOpenRequests: Boolean(cancelOpenRequests) });
 	      setArchiveOpen(false);
 	      setArchiveWarnOpen(false);
 	      setArchiveEntry(null);
 	      setArchiveOpenRequests(0);
 	      await refresh();
 	      setNotice(res?.warning ? `Project archived. ${res.warning}` : "Project archived.");
        toast("Project archived", "success");
 	      window.dispatchEvent(new CustomEvent("portal:projectChanged"));
 	    } catch (e) {
 	      if (e?.status === 409 && typeof e?.details?.openRequests === "number") {
 	        setArchiveOpen(false);
         setArchiveOpenRequests(Number(e.details.openRequests) || 0);
         setArchiveWarnOpen(true);
       } else {
         setError(e?.message || "Archive failed");
       }
     } finally {
       setLoading(false);
     }
   };

  const doRestore = async () => {
    const project = restoreEntry;
    if (!project?.id) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await unarchiveProject({ token, projectId: project.id });
      setRestoreOpen(false);
      setRestoreEntry(null);
      const refreshed = await refresh();
      setNotice("Project restored.");
      toast("Project restored", "success");
      window.dispatchEvent(new CustomEvent("portal:projectChanged"));
      if (!refreshed?.activeRoomId) {
        setSetCurrentEntry(project);
        setSetCurrentOpen(true);
      }
    } catch (e) {
      setError(e?.message || "Restore failed");
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async () => {
    const project = deleteEntry;
    if (!project?.id) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await deleteProject({ token, projectId: project.id });
      setDeleteOpen(false);
      setDeleteEntry(null);
      await refresh();
      setNotice("Project removed from portal list.");
      toast("Project removed", "success");
      window.dispatchEvent(new CustomEvent("portal:projectChanged"));
    } catch (e) {
      setError(e?.message || "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell projects-page">
      <header className="topbar">
        <div>
          <h2>Projects</h2>
          <p className="muted">Create a project room, select it as current, then invite people.</p>
        </div>
        <div className="topbar-actions projects-topbar-actions">
          <input
            className="projects-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects..."
            disabled={busy || loading}
          />
          <button type="button" onClick={refresh} disabled={busy || loading}>
            Refresh
          </button>
          {typeof onOpenDrafts === "function" ? (
            <button type="button" onClick={onOpenDrafts} disabled={busy || loading}>
              Templates
            </button>
          ) : null}
          <button type="button" className="primary" onClick={() => setCreateOpen(true)} disabled={busy || loading}>
            New project
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <div className="chip-row" aria-label="Project list mode" style={{ marginBottom: 14 }} data-tour="projects:tabs">
        <button
          type="button"
          className={`chip${tab === "active" ? " is-active" : ""}`}
          onClick={() => setTab("active")}
          disabled={busy || loading}
        >
          Active
        </button>
        <button
          type="button"
          className={`chip${tab === "archived" ? " is-active" : ""}`}
          onClick={() => setTab("archived")}
          disabled={busy || loading}
          data-tour="projects:tab-archived"
        >
          Archived
        </button>
      </div>

      {!filtered.length ? (
        <section className="card">
          <EmptyState
            title={normalizeTitle(query) ? "Nothing found" : tab === "archived" ? "No archived projects" : "No projects yet"}
            description={
              normalizeTitle(query)
                ? `No projects match "${normalizeTitle(query)}".`
                : tab === "archived"
                ? "Archived projects will appear here after you archive them."
                : "Create a project to publish templates and start approval requests."
            }
            actions={
              normalizeTitle(query) ? (
                <button type="button" onClick={() => setQuery("")} disabled={busy || loading}>
                  Clear search
                </button>
              ) : tab === "archived" ? (
                <button type="button" onClick={() => setTab("active")} disabled={busy || loading}>
                  View active projects
                </button>
              ) : (
                <button type="button" className="primary" onClick={() => setCreateOpen(true)} disabled={busy || loading}>
                  Create project
                </button>
              )
            }
          />
        </section>
      ) : (
        <section className="card page-card">
          <div className="card-header compact">
            <div>
              <h3>{tab === "archived" ? "Archived projects" : "Project rooms"}</h3>
              <p className="muted">
                {tab === "archived" ? "Restore archived projects when you need them again." : "Open a project to manage members, templates, and requests."}
              </p>
            </div>
            <div className="card-header-actions">
              <span className="muted">{filtered.length} shown</span>
            </div>
          </div>

          <div className="projects-kpis" aria-label="Projects summary">
            <div className="projects-kpi">
              <span className="muted">Projects</span>
              <strong>
                {Array.isArray(projects)
                  ? projects.filter((p) => (tab === "archived" ? p?.archivedAt : !p?.archivedAt)).length
                  : 0}
              </strong>
            </div>
            <div className="projects-kpi">
              <span className="muted">In progress</span>
              <strong>{countsForTab.inProgress}</strong>
            </div>
            <div className="projects-kpi">
              <span className="muted">Total requests</span>
              <strong>{countsForTab.total}</strong>
            </div>
            <div className="projects-kpi">
              <span className="muted">Current</span>
              <strong title={currentProjectTitle || ""}>{currentProjectTitle || "None"}</strong>
            </div>
          </div>

          <div className="projects-grid scroll-area" aria-label="Projects grid">
            {filtered.map((p, idx) => {
              const isCurrent = activeRoomId && String(p.roomId) === String(activeRoomId);
              const disabled = busy || loading;
              const canManage = Boolean(permissions?.[String(p.id)]);
              const inProgress = Number(p?.counts?.inProgress || 0);
              const total = Number(p?.counts?.total || 0);
              const isArchived = Boolean(p?.archivedAt);
              return (
                <div
                  key={p.id}
                  className={`project-card${isCurrent ? " is-current" : ""}${isArchived ? " is-archived" : ""}${focusId && String(p.id) === focusId ? " is-focused" : ""}`}
                >
                  <button
                    type="button"
                    className="project-card-main"
                    onClick={() => (typeof onOpenProject === "function" ? onOpenProject(p.id) : null)}
                    disabled={disabled}
                    title={isArchived ? "Open archived project (read-only)" : "Open project"}
                  >
                    <div className="project-card-title-row">
                      <strong className="truncate">{p.title || "Untitled"}</strong>
                      <span className="project-card-badges" aria-hidden="true">
                        {isCurrent ? <StatusPill tone="green">Current</StatusPill> : null}
                        {isArchived ? <StatusPill tone="gray">Archived</StatusPill> : null}
                        {canManage ? <StatusPill tone="blue">Admin</StatusPill> : <StatusPill tone="gray">Member</StatusPill>}
                      </span>
                    </div>

                    <div className="project-card-metrics" aria-label="Request counts">
                      <div className="project-metric">
                        <span className="muted">In progress</span>
                        <strong>{inProgress}</strong>
                      </div>
                      <div className="project-metric">
                        <span className="muted">Total</span>
                        <strong>{total}</strong>
                      </div>
                    </div>

                    {isArchived && p?.archivedAt ? (
                      <div className="project-card-footnote muted">
                        Archived {String(p.archivedAt).slice(0, 10)}
                        {p?.archivedByName ? ` by ${p.archivedByName}` : ""}
                      </div>
                    ) : null}
                  </button>

                  <div className="project-card-actions" aria-label="Project actions">
                    {!isArchived ? (
                      <button type="button" onClick={() => onSetCurrent(p)} disabled={disabled || isCurrent}>
                        {isCurrent ? "Current" : "Set current"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openRestore(p)}
                        disabled={disabled || !canManage}
                        data-tour={idx === 0 ? "projects:restore" : undefined}
                      >
                        Restore
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button projects-more"
                      onClick={(e) => {
                        setActionsProjectEntry(p);
                        setActionsAnchorEl(e.currentTarget);
                        openActions(p);
                      }}
                      disabled={disabled}
                      aria-label="More actions"
                      title="More actions"
                      data-tour={isCurrent ? "projects:more-current" : undefined}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <ContextMenu
        open={actionsMenuOpen}
        anchorEl={actionsAnchorEl}
        onClose={() => {
          if (loading) return;
          closeActions();
          setActionsProjectEntry(null);
        }}
        ariaLabel="Project actions"
      >
        {(() => {
          const p = actionsProjectEntry;
          if (!p?.id) return null;
          const isCurrent = activeRoomId && String(p.roomId) === String(activeRoomId);
          const canManage = Boolean(permissions?.[String(p.id)]);
          const disabled = busy || loading;
          const isArchived = Boolean(p?.archivedAt);
          return (
            <>
              {isArchived ? (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    closeActions();
                    setActionsProjectEntry(null);
                    openRestore(p);
                  }}
                  disabled={disabled || !canManage}
                  role="menuitem"
                >
                  <span>Restore</span>
                  <span className="menu-item-meta">{canManage ? "Back to active" : "Admin only"}</span>
                </button>
              ) : null}

                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    closeActions();
                    setActionsProjectEntry(null);
                    if (typeof onOpenProject === "function") onOpenProject(p.id);
                  }}
                  disabled={disabled}
                  role="menuitem"
                >
                  <span>{isArchived ? "View" : "Open"}</span>
                  <span className="menu-item-meta">{isArchived ? "Read-only" : "View project"}</span>
                </button>

              <button
                type="button"
                className="menu-item"
                onClick={async () => {
                  closeActions();
                  setActionsProjectEntry(null);
                  await onSetCurrent(p);
                }}
                disabled={disabled || isCurrent || isArchived}
                role="menuitem"
              >
                <span>{isCurrent ? "Current project" : "Set as current"}</span>
                <span className="menu-item-meta">{isCurrent ? "Selected" : isArchived ? "Archived" : "Use for requests"}</span>
              </button>

              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  closeActions();
                  setActionsProjectEntry(null);
                  openInvite(p);
                }}
                disabled={disabled || !canManage || isArchived}
                role="menuitem"
              >
                <span>Invite people</span>
                <span className="menu-item-meta">{canManage ? "Add members" : "Admin only"}</span>
              </button>

              {!isArchived ? (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    closeActions();
                    setActionsProjectEntry(null);
                    openArchive(p);
                  }}
                  disabled={disabled || !canManage}
                  role="menuitem"
                  data-tour="projects:archive-action"
                >
                  <span>Archive</span>
                  <span className="menu-item-meta">{canManage ? "Hide from active" : "Admin only"}</span>
                </button>
              ) : null}

              {p.roomUrl ? <div className="menu-sep" /> : null}

              {p.roomUrl ? (
                <a className="menu-item" href={p.roomUrl} target="_blank" rel="noreferrer" role="menuitem">
                  <span>Open room</span>
                  <span className="menu-item-meta">New tab</span>
                </a>
              ) : null}

              <div className="menu-sep" />

              <button
                type="button"
                className="menu-item danger"
                onClick={() => {
                  closeActions();
                  setActionsProjectEntry(null);
                  openDelete(p);
                }}
                disabled={disabled || !canManage}
                role="menuitem"
              >
                <span>Remove from portal</span>
                <span className="menu-item-meta">{canManage ? "Does not delete room" : "Admin only"}</span>
              </button>
            </>
          );
        })()}
      </ContextMenu>

      <Modal
        open={archiveOpen}
        title={archiveEntry?.title ? `Archive ${archiveEntry.title}?` : "Archive project?"}
        onClose={() => {
          if (loading) return;
          setArchiveOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setArchiveOpen(false)} disabled={busy || loading}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => doArchive({ cancelOpenRequests: false })}
              disabled={busy || loading || !archiveEntry?.id || !permissions?.[String(archiveEntry?.id || "")]}
            >
              {loading ? "Loading..." : "Archive"}
            </button>
          </>
        }
      >
        {!permissions?.[String(archiveEntry?.id || "")] ? (
          <p className="muted" style={{ margin: "0 0 10px" }}>
            Only the room admin can archive projects.
          </p>
        ) : null}
        <EmptyState title="This archives the related project rooms." description="If the project has open requests, you will be asked to cancel them first." />
      </Modal>

      <Modal
        open={archiveWarnOpen}
        title="Archive project with open requests?"
        onClose={() => {
          if (loading) return;
          setArchiveWarnOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setArchiveWarnOpen(false)} disabled={busy || loading}>
              Keep active
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => doArchive({ cancelOpenRequests: true })}
              disabled={busy || loading || !archiveEntry?.id || !permissions?.[String(archiveEntry?.id || "")]}
            >
              {loading ? "Loading..." : "Archive and cancel requests"}
            </button>
          </>
        }
      >
        <EmptyState
          title={`${archiveOpenRequests || "Some"} request(s) are still open.`}
          description="Archiving will cancel open requests in the portal and move the related project rooms to archive."
        />
      </Modal>

      <Modal
        open={restoreOpen}
        title={restoreEntry?.title ? `Restore ${restoreEntry.title}?` : "Restore project?"}
        onClose={() => {
          if (loading) return;
          setRestoreOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setRestoreOpen(false)} disabled={busy || loading}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={doRestore}
              disabled={busy || loading || !restoreEntry?.id || !permissions?.[String(restoreEntry?.id || "")]}
            >
              {loading ? "Loading..." : "Restore"}
            </button>
          </>
        }
      >
        {!permissions?.[String(restoreEntry?.id || "")] ? (
          <p className="muted" style={{ margin: "0 0 10px" }}>
            Only the room admin can restore projects.
          </p>
        ) : null}
        <EmptyState
          title="This restores the related project rooms from archive."
          description="You can set it as the current project afterwards."
        />
      </Modal>

      <Modal
        open={setCurrentOpen}
        title="Set as current project?"
        onClose={() => {
          setSetCurrentOpen(false);
          setSetCurrentEntry(null);
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => {
                setSetCurrentOpen(false);
                setSetCurrentEntry(null);
              }}
              disabled={busy || loading}
            >
              Not now
            </button>
            <button
              type="button"
              className="primary"
              onClick={async () => {
                const p = setCurrentEntry;
                setSetCurrentOpen(false);
                setSetCurrentEntry(null);
                await onSetCurrent(p);
              }}
              disabled={busy || loading || !setCurrentEntry?.id}
            >
              Set as current
            </button>
          </>
        }
      >
        <EmptyState
          title="No current project is selected."
          description="Setting a current project makes it the default target for new requests."
        />
      </Modal>

      <Modal
        open={createOpen}
        title="Create project"
        onClose={() => {
          if (loading) return;
          setCreateOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setCreateOpen(false)} disabled={busy || loading}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={onCreate} disabled={busy || loading || !normalizeTitle(createTitle)}>
              {loading ? "Loading..." : "Create"}
            </button>
          </>
        }
      >
        <form className="auth-form" onSubmit={(e) => e.preventDefault()} style={{ marginTop: 0 }}>
          <label>
            <span>Project name</span>
            <input value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} disabled={busy || loading} />
          </label>
          <p className="muted" style={{ margin: 0 }}>
            Creates a new project room and makes it active.
          </p>
        </form>
      </Modal>

      <Modal
        open={inviteOpen}
        title={inviteProjectEntry?.title ? `Invite to ${inviteProjectEntry.title}` : "Invite"}
        onClose={() => {
          if (loading) return;
          setInviteOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setInviteOpen(false)} disabled={busy || loading}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              onClick={onInvite}
              disabled={busy || loading || !inviteProjectEntry?.id || !normalizeTitle(invite.emails) || !permissions?.[String(inviteProjectEntry?.id || "")]}
            >
              {loading ? "Loading..." : "Send invites"}
            </button>
          </>
        }
      >
        {!permissions?.[String(inviteProjectEntry?.id || "")] ? (
          <p className="muted" style={{ margin: "0 0 10px" }}>
            Only the room admin can invite people to this project.
          </p>
        ) : null}
        <form className="auth-form" onSubmit={(e) => e.preventDefault()} style={{ marginTop: 0 }}>
          <label>
            <span>Emails</span>
            <EmailChipsInput
              value={invite.emails}
              onChange={(next) => setInvite((s) => ({ ...s, emails: next }))}
              placeholder="Type an email and press Enter"
              disabled={busy || loading}
            />
          </label>
          <label>
            <span>Role</span>
            <select value={invite.access} onChange={(e) => setInvite((s) => ({ ...s, access: e.target.value }))}>
              <option value="FillForms">Form respondent</option>
              <option value="Read">Project viewer</option>
              <option value="ReadWrite">Project editor</option>
              <option value="RoomManager">Project admin</option>
            </select>
          </label>
          <p className="muted" style={{ marginTop: 0 }}>
            {invite.access === "RoomManager"
              ? "Admins can invite people and cancel requests."
              : invite.access === "ReadWrite"
                ? "Editors can work with files (if allowed by the room)."
                : invite.access === "Read"
                  ? "Viewers can open project files and track requests."
                  : "Respondents can fill forms and complete requests assigned to them."}
          </p>
          <label>
            <span>
              <input
                type="checkbox"
                checked={Boolean(invite.notify)}
                onChange={(e) => setInvite((s) => ({ ...s, notify: e.target.checked }))}
              />{" "}
              Send notifications
            </span>
          </label>
          <label>
            <span>Message (optional)</span>
            <input value={invite.message} onChange={(e) => setInvite((s) => ({ ...s, message: e.target.value }))} />
          </label>
        </form>
      </Modal>

      <Modal
        open={deleteOpen}
        title={deleteEntry?.title ? `Delete ${deleteEntry.title}?` : "Delete project?"}
        onClose={() => {
          if (loading) return;
          setDeleteOpen(false);
        }}
        footer={
          <>
            <button type="button" onClick={() => setDeleteOpen(false)} disabled={busy || loading}>
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              onClick={onDelete}
              disabled={busy || loading || !deleteEntry?.id || !permissions?.[String(deleteEntry?.id || "")]}
            >
              {loading ? "Loading..." : "Delete"}
            </button>
          </>
        }
      >
        {!permissions?.[String(deleteEntry?.id || "")] ? (
          <p className="muted" style={{ margin: "0 0 10px" }}>
            Only the room admin can remove projects.
          </p>
        ) : null}
        <EmptyState title="This only removes the project from the portal list." description="The project room itself is not deleted." />
      </Modal>
    </div>
  );
}
