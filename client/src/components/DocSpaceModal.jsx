import { useEffect, useMemo, useRef, useState } from "react";

export default function DocSpaceModal({ open, onClose, title = "Document", url }) {
  const iframeRef = useRef(null);
  const timerRef = useRef(null);
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);

  const signInUrl = useMemo(() => {
    const raw = String(url || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw).origin;
    } catch {
      return "";
    }
  }, [url]);

  useEffect(() => {
    if (!iframeRef.current) return;
    if (!open || !url) {
      iframeRef.current.src = "about:blank";
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      setBlocked(false);
      setChecking(false);
      return;
    }
    setBlocked(false);
    setChecking(true);
    iframeRef.current.src = url;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setBlocked(true);
      setChecking(false);
    }, 2500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [open, url]);

  const onFrameLoad = () => {
    if (!open || !url) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setChecking(false);
    setBlocked(false);

    const frame = iframeRef.current;
    if (!frame) return;

    try {
      const href = String(frame.contentWindow?.location?.href || "").trim();
      if (!href) return;
      if (href === "about:blank" || href.startsWith("chrome-error://") || href.startsWith("edge-error://")) {
        setBlocked(true);
      }
    } catch {
      // Cross-origin loads are expected and treated as OK.
    }
  };

  return (
    <div className={`editor-modal${open ? "" : " is-hidden"}`} role="dialog" aria-modal="true" aria-hidden={!open}>
      <div className="editor-shell">
        <div className="editor-header">
          <strong className="editor-title">{title}</strong>
          <div className="editor-actions">
            {url ? (
              <a className="btn" href={url} target="_blank" rel="noreferrer">
                Open in new tab
              </a>
            ) : null}
            <button className="editor-close" type="button" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
        </div>
        <div className="editor-frame">
          <iframe
            ref={iframeRef}
            title={title}
            className="docspace-embed"
            src="about:blank"
            frameBorder="0"
            allow="clipboard-read; clipboard-write; fullscreen"
            onLoad={onFrameLoad}
          />
          {open && blocked ? (
            <div className="docspace-overlay" role="note" aria-label="Sign-in required">
              <div className="docspace-overlay-card">
                <strong className="docspace-overlay-title">Sign in to continue</strong>
                <p className="muted docspace-overlay-desc">
                  If you aren't signed in in this browser, the embedded editor may not open. Sign in in a new tab, then reload this document.
                </p>
                <div className="docspace-overlay-actions">
                  {signInUrl ? (
                    <button type="button" className="primary" onClick={() => window.open(signInUrl, "_blank", "noopener,noreferrer")}>
                      Open sign-in page
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      const frame = iframeRef.current;
                      if (!frame) return;
                      const next = String(url || "");
                      setBlocked(false);
                      setChecking(true);
                      if (timerRef.current) clearTimeout(timerRef.current);
                      timerRef.current = null;
                      frame.src = "about:blank";
                      setTimeout(() => {
                        frame.src = next;
                        timerRef.current = setTimeout(() => {
                          setBlocked(true);
                          setChecking(false);
                        }, 2500);
                      }, 0);
                    }}
                    disabled={!url}
                  >
                    Reload
                  </button>
                  <button type="button" className="subtle" onClick={() => setBlocked(false)}>
                    Continue anyway
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
