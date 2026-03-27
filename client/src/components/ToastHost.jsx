import { useEffect, useRef, useState } from "react";

export default function ToastHost() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const onToast = (e) => {
      const message = String(e?.detail?.message || "").trim();
      if (!message) return;
      const tone = String(e?.detail?.tone || "info").trim() || "info";
      const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      setToast({ id, message, tone });

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setToast(null), 3600);
    };

    window.addEventListener("portal:toast", onToast);
    return () => {
      window.removeEventListener("portal:toast", onToast);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;

  const [title, ...rest] = String(toast.message || "").split("\n");
  const details = rest.join("\n").trim();
  const icon = toast.tone === "success" ? "\u2713" : toast.tone === "error" ? "!" : "i";

  return (
    <div className="toast-host" role="status" aria-live="polite" key={toast.id}>
      <div className={`toast toast-${toast.tone}`}>
        <span className="toast-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="toast-body">
          <span className="toast-title">{title}</span>
          {details ? <span className="toast-details">{details}</span> : null}
        </span>
        <button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss notification">
          {"\u00D7"}
        </button>
      </div>
    </div>
  );
}
