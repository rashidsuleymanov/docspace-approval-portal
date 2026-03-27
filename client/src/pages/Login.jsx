import { useMemo, useState } from "react";

function normalize(value) {
  return String(value || "").trim();
}

export default function Login({ branding, busy, error, onLogin, onRegister, onOpenSettings }) {
  const [mode, setMode] = useState("login");
  const [localError, setLocalError] = useState("");

  const portalName = String(branding?.portalName || "").trim() || "Requests Center";
  const portalLogoUrl = String(branding?.portalLogoUrl || "").trim();

  const canRegister = typeof onRegister === "function";

  const registerDisabledReason = useMemo(() => {
    if (!canRegister) return "Registration is disabled.";
    return "";
  }, [canRegister]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError("");
    const form = new FormData(event.currentTarget);

    if (mode === "register") {
      const firstName = normalize(form.get("firstName"));
      const lastName = normalize(form.get("lastName"));
      const email = normalize(form.get("email"));
      const password = normalize(form.get("password"));
      const password2 = normalize(form.get("password2"));
      if (!email) { setLocalError("Email is required."); return; }
      if (!password) { setLocalError("Password is required."); return; }
      if (password !== password2) { setLocalError("Passwords do not match."); return; }
      await onRegister?.({ firstName, lastName, email, password });
      return;
    }

    const email = normalize(form.get("email"));
    const password = normalize(form.get("password"));
    if (!email || !password) {
      setLocalError("Email and password are required.");
      return;
    }
    await onLogin({ email, password });
  };

  const displayError = error || localError;

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

        <h1>{mode === "register" ? "Create account" : "Sign in"}</h1>

        {displayError && <div className="error-banner">{displayError}</div>}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <>
              <label>
                First name
                <input name="firstName" autoComplete="given-name" disabled={busy} />
              </label>
              <label>
                Last name
                <input name="lastName" autoComplete="family-name" disabled={busy} />
              </label>
            </>
          )}

          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              disabled={busy}
            />
          </label>

          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder="Enter your password"
              required
              disabled={busy}
            />
          </label>

          {mode === "register" && (
            <label>
              Confirm password
              <input
                name="password2"
                type="password"
                autoComplete="new-password"
                placeholder="Repeat password"
                required
                disabled={busy}
              />
            </label>
          )}

          <button
            type="submit"
            className="primary"
            disabled={busy || (mode === "register" && !canRegister)}
            title={mode === "register" && registerDisabledReason ? registerDisabledReason : undefined}
          >
            {busy ? "Loading..." : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="auth-switch">
          {mode === "login" ? (
            <button
              type="button"
              className="link"
              onClick={() => { setLocalError(""); setMode("register"); }}
              disabled={busy || !canRegister}
            >
              Create account
            </button>
          ) : (
            <button
              type="button"
              className="link"
              onClick={() => { setLocalError(""); setMode("login"); }}
              disabled={busy}
            >
              Back to Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
