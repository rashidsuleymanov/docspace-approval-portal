import { useMemo, useState } from "react";

function normalize(value) {
  return String(value || "").trim();
}

export default function Login({ branding, busy, error, onLogin, onRegister, onOpenSettings }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [localError, setLocalError] = useState("");

  const portalName = String(branding?.portalName || "").trim() || "Requests Center";
  const title = mode === "register" ? "Create account" : portalName;
  const subtitle = mode === "register" ? "Create an account." : "Sign in with your account.";

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
      if (!email) {
        setLocalError("Email is required.");
        return;
      }
      if (!password) {
        setLocalError("Password is required.");
        return;
      }
      if (password !== password2) {
        setLocalError("Passwords do not match.");
        return;
      }
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
    <div className="auth-shell">
      <div className="auth-card">
        <h1 style={{ margin: "0 0 6px" }}>{title}</h1>
        <p className="muted" style={{ margin: 0 }}>{subtitle}</p>

        {displayError ? (
          <p className="error" style={{ marginTop: 10 }}>
            {displayError}
          </p>
        ) : null}

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <>
              <label>
                <span>First name</span>
                <input name="firstName" autoComplete="given-name" disabled={busy} />
              </label>
              <label>
                <span>Last name</span>
                <input name="lastName" autoComplete="family-name" disabled={busy} />
              </label>
            </>
          ) : null}

          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required disabled={busy} />
          </label>

          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              disabled={busy}
            />
          </label>

          {mode === "register" ? (
            <label>
              <span>Confirm password</span>
              <input name="password2" type="password" autoComplete="new-password" required disabled={busy} />
            </label>
          ) : null}

          <button
            type="submit"
            className="primary"
            disabled={busy || (mode === "register" && !canRegister)}
            title={mode === "register" && registerDisabledReason ? registerDisabledReason : undefined}
          >
            {busy ? "Loading..." : mode === "register" ? "Create account" : "Sign in"}
          </button>

          <div className="auth-switch">
            {mode === "login" ? (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setLocalError("");
                  setMode("register");
                }}
                disabled={busy || !canRegister}
              >
                Create account
              </button>
            ) : (
              <button
                type="button"
                className="link"
                onClick={() => {
                  setLocalError("");
                  setMode("login");
                }}
                disabled={busy}
              >
                Back to Sign in
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
