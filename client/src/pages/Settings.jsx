import { useEffect, useState } from "react";
import EmptyState from "../components/EmptyState.jsx";
import StatusPill from "../components/StatusPill.jsx";
import Tabs from "../components/Tabs.jsx";
import { createRequiredRoom, getSettingsConfig, listRequiredRooms, testSettingsConfig, updateSettingsConfig } from "../services/portalApi.js";

function normalize(value) {
  return String(value || "").trim();
}

function normalizeBaseUrl(value) {
  const raw = normalize(value);
  if (!raw) return "";
  const trimmed = raw.replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return trimmed;
  } catch {
    return "";
  }
}

export default function Settings({ busy, onOpenDrafts }) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState("connection");

  useEffect(() => {
    const handler = (e) => {
      const detail = e?.detail && typeof e.detail === "object" ? e.detail : null;
      if (!detail || detail.page !== "settings") return;
      const next = String(detail.tab || "").trim();
      if (!next) return;
      setTab(next);
      try {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch {
        // ignore
      }
    };
    window.addEventListener("portal:tour", handler);
    return () => window.removeEventListener("portal:tour", handler);
  }, []);

  const [connLoading, setConnLoading] = useState(false);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [requiredRooms, setRequiredRooms] = useState(null);
  const [clearToken, setClearToken] = useState(false);
  const [clearWebhookSecret, setClearWebhookSecret] = useState(false);
  const [conn, setConn] = useState({
    baseUrl: "",
    hasAuthToken: false,
    authTokenMasked: "",
    rawAuthTokenInput: "",
    hasWebhookSecret: false,
    webhookSecretMasked: "",
    rawWebhookSecretInput: "",
    portalName: "",
    portalTagline: "",
    portalLogoUrl: "",
    portalAccent: ""
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setConnLoading(true);
      setRoomsLoading(true);
      setError("");
      setNotice("");
      try {
        const [data, rooms] = await Promise.all([getSettingsConfig(), listRequiredRooms().catch(() => null)]);
        if (cancelled) return;
        setConn({
          baseUrl: data?.baseUrl || "",
          hasAuthToken: Boolean(data?.hasAuthToken),
          authTokenMasked: data?.authTokenMasked || "",
          rawAuthTokenInput: "",
          hasWebhookSecret: Boolean(data?.hasWebhookSecret),
          webhookSecretMasked: data?.webhookSecretMasked || "",
          rawWebhookSecretInput: "",
          portalName: data?.portalName || "",
          portalTagline: data?.portalTagline || "",
          portalLogoUrl: data?.portalLogoUrl || "",
          portalAccent: data?.portalAccent || ""
        });
        setRequiredRooms(rooms);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Failed to load settings");
      } finally {
        if (!cancelled) setConnLoading(false);
        if (!cancelled) setRoomsLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshRequiredRooms = async () => {
    setRoomsLoading(true);
    setError("");
    setNotice("");
    try {
      const rooms = await listRequiredRooms();
      setRequiredRooms(rooms);
    } catch (e) {
      setError(e?.message || "Failed to load required rooms");
    } finally {
      setRoomsLoading(false);
    }
  };

  const createRoom = async (key) => {
    setRoomsLoading(true);
    setError("");
    setNotice("");
    try {
      await createRequiredRoom(key);
      const rooms = await listRequiredRooms().catch(() => null);
      if (rooms) setRequiredRooms(rooms);
      setNotice("Room created.");
    } catch (e) {
      setError(e?.message || "Failed to create room");
    } finally {
      setRoomsLoading(false);
    }
  };

  const saveConnection = async () => {
    const baseUrl = normalizeBaseUrl(conn.baseUrl);
    if (!baseUrl) {
      setError("Base URL is required (example: https://your-workspace.example.com).");
      return;
    }

    setConnLoading(true);
    setError("");
    setNotice("");
    try {
      const patch = { baseUrl };
      const token = String(conn.rawAuthTokenInput || "").trim();
      if (token) patch.rawAuthToken = token;
      if (!token && clearToken) {
        patch.rawAuthToken = "";
        patch.clearAuthToken = true;
      }

      const hookSecret = String(conn.rawWebhookSecretInput || "").trim();
      if (hookSecret) patch.rawWebhookSecret = hookSecret;
      if (!hookSecret && clearWebhookSecret) {
        patch.rawWebhookSecret = "";
        patch.clearWebhookSecret = true;
      }

      patch.portalName = String(conn.portalName || "").trim();
      patch.portalTagline = String(conn.portalTagline || "").trim();
      patch.portalLogoUrl = String(conn.portalLogoUrl || "").trim();
      patch.portalAccent = String(conn.portalAccent || "").trim();

      const data = await updateSettingsConfig(patch);
      setConn((s) => ({
        ...s,
        baseUrl: data?.baseUrl || s.baseUrl,
        hasAuthToken: Boolean(data?.hasAuthToken),
        authTokenMasked: data?.authTokenMasked || "",
        rawAuthTokenInput: "",
        hasWebhookSecret: Boolean(data?.hasWebhookSecret),
        webhookSecretMasked: data?.webhookSecretMasked || "",
        rawWebhookSecretInput: "",
        portalName: data?.portalName || s.portalName,
        portalTagline: data?.portalTagline || s.portalTagline,
        portalLogoUrl: data?.portalLogoUrl || s.portalLogoUrl,
        portalAccent: data?.portalAccent || s.portalAccent
      }));
      setClearToken(false);
      setClearWebhookSecret(false);
      setNotice("Saved.");
      window.dispatchEvent(new CustomEvent("portal:brandingChanged"));
    } catch (e) {
      setError(e?.message || "Save failed");
    } finally {
      setConnLoading(false);
    }
  };

  const testConnection = async () => {
    const baseUrl = normalizeBaseUrl(conn.baseUrl);
    if (!baseUrl) {
      setError("Base URL is required before testing the connection.");
      return;
    }

    setConnLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await testSettingsConfig();
      const label = data?.profile?.email || data?.profile?.displayName || data?.profile?.id || "OK";
      setNotice(`Connection OK (${label}).`);
    } catch (e) {
      setError(e?.message || "Test failed");
    } finally {
      setConnLoading(false);
    }
  };

  const canSave = Boolean(normalizeBaseUrl(conn.baseUrl));

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <h2>Settings</h2>
          <p className="muted">Connect this portal to your workspace.</p>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <div className="settings-tabs">
        <Tabs
          value={tab}
          onChange={(v) => setTab(String(v || "connection"))}
          ariaLabel="Settings sections"
          items={[
            { id: "connection", label: "Connection" },
            { id: "branding", label: "Branding" },
            { id: "rooms", label: "Rooms" }
          ]}
        />
      </div>

      <div className="page-scroll">
        {tab === "connection" ? (
          <section className="card" data-tour="settings:connection">
            <div className="card-header">
              <h3>Connection</h3>
              <p className="muted">Saved on the server. The token is never returned to the browser.</p>
            </div>

        <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
          <label>
            <span>Workspace base URL</span>
            <input
              type="url"
              value={conn.baseUrl}
              onChange={(e) => setConn((s) => ({ ...s, baseUrl: e.target.value }))}
              placeholder="https://your-docspace.example.com"
              disabled={busy || connLoading}
              required
            />
          </label>

          <label>
            <span>Admin token (Authorization)</span>
            <input
              type="password"
              value={conn.rawAuthTokenInput}
              onChange={(e) => setConn((s) => ({ ...s, rawAuthTokenInput: e.target.value }))}
              placeholder={conn.hasAuthToken ? `Saved (${conn.authTokenMasked || "hidden"})` : "Paste token here"}
              disabled={busy || connLoading}
            />
          </label>

          {conn.hasAuthToken ? (
            <label className="inline-check">
              <input
                type="checkbox"
                checked={Boolean(clearToken)}
                onChange={(e) => setClearToken(e.target.checked)}
                disabled={busy || connLoading}
              />
              <span>Clear saved token</span>
            </label>
          ) : null}

          <label>
            <span>Webhook secret (incoming)</span>
            <input
              type="password"
              value={conn.rawWebhookSecretInput}
              onChange={(e) => setConn((s) => ({ ...s, rawWebhookSecretInput: e.target.value }))}
              placeholder={conn.hasWebhookSecret ? `Saved (${conn.webhookSecretMasked || "hidden"})` : "Optional, but recommended"}
              disabled={busy || connLoading}
            />
          </label>

          <p className="muted" style={{ margin: "-4px 0 0", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <StatusPill tone={conn.hasWebhookSecret ? "green" : "gray"}>
              {conn.hasWebhookSecret ? "Webhooks enabled" : "Webhooks not configured"}
            </StatusPill>
            <span>
              If you don't configure webhooks, the portal still works — request statuses update on Refresh / page load.
            </span>
          </p>

          {conn.hasWebhookSecret ? (
            <label className="inline-check">
              <input
                type="checkbox"
                checked={Boolean(clearWebhookSecret)}
                onChange={(e) => setClearWebhookSecret(e.target.checked)}
                disabled={busy || connLoading}
              />
              <span>Clear webhook secret</span>
            </label>
          ) : null}

          <div className="empty-state" style={{ marginTop: 6 }}>
            <strong>Webhook endpoint</strong>
            <p className="muted">
              Use <strong>/api/webhooks/docspace</strong> as the payload URL. Configure the same secret here and in your workspace to verify requests.
            </p>
          </div>

          <div className="row-actions">
            <button type="button" onClick={testConnection} disabled={busy || connLoading || !canSave}>
              Test
            </button>
            <button type="button" className="primary" onClick={saveConnection} disabled={busy || connLoading || !canSave}>
              {connLoading ? "Saving..." : "Save"}
            </button>
              </div>
            </form>
          </section>
        ) : null}

        {tab === "branding" ? (
          <section className="card">
            <div className="card-header">
              <h3>Branding</h3>
              <p className="muted">Customize the portal name and accent color.</p>
        </div>

        <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
          <label>
            <span>Portal name</span>
            <input value={conn.portalName} onChange={(e) => setConn((s) => ({ ...s, portalName: e.target.value }))} disabled={busy || connLoading} />
          </label>
          <label>
            <span>Tagline</span>
            <input
              value={conn.portalTagline}
              onChange={(e) => setConn((s) => ({ ...s, portalTagline: e.target.value }))}
              disabled={busy || connLoading}
              placeholder="Sign, approve, and track."
            />
          </label>
          <label>
            <span>Logo URL (optional)</span>
            <input
              value={conn.portalLogoUrl}
              onChange={(e) => setConn((s) => ({ ...s, portalLogoUrl: e.target.value }))}
              disabled={busy || connLoading}
              placeholder="https://.../logo.png"
            />
          </label>
          <label>
            <span>Accent color (hex, optional)</span>
            <input
              value={conn.portalAccent}
              onChange={(e) => setConn((s) => ({ ...s, portalAccent: e.target.value }))}
              disabled={busy || connLoading}
              placeholder="#2563eb"
            />
          </label>
          <p className="muted" style={{ margin: 0 }}>
            Changes apply after refresh.
          </p>
          <div className="row-actions" style={{ justifyContent: "flex-start" }}>
            <button type="button" className="primary" onClick={saveConnection} disabled={busy || connLoading}>
              {connLoading ? "Saving..." : "Save branding"}
            </button>
          </div>
        </form>
          </section>
        ) : null}

        {tab === "rooms" ? (
          <section className="card">
        <div className="card-header compact">
          <div>
            <h3>Required rooms</h3>
            <p className="muted">The portal expects these shared rooms to exist in the workspace (by ID or by title).</p>
          </div>
          <div className="card-header-actions">
            <button type="button" onClick={refreshRequiredRooms} disabled={busy || roomsLoading}>
              Refresh
            </button>
          </div>
        </div>

        {!requiredRooms && roomsLoading ? <p className="muted">Loading...</p> : null}

        {requiredRooms?.canCreate === false ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            <strong>Admin token required</strong>
            <p className="muted">
              Add an <strong>Admin token</strong> in Connection settings to create missing rooms from the portal.
            </p>
          </div>
        ) : null}

        {Array.isArray(requiredRooms?.rooms) ? (
          <div className="list">
            {requiredRooms.rooms.map((r) => {
              const found = Boolean(r?.found && r?.room?.id);
              const webUrl = r?.room?.webUrl || null;
              const canCreate = Boolean(requiredRooms?.canCreate);
              return (
                <div className="list-row" key={r.key}>
                  <div className="list-main" style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{r.label}</strong>
                      <StatusPill tone={found ? "green" : "yellow"}>{found ? "Ready" : "Missing"}</StatusPill>
                      <StatusPill tone="gray" className="truncate" title={`Expected: ${r.expectedTitle}`}>
                        Expected: {r.expectedTitle}
                      </StatusPill>
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {r.description}
                      {found ? (
                        <span>
                          {" "}
                          — Found: <strong>{r.room.title || r.room.id}</strong>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="list-actions">
                    {webUrl ? (
                      <a className="link" href={webUrl} target="_blank" rel="noreferrer">Open room</a>
                    ) : null}
                    {!found ? (
                      <button type="button" className="primary" onClick={() => createRoom(r.key)} disabled={busy || roomsLoading || !canCreate}>
                        Create
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
