import { useEffect, useMemo, useState } from "react";
import {
  createLibraryRoom,
  getLibraryStatus,
  getProjectsSidebar,
  listLibraryFiles,
  publishLibraryFile
} from "../services/portalApi.js";
import EmptyState from "../components/EmptyState.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { toast } from "../utils/toast.js";

export default function Library({ session, busy }) {
  const token = session?.token || "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState([]);

  const [projects, setProjects] = useState([]);
  const [targetRoomId, setTargetRoomId] = useState("");
  const [newRoomTitle, setNewRoomTitle] = useState("Drafts");

  const targetProject = useMemo(
    () => projects.find((p) => String(p.roomId) === String(targetRoomId)) || null,
    [projects, targetRoomId]
  );

  const refresh = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const [s, f, p] = await Promise.all([
        getLibraryStatus(),
        listLibraryFiles().catch(() => null),
        token ? getProjectsSidebar({ token }).catch(() => null) : null
      ]);
      setStatus(s);
      setProjects(Array.isArray(p?.projects) ? p.projects : []);
      if (f?.files) setFiles(f.files);
      else setFiles([]);
    } catch (e) {
      setError(e?.message || "Failed to load library");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createRoom = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await createLibraryRoom({ title: newRoomTitle });
      await refresh();
      setNotice("Library room created.");
      toast("Library room created", "success");
    } catch (e) {
      setError(e?.message || "Create failed");
    } finally {
      setLoading(false);
    }
  };

  const publish = async (fileId) => {
    const fid = String(fileId || "").trim();
    if (!fid) return;
    if (!targetRoomId) {
      setError("Select a target project room first.");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await publishLibraryFile({ token, fileId: fid, targetRoomId });
      setNotice("Published to project room.");
      toast("Published to project room", "success");
    } catch (e) {
      setError(e?.message || "Publish failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <h2>Template library</h2>
          <p className="muted">Draft and edit files in a separate room, then publish to a project room.</p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={refresh} disabled={busy || loading}>
            Refresh
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <section className="card">
        <div className="card-header">
          <h3>Library room</h3>
          <p className="muted">This is an Editing room for drafts.</p>
        </div>

        {!status?.hasLibrary ? (
          <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
            <p className="muted" style={{ marginTop: 0 }}>
              <StatusPill tone="yellow">not set</StatusPill> Create a library room to store drafts.
            </p>
            <label>
              <span>Room name</span>
              <input value={newRoomTitle} onChange={(e) => setNewRoomTitle(e.target.value)} disabled={busy || loading} />
            </label>
            <div className="row-actions">
              <button
                type="button"
                className="primary"
                onClick={createRoom}
                disabled={busy || loading || !String(newRoomTitle || "").trim()}
              >
                Create library room
              </button>
            </div>
          </form>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <EmptyState title="Library room configured" description="Ready to use." />
            <details>
              <summary className="muted" style={{ cursor: "pointer" }}>
                Advanced
              </summary>
              <p className="muted" style={{ margin: "8px 0 0" }}>
                Room ID: {status.libraryRoomId}
              </p>
            </details>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-header">
          <h3>Publish target</h3>
          <p className="muted">Choose a project room to receive published forms.</p>
        </div>
        <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
          <label>
            <span>Project</span>
            <select value={targetRoomId} onChange={(e) => setTargetRoomId(e.target.value)} disabled={busy || loading}>
              <option value="">Select...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.roomId}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          {targetProject ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Target room: <strong>{targetProject.title}</strong>
            </p>
          ) : null}
        </form>
      </section>

      <section className="card page-card">
        <div className="card-header">
          <h3>Draft files</h3>
          <p className="muted">Publish a file to make it available in the active project room.</p>
        </div>

        {!files.length ? (
          <EmptyState title="No files" description="Add draft files to the library room, then click Refresh." />
        ) : (
          <div className="list scroll-area">
            {files.map((f) => (
              <div key={f.id} className="list-row">
                <div className="list-main">
                  <strong>{f.title || `File ${f.id}`}</strong>
                  <span className="muted">
                    <StatusPill tone={f.isForm ? "green" : "gray"}>{f.isForm ? "Form" : "File"}</StatusPill>
                    {f.fileExst ? ` - ${f.fileExst}` : ""}
                  </span>
                </div>
                <div className="list-actions">
                  <button type="button" className="primary" onClick={() => publish(f.id)} disabled={busy || loading}>
                    Publish
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
