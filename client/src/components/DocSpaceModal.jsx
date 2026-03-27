import { useEffect, useRef, useState } from "react";
import { loadDocSpaceSdk, destroyHiddenEditor } from "../services/hiddenEditor.js";

const docspaceUrl = (import.meta.env.VITE_DOCSPACE_URL || "").replace(/\/+$/, "");
const SDK_FRAME_ID = "docspace-modal-sdk-frame";

export default function DocSpaceModal({ open, onClose, title = "Document", url, fileId, token }) {
  const iframeRef = useRef(null);
  const sdkInstanceRef = useRef(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [creds, setCreds] = useState(null);
  const [copied, setCopied] = useState("");
  // "init" | "authing" | "opening" | "ready" | "fallback" | "error"
  const [phase, setPhase] = useState("init");

  const useSdk = Boolean(fileId && docspaceUrl);

  // Fetch credentials once per open (for help panel display)
  useEffect(() => {
    if (!open) {
      setCreds(null);
      return;
    }
    fetch("/api/demo/credentials", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.email) setCreds(data); })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) {
      destroyHiddenEditor(sdkInstanceRef);
      setPhase("init");
      return;
    }
    if (!useSdk) return;

    let cancelled = false;
    destroyHiddenEditor(sdkInstanceRef);
    setPhase("init");

    const run = async () => {
      await loadDocSpaceSdk(docspaceUrl);
      if (cancelled) return;

      // Try to get credentials for authenticated (edit) flow
      let loginCreds = null;
      try {
        const res = await fetch("/api/demo/credentials", { credentials: "include" });
        if (res.ok) loginCreds = await res.json();
      } catch (e) {
        console.warn("[DocSpace] credentials fetch failed:", e?.message);
      }
      if (cancelled) return;

      if (loginCreds?.email && loginCreds?.password) {
        // ── Authenticated flow ────────────────────────────────────────────────
        // 1. initSystem creates an iframe at SDK_FRAME_ID (loads /old-sdk/system)
        // 2. We log in → DocSpace sets asc_auth_key cookie (HttpOnly, SameSite=Strict)
        // 3. We navigate the SAME iframe src to /doceditor?fileid=X
        // 4. Browser sends the cookie (same-origin navigation) → edit mode ✓
        setPhase("authing");
        console.log("[DocSpace] starting authenticated flow for", loginCreds.email);

        let editorOpened = false;
        const openEditor = () => {
          if (editorOpened || cancelled) return;
          editorOpened = true;
          setPhase("opening");

          // Navigate the existing iframe to the editor.
          // We reuse the same iframe element so the browser keeps the
          // asc_auth_key cookie it just set — same-origin navigation preserves it.
          //
          // After initSystem, the DocSpace SDK renames our div to
          // `${SDK_FRAME_ID}-container` and creates <iframe id="SDK_FRAME_ID">
          // inside it. So getElementById returns the IFRAME itself, not a div.
          const el = document.getElementById(SDK_FRAME_ID);
          const existingIframe =
            el?.tagName?.toLowerCase() === "iframe"
              ? el
              : el?.querySelector("iframe");
          if (existingIframe) {
            console.log("[DocSpace] navigating iframe to editor (cookie preserved)");
            existingIframe.src = `${docspaceUrl}/doceditor?fileid=${encodeURIComponent(String(fileId))}`;
            existingIframe.onload = () => {
              if (!cancelled) setPhase("ready");
            };
          } else {
            // Fallback: initEditor if the iframe element is gone
            console.warn("[DocSpace] iframe not found, falling back to initEditor");
            const inst = window.DocSpace?.SDK?.initEditor({
              src: docspaceUrl,
              id: String(fileId),
              frameId: SDK_FRAME_ID,
              width: "100%",
              height: "100%"
            });
            if (!cancelled) {
              sdkInstanceRef.current = inst;
              setPhase("ready");
            }
          }
        };

        const sysInstance = window.DocSpace.SDK.initSystem({
          src: docspaceUrl,
          frameId: SDK_FRAME_ID,
          width: "100%",
          height: "100%",
          events: {
            onAppReady: async () => {
              if (cancelled) return;
              try {
                const hs = await sysInstance.getHashSettings();
                const hash = await sysInstance.createHash(loginCreds.password, hs);
                console.log("[DocSpace] logging in...");
                await sysInstance.login(loginCreds.email, hash);
                console.log("[DocSpace] login() returned — waiting for onAuthSuccess");
                // Safety fallback: open editor after 4s if event never fires
                setTimeout(() => {
                  if (!editorOpened && !cancelled) {
                    console.warn("[DocSpace] onAuthSuccess timeout — opening editor anyway");
                    openEditor();
                  }
                }, 4000);
              } catch (e) {
                console.warn("[DocSpace] login error:", e?.message);
                if (!cancelled) fallbackToToken();
              }
            },
            onAuthSuccess: () => {
              console.log("[DocSpace] onAuthSuccess — opening editor");
              openEditor();
            },
            onSignIn: () => {
              console.log("[DocSpace] onSignIn — opening editor");
              openEditor();
            },
            onAppError: (e) => {
              console.warn("[DocSpace] system frame error:", e);
              if (!cancelled) fallbackToToken();
            }
          }
        });
        if (!cancelled) sdkInstanceRef.current = sysInstance;

      } else if (token) {
        // ── Fallback: requestToken (view-only) ────────────────────────────────
        fallbackToToken();
      } else {
        console.warn("[DocSpace] no credentials and no token");
        setPhase("error");
      }

      function fallbackToToken() {
        if (cancelled) return;
        console.log("[DocSpace] using requestToken (view-only fallback)");
        setPhase("fallback");
        destroyHiddenEditor(sdkInstanceRef);
        const inst = window.DocSpace?.SDK?.initEditor({
          src: docspaceUrl,
          id: String(fileId),
          frameId: SDK_FRAME_ID,
          requestToken: token,
          width: "100%",
          height: "100%"
        });
        if (!cancelled) sdkInstanceRef.current = inst;
      }
    };

    run().catch((e) => {
      console.warn("[DocSpace] SDK init failed:", e?.message);
      if (!cancelled) setPhase("error");
    });

    return () => {
      cancelled = true;
    };
  }, [open, fileId, token, useSdk, reloadNonce]);

  // Cleanup on unmount
  useEffect(() => {
    return () => destroyHiddenEditor(sdkInstanceRef);
  }, []);

  // Plain iframe mode (fallback when useSdk is false)
  useEffect(() => {
    if (useSdk) return;
    if (!iframeRef.current) return;
    if (!open || !url) {
      iframeRef.current.src = "about:blank";
      return;
    }
    const node = iframeRef.current;
    node.src = "about:blank";
    const timer = window.setTimeout(() => {
      if (!iframeRef.current) return;
      iframeRef.current.src = url;
    }, 40);
    return () => window.clearTimeout(timer);
  }, [open, url, useSdk, reloadNonce]);

  useEffect(() => {
    if (!open) {
      setHelpOpen(false);
      setCopied("");
    }
  }, [open]);

  const handleEditInDocSpace = () => {
    if (!fileId || !docspaceUrl) return;
    const editorUrl = `${docspaceUrl}/doceditor?fileid=${encodeURIComponent(String(fileId))}`;
    window.open(editorUrl, "_blank", "noopener,noreferrer");
  };

  const handleOpenNewTab = () => {
    const target =
      url ||
      (fileId && docspaceUrl
        ? `${docspaceUrl}/doceditor?fileid=${encodeURIComponent(String(fileId))}`
        : "");
    if (target) window.open(target, "_blank", "noopener,noreferrer");
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    });
  };

  const phaseLabel =
    phase === "authing" ? "Signing in…" :
    phase === "opening" ? "Opening editor…" :
    phase === "fallback" ? "View mode" :
    phase === "error" ? "Error" :
    null;

  return (
    <div
      className={`editor-modal${open ? "" : " is-hidden"}`}
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
    >
      <div className="editor-shell">
        <div className="editor-header">
          <strong className="editor-title">{title}</strong>
          <div className="editor-actions">
            {phaseLabel && (
              <span className="editor-phase-label">{phaseLabel}</span>
            )}
            <button
              className="editor-close"
              type="button"
              onClick={() => setHelpOpen((prev) => !prev)}
              aria-expanded={helpOpen}
            >
              Help
            </button>
            {fileId && (
              <button
                className="editor-close editor-edit-btn"
                type="button"
                onClick={handleEditInDocSpace}
                title="Open editor in new tab"
              >
                Edit in DocSpace
              </button>
            )}
            <button
              className="editor-close"
              type="button"
              onClick={handleOpenNewTab}
              disabled={!url && !fileId}
            >
              Open in new tab
            </button>
            <button
              className="editor-close"
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              Reload
            </button>
            <button className="editor-close" type="button" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
        </div>
        <div className="editor-frame">
          {helpOpen && (
            <div className="editor-help" role="note">
              <strong>
                {phase === "fallback"
                  ? "Document is in read-only mode."
                  : "Having trouble editing?"}
              </strong>
              <p className="muted">
                {phase === "fallback"
                  ? "Click Edit in DocSpace to open the editor in a new tab."
                  : "If the editor shows a login page, use Edit in DocSpace to open it in a new tab."}
              </p>
              {creds && (
                <div className="editor-creds">
                  <p className="muted">DocSpace credentials:</p>
                  <div className="editor-cred-row">
                    <span className="editor-cred-label">Email</span>
                    <code className="editor-cred-value">{creds.email}</code>
                    <button
                      className="editor-cred-copy"
                      type="button"
                      onClick={() => copyToClipboard(creds.email, "email")}
                    >
                      {copied === "email" ? "✓" : "Copy"}
                    </button>
                  </div>
                  {creds.password && (
                    <div className="editor-cred-row">
                      <span className="editor-cred-label">Password</span>
                      <code className="editor-cred-value">{creds.password}</code>
                      <button
                        className="editor-cred-copy"
                        type="button"
                        onClick={() => copyToClipboard(creds.password, "pwd")}
                      >
                        {copied === "pwd" ? "✓" : "Copy"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <div
            id={SDK_FRAME_ID}
            style={{ width: "100%", height: "100%", display: useSdk ? "block" : "none" }}
          />
          <iframe
            ref={iframeRef}
            title={title}
            className="docspace-embed"
            src="about:blank"
            allow="clipboard-read; clipboard-write; fullscreen"
            style={{ border: "none", display: useSdk ? "none" : "block" }}
          />
        </div>
      </div>
    </div>
  );
}
