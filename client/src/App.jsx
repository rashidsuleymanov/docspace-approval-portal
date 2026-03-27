import { useEffect, useMemo, useState } from "react";
import AppLayout from "./components/AppLayout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Documents from "./pages/Documents.jsx";
import Requests from "./pages/Requests.jsx";
import Projects from "./pages/Projects.jsx";
import Project from "./pages/Project.jsx";
import StartDemo from "./pages/StartDemo.jsx";
import Drafts from "./pages/Drafts.jsx";
import Library from "./pages/Library.jsx";
import Contacts from "./pages/Contacts.jsx";
import BulkSend from "./pages/BulkSend.jsx";
import BulkLinks from "./pages/BulkLinks.jsx";
import SendDrafts from "./pages/SendDrafts.jsx";
import Settings from "./pages/Settings.jsx";
import DemoRoleSwitch from "./components/DemoRoleSwitch.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { getDemoSession, startDemo, endDemo } from "./services/demoApi.js";
import { toast } from "./utils/toast.js";
import {
  createFlowFromTemplate,
  getProjectsSidebar,
  getSettingsConfig,
  listDrafts,
  listFlows,
  listTemplates
} from "./services/portalApi.js";

const _parsedIdle = Number(import.meta.env.VITE_DEMO_IDLE_TIMEOUT_MS);
const DEMO_IDLE_TIMEOUT_MS = Number.isFinite(_parsedIdle) && _parsedIdle > 0 ? _parsedIdle : 5 * 60 * 1000;
const _parsedHidden = Number(import.meta.env.VITE_DEMO_HIDDEN_TIMEOUT_MS);
const DEMO_HIDDEN_TIMEOUT_MS = Number.isFinite(_parsedHidden) && _parsedHidden > 0 ? _parsedHidden : 30 * 1000;

function isPdfFile(item) {
  const ext = String(item?.fileExst || "").trim().toLowerCase();
  const title = String(item?.title || "").trim().toLowerCase();
  return ext === "pdf" || ext === ".pdf" || title.endsWith(".pdf");
}

// A session has requesterToken + user for API calls.
function makeSession(token, user) {
  if (!token || !user?.id) return null;
  return { token, user };
}

