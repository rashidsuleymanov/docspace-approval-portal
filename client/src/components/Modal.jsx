import { useEffect } from "react";

export default function Modal({ open, title, children, footer, onClose, size = "md" }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={() => onClose?.()}>
      <div className={`modal modal-${String(size || "md")}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <strong>{title || "Dialog"}</strong>
          </div>
          <button type="button" className="icon-button" onClick={() => onClose?.()} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
