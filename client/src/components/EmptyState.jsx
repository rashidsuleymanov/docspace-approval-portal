export default function EmptyState({ title, description, actions }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {description ? <p className="muted">{description}</p> : null}
      {actions ? <div className="empty-state-actions">{actions}</div> : null}
    </div>
  );
}

