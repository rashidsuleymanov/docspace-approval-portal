export default function Tabs({ items = [], value, onChange, ariaLabel = "Tabs", className = "" }) {
  const tabs = Array.isArray(items) ? items.filter(Boolean) : [];
  const extra = String(className || "").trim();
  return (
    <div className={`tabs${extra ? ` ${extra}` : ""}`} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => {
        const id = String(t.id || "");
        const active = id && String(value) === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            className={`tab${active ? " is-active" : ""}`}
            aria-selected={active}
            onClick={() => (typeof onChange === "function" ? onChange(id) : null)}
            disabled={Boolean(t.disabled)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
