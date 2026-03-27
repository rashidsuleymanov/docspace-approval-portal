import { useState } from "react";

export default function StartDemo({ busy, error, onStart, branding }) {
  const [requesterName, setRequesterName] = useState("Demo User");

  const portalName = String(branding?.portalName || "").trim() || "Requests Center";
  const portalLogoUrl = String(branding?.portalLogoUrl || "").trim();

  const submit = (event) => {
    event.preventDefault();
    onStart?.({ requesterName: requesterName.trim() || "Demo User" });
  };

  return (
    <div className="auth-layout auth-layout-centered">
      <div className="auth-card">
        <div className="auth-brand">
          {portalLogoUrl
            ? <img src={portalLogoUrl} alt={portalName} className="brand-logo" />
            : <span className="brand-mark" />
          }
          {portalName}
        </div>

        <h1>Try demo</h1>

        <form className="auth-form" onSubmit={submit}>
          <label>
            Your name
            <input
              type="text"
              placeholder="Enter your name"
              value={requesterName}
              onChange={(e) => setRequesterName(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Starting..." : "Continue"}
          </button>
        </form>

        {error && <div className="error-banner">{error}</div>}

        <p className="muted start-demo-hint">
          This is a demonstration stand.<br />
          No data is saved and will be deleted after the session ends.
        </p>
      </div>
    </div>
  );
}
