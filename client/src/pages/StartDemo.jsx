import { useState } from "react";

export default function StartDemo({ busy, error, onStart, branding }) {
  const [requesterName, setRequesterName] = useState("");

  const submit = (event) => {
    event.preventDefault();
    onStart?.({ requesterName: requesterName.trim() || "Demo User" });
  };

  const portalName = branding?.portalName || "Requests Center";

  return (
    <div className="auth-layout auth-layout-centered">
      <div className="auth-card">
        <div className="auth-brand">
          {branding?.portalLogoUrl ? (
            <img src={branding.portalLogoUrl} alt={portalName} className="brand-logo" />
          ) : (
            <span className="brand-mark" />
          )}
          {portalName}
        </div>
        <h1>Start demo</h1>
        <p className="muted">
          This creates an anonymous demo workspace. All data is deleted automatically when the session ends.
        </p>
        <form className="auth-form" onSubmit={submit}>
          <label>
            Your name (optional)
            <input
              type="text"
              placeholder="Demo User"
              value={requesterName}
              onChange={(e) => setRequesterName(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Starting..." : "Start demo"}
          </button>
        </form>
        {error && <div className="error-banner">{error}</div>}
      </div>
    </div>
  );
}
