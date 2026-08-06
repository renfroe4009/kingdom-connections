export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="d-flex flex-wrap align-items-center justify-content-between mb-3 gap-2">
      <div>
        <h4 className="mb-0 fw-bolder">{title}</h4>
        {subtitle && <p className="text-muted fs-3 mt-1 mb-0">{subtitle}</p>}
      </div>
      {actions && <div className="d-flex gap-2">{actions}</div>}
    </div>
  );
}
