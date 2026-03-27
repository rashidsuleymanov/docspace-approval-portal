const CARD_ACCENTS = {
  "In progress": "#f59e0b",
  "Completed":   "#10b981",
  "Total":       "#6366f1",
  "Projects":    "#3b82f6",
  "Templates":   "#8b5cf6",
};

export default function StatCard({ title, value, meta, onClick, className = "" }) {
  const clickable = typeof onClick === "function";
  const accent = CARD_ACCENTS[title];
  return (
    <div
      className={`stat-card${clickable ? " is-clickable" : ""}${className ? ` ${className}` : ""}`}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); }
          : undefined
      }
      style={accent ? { "--stat-accent": accent } : undefined}
    >
      <span className="stat-label">{title}</span>
      <strong className="stat-value">{value}</strong>
      {meta ? <span className="muted stat-meta">{meta}</span> : null}
    </div>
  );
}
