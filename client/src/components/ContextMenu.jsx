import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default function ContextMenu({ open, anchorEl, onClose, ariaLabel = "Menu", children, offset = 8 } = {}) {
  const menuRef = useRef(null);
  const [style, setStyle] = useState({ top: 0, left: 0, visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const menuEl = menuRef.current;
    if (!menuEl) return;

    const menuRect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;

    const preferredLeft = anchorRect.right - menuRect.width;
    const preferredTop = anchorRect.bottom + offset;

    const left = clamp(preferredLeft, 8, Math.max(8, vw - menuRect.width - 8));
    const top = clamp(preferredTop, 8, Math.max(8, vh - menuRect.height - 8));

    setStyle({ top, left, visibility: "visible" });
  }, [open, anchorEl, offset, children]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    const onPointerDown = (e) => {
      const menuEl = menuRef.current;
      if (!menuEl) return;
      if (menuEl.contains(e.target)) return;
      if (anchorEl && anchorEl.contains(e.target)) return;
      onClose?.();
    };
    const onReposition = () => {
      setStyle((s) => ({ ...s, visibility: "hidden" }));
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, onClose, anchorEl]);

  if (!open) return null;

  return createPortal(
    <div ref={menuRef} className="context-menu" role="menu" aria-label={ariaLabel} style={style}>
      {children}
    </div>,
    document.body
  );
}

