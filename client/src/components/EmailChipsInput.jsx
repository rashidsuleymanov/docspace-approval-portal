import { useEffect, useMemo, useRef, useState } from "react";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseEmails(value) {
  const raw = String(value || "");
  const parts = raw
    .split(/[\n,;]+/g)
    .map((s) => normalizeEmail(s))
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    if (!p) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function joinEmails(list) {
  const items = Array.isArray(list) ? list : [];
  return items.join("\n");
}

export default function EmailChipsInput({ value = "", onChange, placeholder = "Type an email and press Enter", disabled = false, ariaLabel }) {
  const externalTokens = useMemo(() => parseEmails(value), [value]);
  const [tokens, setTokens] = useState(externalTokens);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    setTokens(externalTokens);
  }, [externalTokens]);

  const sync = (nextTokens) => {
    setTokens(nextTokens);
    setHint("");
    if (typeof onChange === "function") onChange(joinEmails(nextTokens));
  };

  const commitDraft = () => {
    const raw = String(draft || "");
    if (!raw.trim()) return;
    const candidates = raw.split(/[\s,;]+/g).map((s) => normalizeEmail(s)).filter(Boolean);
    if (!candidates.length) return;

    const invalid = candidates.filter((c) => !isValidEmail(c));
    if (invalid.length) {
      setHint(`Invalid email: ${invalid[0]}`);
      return;
    }

    const next = tokens.slice();
    const seen = new Set(next);
    for (const c of candidates) {
      if (seen.has(c)) continue;
      seen.add(c);
      next.push(c);
    }
    setDraft("");
    sync(next);
    setTimeout(() => inputRef.current?.focus?.(), 0);
  };

  const remove = (email) => {
    const em = normalizeEmail(email);
    if (!em) return;
    const next = tokens.filter((t) => t !== em);
    sync(next);
    setTimeout(() => inputRef.current?.focus?.(), 0);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === "Tab" || e.key === "," || e.key === ";") {
      if (String(draft || "").trim()) {
        e.preventDefault();
        commitDraft();
      }
      return;
    }
    if (e.key === "Backspace" && !draft && tokens.length) {
      remove(tokens[tokens.length - 1]);
    }
  };

  const onPaste = (e) => {
    if (disabled) return;
    const text = e.clipboardData?.getData?.("text") || "";
    if (!text) return;
    const list = parseEmails(text);
    if (!list.length) return;
    e.preventDefault();
    const invalid = list.filter((c) => !isValidEmail(c));
    if (invalid.length) {
      setHint(`Invalid email: ${invalid[0]}`);
      return;
    }
    const next = tokens.slice();
    const seen = new Set(next);
    for (const c of list) {
      if (seen.has(c)) continue;
      seen.add(c);
      next.push(c);
    }
    setDraft("");
    sync(next);
  };

  return (
    <div className={`email-chips${disabled ? " is-disabled" : ""}`} aria-label={ariaLabel || "Email input"}>
      <div className="email-chips-wrap" onClick={() => inputRef.current?.focus?.()} role="group" aria-label={ariaLabel || "Emails"}>
        {tokens.map((email) => (
          <span key={email} className="email-chip" title={email}>
            <span className="email-chip-text">{email}</span>
            <button type="button" className="email-chip-remove" onClick={() => remove(email)} disabled={disabled} aria-label={`Remove ${email}`}>
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="email-chips-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commitDraft}
          onPaste={onPaste}
          placeholder={tokens.length ? "" : placeholder}
          disabled={disabled}
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      {hint ? <div className="muted email-chips-hint">{hint}</div> : null}
    </div>
  );
}


