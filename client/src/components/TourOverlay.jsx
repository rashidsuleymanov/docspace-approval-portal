import { useEffect, useMemo, useRef, useState } from "react";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getRectFor(selector) {
  if (!selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return null;
  return { el, rect };
}

function computePopoverPosition({ targetRect, preferred = "right" }) {
  const padding = 12;
  const popoverWidth = 340;
  const popoverHeight = 160;
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 768;

  const options = [
    preferred,
    "right",
    "left",
    "bottom",
    "top"
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const fits = (pos) => {
    if (pos === "right") return targetRect.right + padding + popoverWidth <= vw - padding;
    if (pos === "left") return targetRect.left - padding - popoverWidth >= padding;
    if (pos === "bottom") return targetRect.bottom + padding + popoverHeight <= vh - padding;
    if (pos === "top") return targetRect.top - padding - popoverHeight >= padding;
    return false;
  };

  const placement = options.find(fits) || "bottom";

  let left = padding;
  let top = padding;

  if (placement === "right") {
    left = targetRect.right + padding;
    top = targetRect.top + targetRect.height / 2 - popoverHeight / 2;
  } else if (placement === "left") {
    left = targetRect.left - padding - popoverWidth;
    top = targetRect.top + targetRect.height / 2 - popoverHeight / 2;
  } else if (placement === "top") {
    left = targetRect.left + targetRect.width / 2 - popoverWidth / 2;
    top = targetRect.top - padding - popoverHeight;
  } else {
    left = targetRect.left + targetRect.width / 2 - popoverWidth / 2;
    top = targetRect.bottom + padding;
  }

  left = clamp(left, padding, vw - popoverWidth - padding);
  top = clamp(top, padding, vh - popoverHeight - padding);

  return { placement, left, top, width: popoverWidth };
}

export default function TourOverlay({
  open,
  steps,
  onClose,
  onBeforeStep
}) {
  const list = Array.isArray(steps) ? steps : [];
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState(null);
  const retryTimerRef = useRef(null);
  const retryCountRef = useRef(0);

  const step = list[index] || null;

  const canBack = index > 0;
  const canNext = index < list.length - 1;

  const close = () => onClose?.();

  useEffect(() => {
    if (!open) return;
    setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!step) return;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;
    if (typeof onBeforeStep === "function") onBeforeStep(step);
  }, [open, index]); // intentionally not depending on callbacks

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" && canNext) setIndex((v) => Math.min(v + 1, list.length - 1));
      if (e.key === "ArrowLeft" && canBack) setIndex((v) => Math.max(v - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canBack, canNext, list.length]);

  const recalc = () => {
    if (!open) return;
    const sel = String(step?.selector || "").trim();
    const found = sel ? getRectFor(sel) : null;

    if (found?.el) {
      try {
        found.el.scrollIntoView({ block: "center", inline: "nearest" });
      } catch {
        // ignore
      }
    }

    const rect = found?.rect || null;
    const popover = rect ? computePopoverPosition({ targetRect: rect, preferred: step?.placement || "right" }) : null;
    setLayout({
      targetRect: rect,
      popover,
      missing: !rect
    });
  };

  useEffect(() => {
    if (!open) return;
    if (!step) return;
    const maxRetries = typeof step?.maxRetries === "number" ? step.maxRetries : 22;
    const delayMs = typeof step?.retryDelayMs === "number" ? step.retryDelayMs : 120;

    const attempt = () => {
      if (!open) return;
      const sel = String(step?.selector || "").trim();
      const found = sel ? getRectFor(sel) : null;
      if (found?.rect) {
        recalc();
        return;
      }

      retryCountRef.current += 1;
      setLayout({ targetRect: null, popover: null, missing: true });
      if (retryCountRef.current >= maxRetries) return;
      retryTimerRef.current = setTimeout(attempt, delayMs);
    };

    attempt();

    const onResize = () => recalc();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index]);

  const spotlightStyle = useMemo(() => {
    const r = layout?.targetRect;
    if (!r) return null;
    const pad = 6;
    return {
      left: Math.max(0, r.left - pad),
      top: Math.max(0, r.top - pad),
      width: Math.min(window.innerWidth, r.width + pad * 2),
      height: Math.min(window.innerHeight, r.height + pad * 2)
    };
  }, [layout?.targetRect]);

  if (!open || !step) return null;

  const title = String(step.title || "").trim();
  const body = String(step.body || "").trim();
  const pop = layout?.popover || null;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true">
      <div className="tour-backdrop" onMouseDown={close} />

      {spotlightStyle ? <div className="tour-spotlight" style={spotlightStyle} aria-hidden="true" /> : null}

      <div
        className={`tour-popover${layout?.missing ? " is-missing" : ""}`}
        style={
          pop
            ? { left: pop.left, top: pop.top, width: pop.width }
            : { left: "50%", top: "20%", transform: "translateX(-50%)", width: 360 }
        }
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="tour-popover-head">
          <div className="tour-popover-title">
            <strong>{title || "Tip"}</strong>
            <span className="muted">
              {index + 1} / {list.length}
            </span>
          </div>
          <button type="button" className="icon-button" onClick={close} aria-label="Close tips">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {body ? <p className="tour-popover-body">{body}</p> : null}

        <div className="tour-popover-actions">
          <button type="button" className="btn subtle" onClick={close}>
            Skip
          </button>
          <div className="tour-popover-actions-right">
            <button type="button" className="btn" onClick={() => setIndex((v) => Math.max(0, v - 1))} disabled={!canBack}>
              Back
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (canNext) setIndex((v) => Math.min(v + 1, list.length - 1));
                else close();
              }}
            >
              {canNext ? "Next" : "Done"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
