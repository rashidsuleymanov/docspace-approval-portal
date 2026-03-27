export default function StatusPill({ tone = "gray", children, ...rest }) {
  return (
    <span className={`pill pill-${tone}${rest.className ? ` ${rest.className}` : ""}`} {...rest}>
      {children}
    </span>
  );
}