export default function App() {
  // Demo state
  const [demoSessionId, setDemoSessionId] = useState(null);
  const [recipientSession, setRecipientSession] = useState(null); // { token, user }
  const [activeRole, setActiveRole] = useState("requester"); // "requester" | "recipient"

  // App state
  const [view, setView] = useState("start");
  const [session, setSession] = useState(null); // { token, user } for the active role
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState("");
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false);
  const [branding, setBranding] = useState({
    portalName: "Requests Center",
    portalTagline: "Sign, approve, and track.",
    portalLogoUrl: "",
    portalAccent: ""
  });
  const [templates, setTemplates] = useState([]);
  const [flows, setFlows] = useState([]);
  const [flowsRefreshing, setFlowsRefreshing] = useState(false);
  const [flowsUpdatedAt, setFlowsUpdatedAt] = useState(null);
  const [projectId, setProjectId] = useState("");
  const [activeRoomId, setActiveRoomId] = useState("");
  const [activeProject, setActiveProject] = useState(null);
  const [sidebarProjects, setSidebarProjects] = useState([]);
  const [requestsFilter, setRequestsFilter] = useState("all");
  const [requestsScope, setRequestsScope] = useState("all");
  const [draftsPdfCount, setDraftsPdfCount] = useState(0);
  const [draftsLoaded, setDraftsLoaded] = useState(false);

  // On mount: check for an existing demo session (page refresh recovery).
  useEffect(() => {
    const init = async () => {
      try {
        const active = await getDemoSession();
        if (active?.requester?.id && active?.requesterToken) {
          const sess = makeSession(active.requesterToken, active.requester);
          setSession(sess);
          setDemoSessionId(active.sessionId);
          if (active.recipient?.id && active.recipientToken) {
            setRecipientSession(makeSession(active.recipientToken, active.recipient));
          }
          setView("dashboard");
        } else {
          setView("start");
        }
      } catch {
        setView("start");
      } finally {
        setBooting(false);
      }
    };
    init();
  }, []);

  // Send beacon on page close to clean up the demo session.
  useEffect(() => {
    if (!demoSessionId) return;

    let sent = false;
    const endOnPageClose = () => {
      if (sent) return;
      sent = true;
      try {
        const payload = "{}";
        const blob = new Blob([payload], { type: "application/json" });
        const beaconOk =
          typeof navigator !== "undefined" &&
          typeof navigator.sendBeacon === "function" &&
          navigator.sendBeacon("/api/demo/end", blob);
        if (!beaconOk) {
          fetch("/api/demo/end", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            keepalive: true,
            body: payload
          }).catch(() => null);
        }
      } catch {
        // ignore close-phase errors
      }
    };

    window.addEventListener("pagehide", endOnPageClose);
    window.addEventListener("beforeunload", endOnPageClose);

    return () => {
      window.removeEventListener("pagehide", endOnPageClose);
      window.removeEventListener("beforeunload", endOnPageClose);
    };
  }, [demoSessionId]);

  // Idle and hidden-tab timeout logic.
  useEffect(() => {
    if (!demoSessionId) return;

    let ended = false;
    let idleTimer = null;
    let hiddenTimer = null;

    const finishDemo = async (reason) => {
      if (ended) return;
      ended = true;
      try {
        await endDemo().catch(() => null);
      } finally {
        setSession(null);
        setRecipientSession(null);
        setDemoSessionId(null);
        setActiveRole("requester");
        setTemplates([]);
        setFlows([]);
        setActiveRoomId("");
        setActiveProject(null);
        setView("start");
        if (reason === "idle") toast.info("Demo ended after inactivity.");
        else if (reason === "hidden") toast.info("Demo ended after tab was left in background.");
      }
    };

    const armIdleTimer = () => {
      if (!Number.isFinite(DEMO_IDLE_TIMEOUT_MS) || DEMO_IDLE_TIMEOUT_MS <= 0) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finishDemo("idle"), DEMO_IDLE_TIMEOUT_MS);
    };

    const armHiddenTimer = () => {
      if (!Number.isFinite(DEMO_HIDDEN_TIMEOUT_MS) || DEMO_HIDDEN_TIMEOUT_MS <= 0) return;
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(() => finishDemo("hidden"), DEMO_HIDDEN_TIMEOUT_MS);
    };

    const onActivity = () => {
      if (ended) return;
      if (document.visibilityState === "visible") {
        if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
        armIdleTimer();
      }
    };

    const onVisibilityChange = () => {
      if (ended) return;
      if (document.visibilityState === "hidden") {
        armHiddenTimer();
      } else {
        if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
        armIdleTimer();
      }
    };

    const activityEvents = ["pointerdown", "keydown", "mousemove", "touchstart", "scroll"];
    for (const name of activityEvents) window.addEventListener(name, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    armIdleTimer();
    if (document.visibilityState === "hidden") armHiddenTimer();

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      for (const name of activityEvents) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [demoSessionId]);

  // Load settings / branding on mount.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const cfg = await getSettingsConfig().catch(() => null);
      if (!cfg || cancelled) return;
      setHasWebhookSecret(Boolean(cfg.hasWebhookSecret));
      setBranding((prev) => ({
        ...prev,
        portalName: cfg.portalName || prev.portalName,
        portalTagline: cfg.portalTagline || prev.portalTagline,
        portalLogoUrl: cfg.portalLogoUrl || prev.portalLogoUrl,
        portalAccent: cfg.portalAccent || prev.portalAccent
      }));
    };
    run();
    const handler = () => run();
    window.addEventListener("portal:brandingChanged", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("portal:brandingChanged", handler);
    };
  }, []);

  useEffect(() => {
    const name = String(branding?.portalName || "").trim() || "Requests Center";
    if (typeof document !== "undefined") document.title = name;
    const accent = String(branding?.portalAccent || "").trim();
    const root = typeof document !== "undefined" ? document.documentElement : null;
    if (!root) return;
    const isHex = /^#([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/.test(accent);
    if (!isHex) return;
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accentHover", accent);
    root.style.setProperty("--primary", accent);
    root.style.setProperty("--primaryHover", accent);
  }, [branding?.portalAccent, branding?.portalName]);

  const refreshActiveProject = useMemo(
    () => async () => {
      const token = session?.token ? String(session.token) : "";
      if (!token) return;
      const sidebar = await getProjectsSidebar({ token }).catch(() => null);
      const rid = sidebar?.activeRoomId ? String(sidebar.activeRoomId) : "";
      setActiveRoomId(rid);
      const list = Array.isArray(sidebar?.projects) ? sidebar.projects : [];
      setSidebarProjects(list);
      const found = rid ? list.find((p) => String(p.roomId) === rid) || null : null;
      setActiveProject(found ? { id: found.id, title: found.title, roomId: found.roomId, roomUrl: found.roomUrl || null } : null);
    },
    [session?.token]
  );

  useEffect(() => {
    if (!session?.token) return;
    const handler = () => refreshActiveProject().catch(() => null);
    window.addEventListener("portal:projectChanged", handler);
    return () => window.removeEventListener("portal:projectChanged", handler);
  }, [refreshActiveProject, session?.token]);

  const refreshFlows = useMemo(
    () => async (active) => {
      if (!active?.token) return;
      setFlowsRefreshing(true);
      try {
        const data = await listFlows({ token: active.token });
        setFlows(Array.isArray(data?.flows) ? data.flows : []);
        setFlowsUpdatedAt(new Date());
      } finally {
        setFlowsRefreshing(false);
      }
    },
    []
  );

  const refreshDraftsSummary = useMemo(
    () => async (active) => {
      if (!active?.token) return;
      try {
        const data = await listDrafts({ token: active.token });
        const items = Array.isArray(data?.drafts) ? data.drafts : [];
        setDraftsPdfCount(items.filter(isPdfFile).length);
      } catch {
        setDraftsPdfCount(0);
      } finally {
        setDraftsLoaded(true);
      }
    },
    []
  );

  // Declare effectiveSession early so it can be safely used in all effect dep arrays below.
  // (const declarations after this point would be in TDZ when deps arrays are evaluated.)
  const effectiveSession = useMemo(() => {
    if (activeRole === "recipient" && recipientSession?.token) return recipientSession;
    return session;
  }, [activeRole, recipientSession, session]);

  useEffect(() => {
    if (!session?.token) return;
    refreshActiveProject().catch(() => null);
    const handler = () => refreshActiveProject().catch(() => null);
    const draftsHandler = () => refreshDraftsSummary(session).catch(() => null);
    const flowsHandler = () => {
      refreshFlows(effectiveSession).catch(() => null);
      refreshActiveProject().catch(() => null);
    };
    const templatesHandler = () => loadTemplatesForSession(effectiveSession).catch(() => null);
    window.addEventListener("portal:projectChanged", handler);
    window.addEventListener("portal:draftsChanged", draftsHandler);
    window.addEventListener("portal:flowsChanged", flowsHandler);
    window.addEventListener("portal:templatesChanged", templatesHandler);
    return () => {
      window.removeEventListener("portal:projectChanged", handler);
      window.removeEventListener("portal:draftsChanged", draftsHandler);
      window.removeEventListener("portal:flowsChanged", flowsHandler);
      window.removeEventListener("portal:templatesChanged", templatesHandler);
    };
  }, [effectiveSession, refreshActiveProject, refreshDraftsSummary, session]);

  useEffect(() => {
    if (!effectiveSession?.token) return;
    if (view === "start") return;
    if (hasWebhookSecret) return;
    const hasActive = Array.isArray(flows) && flows.some((f) => String(f?.status || "") === "InProgress");
    if (!hasActive) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refreshFlows(effectiveSession).catch(() => null);
      refreshActiveProject().catch(() => null);
    }, 60000);
    return () => clearInterval(id);
  }, [effectiveSession, flows, hasWebhookSecret, refreshActiveProject, refreshFlows, view]);

  const loadTemplatesForSession = async (activeSession) => {
    if (!activeSession?.token) return [];
    setBusy(true);
    try {
      const data = await listTemplates({ token: activeSession.token });
      const items = Array.isArray(data?.templates) ? data.templates : [];
      setTemplates(items);
      return items;
    } catch {
      setTemplates([]);
      return [];
    } finally {
      setBusy(false);
    }
  };

  const actions = useMemo(
    () => ({
      navigate(next) {
        if (next === "requests") {
          setRequestsFilter("all");
          setRequestsScope("all");
        }
        setView(next);
      },
      openProjects(opts = {}) {
        setView("projects");
        if (opts?.create) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("portal:projectsCreate"));
          }, 0);
        }
      },
      openRequests(filter = "all", scope = "all") {
        setRequestsFilter(String(filter || "all"));
        setRequestsScope(String(scope || "all"));
        setView("requests");
      },
      openProject(id) {
        setProjectId(String(id || "").trim());
        setView("project");
      },

      async onStartDemo({ requesterName }) {
        setBusy(true);
        setStartError("");
        try {
          const started = await startDemo({ requesterName });
          const requesterSession = makeSession(started.requesterToken, started.requester);
          const recipSession = started.recipient?.id && started.recipientToken
            ? makeSession(started.recipientToken, started.recipient)
            : null;
          setSession(requesterSession);
          setRecipientSession(recipSession);
          setDemoSessionId(started.sessionId);
          setActiveRole("requester");
          setView("dashboard");
          toast.success("Demo started.");
          // Kick off initial data load for the requester.
          // refreshActiveProject reads session from closure — let the session-change effect handle it.
          await Promise.all([
            refreshFlows(requesterSession).catch(() => null),
            refreshDraftsSummary(requesterSession).catch(() => null)
          ]);
        } catch (error) {
          const message = error?.message || "Failed to start demo";
          setStartError(message);
          toast.error(message);
        } finally {
          setBusy(false);
        }
      },

      async onLogout() {
        await endDemo().catch(() => null);
        setSession(null);
        setRecipientSession(null);
        setDemoSessionId(null);
        setActiveRole("requester");
        setTemplates([]);
        setFlows([]);
        setActiveRoomId("");
        setActiveProject(null);
        setDraftsPdfCount(0);
        setDraftsLoaded(false);
        setView("start");
      },

      switchToRequester() {
        if (activeRole === "requester") return;
        setActiveRole("requester");
        setTemplates([]);
        setFlows([]);
        setActiveRoomId("");
        setActiveProject(null);
        setDraftsLoaded(false);
        setView("dashboard");
        // Reload data for requester — effects gate on effectiveSession which won't
        // change if view was already "dashboard", so we kick off the load explicitly.
        refreshFlows(session).catch(() => null);
        refreshActiveProject().catch(() => null);
        refreshDraftsSummary(session).catch(() => null);
      },

      switchToRecipient() {
        if (activeRole === "recipient" || !recipientSession) return;
        setActiveRole("recipient");
        setTemplates([]);
        setFlows([]);
        setActiveRoomId("");
        setActiveProject(null);
        setDraftsLoaded(false);
        setView("dashboard");
        // Reload data for recipient explicitly — same reason as switchToRequester above.
        refreshFlows(recipientSession).catch(() => null);
        refreshActiveProject().catch(() => null);
        refreshDraftsSummary(session).catch(() => null);
      },

      async startFlow(templateFileId, pid, recipientEmails, kind, recipientLevels, dueDate) {
        if (!session?.token) return;
        if (!templateFileId) return;
        setBusy(true);
        try {
          const result = await createFlowFromTemplate({
            token: session.token,
            templateFileId,
            projectId: pid,
            recipientEmails,
            recipientLevels,
            dueDate,
            kind
          });
          await refreshFlows(session);
          window.dispatchEvent(new CustomEvent("portal:flowsChanged"));
          window.dispatchEvent(new CustomEvent("portal:projectChanged"));
          toast("Request created\nOpen Requests to track it.", "success");
          return result;
        } catch (e) {
          const msg = e?.message || "Failed to start request";
          toast(`Request creation failed\n${msg}`, "error");
          return null;
        } finally {
          setBusy(false);
        }
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeRole, recipientSession, refreshActiveProject, refreshDraftsSummary, refreshFlows, session]
  );

  useEffect(() => {
    if (!effectiveSession?.token) return;
    if ((view === "dashboard" || view === "requests") && flows.length === 0) {
      refreshFlows(effectiveSession).catch(() => null);
    }
    if ((view === "dashboard" || view === "drafts") && !draftsLoaded) {
      refreshDraftsSummary(session).catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSession, view]);

  useEffect(() => {
    if (!session?.token) return;
    setTemplates([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId, session?.token]);

  useEffect(() => {
    if (!effectiveSession?.token) return;
    if (!String(activeRoomId || "").trim()) return;
    if (view !== "dashboard" && view !== "requests" && view !== "bulk" && view !== "bulkLinks") return;
    if (templates.length > 0) return;
    loadTemplatesForSession(effectiveSession).catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId, effectiveSession?.token, view]);

  useEffect(() => {
    if (!effectiveSession?.token) return;
    if (view !== "dashboard" && view !== "requests") return;
    const intervalMs = 15000;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refreshFlows(effectiveSession).catch(() => null);
    };
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") tick();
    };
    const timer = setInterval(tick, intervalMs);
    window.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      window.removeEventListener("visibilitychange", onVis);
    };
  }, [effectiveSession, refreshFlows, view]);

  // Role switcher shown in app shell when both roles are provisioned.
  const roleSwitcher =
    demoSessionId && recipientSession
      ? {
          activeRole,
          onSelectRequester: actions.switchToRequester,
          onSelectRecipient: actions.switchToRecipient,
          disabledRecipient: !recipientSession?.token
        }
      : null;

  if (booting) {
    return (
      <div className="app-shell auth-shell">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-shell">
        <ErrorBoundary>
          <StartDemo
            busy={busy}
            error={startError}
            onStart={actions.onStartDemo}
            branding={branding}
          />
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <ErrorBoundary>
        <AppLayout
          session={effectiveSession}
          branding={branding}
          active={view}
          onNavigate={actions.navigate}
          onOpenProject={actions.openProject}
          onLogout={actions.onLogout}
          roleSwitcher={roleSwitcher ? <DemoRoleSwitch {...roleSwitcher} /> : null}
        >
          {view === "dashboard" && (
            <Dashboard
              session={effectiveSession}
              busy={busy}
              flows={flows}
              flowsRefreshing={flowsRefreshing}
              flowsUpdatedAt={flowsUpdatedAt}
              activeRoomId={activeRoomId}
              activeProject={activeProject}
              projectsCount={Array.isArray(sidebarProjects) ? sidebarProjects.length : 0}
              projects={Array.isArray(sidebarProjects) ? sidebarProjects : []}
              templates={templates}
              draftsPdfCount={draftsPdfCount}
              onRefresh={async () => {
                await Promise.all([
                  refreshFlows(effectiveSession).catch(() => null),
                  refreshActiveProject().catch(() => null),
                  refreshDraftsSummary(effectiveSession).catch(() => null)
                ]);
              }}
              onStartFlow={actions.startFlow}
              onOpenDrafts={() => actions.navigate("drafts")}
              onOpenProjects={(opts) => actions.openProjects(opts)}
              onOpenRequests={actions.openRequests}
              onOpenProject={actions.openProject}
            />
          )}
          {view === "documents" && (
            <Documents
              session={effectiveSession}
              busy={busy}
              projects={Array.isArray(sidebarProjects) ? sidebarProjects : []}
              onOpenRequests={() => actions.openRequests("all", "all")}
              onOpenProjects={(opts) => actions.openProjects(opts)}
              onOpenTemplates={() => actions.navigate("drafts")}
            />
          )}
          {view === "requests" && (
            <Requests
              session={effectiveSession}
              busy={busy}
              flows={flows}
              flowsRefreshing={flowsRefreshing}
              flowsUpdatedAt={flowsUpdatedAt}
              onRefreshFlows={() => refreshFlows(effectiveSession)}
              activeRoomId={activeRoomId}
              activeProject={activeProject}
              projects={Array.isArray(sidebarProjects) ? sidebarProjects : []}
              templates={templates}
              initialFilter={requestsFilter}
              initialScope={requestsScope}
              onBack={() => actions.navigate("dashboard")}
              onStartFlow={actions.startFlow}
              onOpenDrafts={() => actions.navigate("drafts")}
              onOpenProjects={(opts) => actions.openProjects(opts)}
            />
          )}
          {view === "sendDrafts" && (
            <SendDrafts
              session={effectiveSession}
              busy={busy}
              onOpenRequests={() => actions.openRequests("all", "all")}
              onOpenBulkSend={() => actions.navigate("bulk")}
              onOpenBulkLinks={() => actions.navigate("bulkLinks")}
            />
          )}
          {view === "bulk" && (
            <BulkSend
              session={effectiveSession}
              busy={busy}
              activeRoomId={activeRoomId}
              activeProject={activeProject}
              templates={templates}
              onStartFlow={actions.startFlow}
              onOpenRequests={() => actions.openRequests("all", "all")}
            />
          )}
          {view === "bulkLinks" && (
            <BulkLinks
              session={effectiveSession}
              busy={busy}
              activeRoomId={activeRoomId}
              activeProject={activeProject}
              templates={templates}
              onOpenRequests={() => actions.openRequests("all", "all")}
            />
          )}
          {view === "contacts" && (
            <Contacts
              session={effectiveSession}
              busy={busy}
              projects={Array.isArray(sidebarProjects) ? sidebarProjects : []}
              activeProject={activeProject}
              onOpenBulk={() => actions.navigate("bulk")}
            />
          )}
          {view === "projects" && (
            <Projects
              session={effectiveSession}
              busy={busy}
              onOpenProject={actions.openProject}
              onOpenDrafts={() => actions.navigate("drafts")}
            />
          )}
          {view === "drafts" && (
            <Drafts
              session={effectiveSession}
              busy={busy}
              onOpenProject={actions.openProject}
              onOpenProjects={(opts) => actions.openProjects(opts)}
              onOpenSettings={() => actions.navigate("settings")}
            />
          )}
          {view === "project" && (
            <Project
              session={effectiveSession}
              busy={busy}
              projectId={projectId}
              onBack={() => actions.navigate("projects")}
              onStartFlow={actions.startFlow}
              onOpenDrafts={() => actions.navigate("drafts")}
            />
          )}
          {view === "library" && <Library session={effectiveSession} busy={busy} />}
          {view === "settings" && (
            <Settings session={effectiveSession} busy={busy} onOpenDrafts={() => actions.navigate("drafts")} />
          )}
        </AppLayout>
      </ErrorBoundary>
    </div>
  );
}
