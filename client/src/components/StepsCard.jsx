export default function StepsCard({ title, subtitle, steps = [] }) {
  const items = Array.isArray(steps) ? steps.filter(Boolean) : [];
  return (
    <section className="card steps-card">
      <div className="card-header">
        <h3>{title}</h3>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      <div className="steps">
        {items.map((s, idx) => (
          <div key={`${idx}-${s?.title || "step"}`} className="step">
            <div className="step-num" aria-hidden="true">
              {idx + 1}
            </div>
            <div className="step-body">
              <div className="step-title">
                <strong>{s?.title || "Step"}</strong>
                {s?.hint ? <span className="muted step-hint">{s.hint}</span> : null}
              </div>
              {s?.description ? <p className="muted step-desc">{s.description}</p> : null}
              {s?.actionLabel && typeof s?.onAction === "function" ? (
                <div className="row-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                  <button type="button" className={s?.actionTone === "primary" ? "primary" : ""} onClick={s.onAction} disabled={Boolean(s.disabled)}>
                    {s.actionLabel}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

