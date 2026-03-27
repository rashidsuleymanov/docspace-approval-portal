export default function QuickActions({
  hasProject,
  projectTitle,
  onOpenProjects,
  onOpenTemplates,
  onNewRequest,
  onOpenCurrentProject
}) {
  const title = hasProject ? `Quick actions — ${projectTitle || "Current project"}` : "Quick actions";
  const subtitle = hasProject ? "Common actions for the current project." : "Start here.";

  const tiles = hasProject
    ? [
        {
          title: "New request",
          description: "Start a new approval request from a published form template.",
          tone: "primary",
          label: "New request",
          onClick: onNewRequest,
          disabled: !hasProject
        },
        {
          title: "Templates",
          description: "Create PDF forms and publish them to this project.",
          tone: "default",
          label: "Open templates",
          onClick: onOpenTemplates
        }
      ]
    : [
        {
          title: "Projects",
          description: "Choose an existing project or create a new one.",
          tone: "primary",
          label: "Open projects",
          onClick: onOpenProjects
        },
        {
          title: "Templates",
          description: "Create or upload PDF forms in My documents.",
          tone: "default",
          label: "Open templates",
          onClick: onOpenTemplates
        },
        {
          title: "New request",
          description: "Select a project first, then create a request from a template.",
          tone: "default",
          label: "Choose project",
          onClick: onOpenProjects
        }
      ];

  return (
    <section className="card compact">
      <div className="card-header compact">
        <div>
          <h3>{title}</h3>
          <p className="muted">{subtitle}</p>
        </div>
      </div>
      <div className="action-grid">
        {tiles.map((t) => (
          <div key={t.title} className={`action-tile${t.disabled ? " is-disabled" : ""}`}>
            <div className="action-tile-head">
              <strong className="truncate">{t.title}</strong>
            </div>
            <p className="muted action-tile-desc">{t.description}</p>
            <div className="row-actions" style={{ justifyContent: "flex-start", marginTop: 10 }}>
              <button
                type="button"
                className={t.tone === "primary" ? "primary" : ""}
                onClick={t.onClick}
                disabled={Boolean(t.disabled)}
              >
                {t.label}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
