export default function StepsCard({ title, subtitle, steps = [] }) {
  const items = Array.isArray(steps) ? steps.filter(Boolean) : [];
  return (
    <section className="card steps-card">
      <div className="steps-card-header">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
      </div>
      <div className="steps">
        {items.map((s, idx) => (
          <div key={`${idx}-${s?.title || "step"}`} className="step">
            <div className="step-num" aria-hidden="true">{idx + 1}</div>
            <div className="step-body">
              <strong>{s?.title || "Step"}</strong>
              {s?.description ? <span className="muted step-desc">{s.description}</span> : null}
            </div>
            {s?.actionLabel && typeof s?.onAction === "function" ? (
              <button
                type="button"
                className={`step-action${s?.actionTone === "primary" ? " primary" : ""}`}
                onClick={s.onAction}
                disabled={Boolean(s.disabled)}
              >
                {s.actionLabel}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
