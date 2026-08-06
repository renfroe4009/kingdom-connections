import { Link, useLocation } from 'react-router-dom';

export default function NotFound() {
  const { pathname } = useLocation();

  return (
    <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '60vh' }}>
      <div style={{ fontSize: 72, fontWeight: 800, color: '#dee2e6', lineHeight: 1 }}>404</div>
      <h4 className="mt-2 mb-1">Page not found</h4>
      <p className="text-muted mb-3">
        <code>{pathname}</code> doesn&apos;t exist.
      </p>
      <Link className="btn btn-primary" to="/admin/dashboard">Go to Dashboard</Link>
    </div>
  );
}
