export default function StatCard({ title, value, meta, onClick, className = "" }) {
  const clickable = typeof onClick === "function";
  return (
    <div
      className={`stat-card${clickable ? " is-clickable" : ""}${className ? ` ${className}` : ""}`}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
    >
      <p className="muted">{title}</p>
      <h3>{value}</h3>
      <span className="muted">{meta}</span>
    </div>
  );
}
