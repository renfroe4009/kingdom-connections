import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { parseApiError } from '../../../utils/apiError.js';

export default function PortalLearning() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/portal/lms/courses')
      .then((r) => setRows(r.data || []))
      .catch((e) => setError(parseApiError(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h3 className="fw-bolder mb-1">My Learning</h3>
      <p className="text-muted">Courses you've been enrolled in.</p>

      {error && <div className="alert alert-danger">{error}</div>}
      {!error && !loading && rows.length === 0 && (
        <div className="card"><div className="card-body"><div className="empty-state">
          Nothing here yet — once a course is released to a group you're part of, it'll show up here.
        </div></div></div>
      )}

      <div className="row g-3">
        {rows.map((c) => (
          <div className="col-12 col-md-6 col-lg-4" key={c.id}>
            <Link to={`/portal/learning/${c.slug}`} className="card h-100 text-decoration-none text-reset">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <h5 className="fw-bold mb-0">{c.title}</h5>
                  {c.percent === 100 && (
                    <span className="badge bg-success-subtle text-success flex-shrink-0 ms-2">
                      <iconify-icon icon="solar:medal-ribbon-star-bold-duotone" class="me-1"></iconify-icon>Complete
                    </span>
                  )}
                </div>
                {c.subtitle && <div className="text-muted small mb-2">{c.subtitle}</div>}
                {c.cohortName && <div className="small text-muted mb-2">{c.cohortName}</div>}
                <div className="progress" style={{ height: 8 }}>
                  <div className="progress-bar" role="progressbar" style={{ width: `${c.percent}%` }} aria-valuenow={c.percent} aria-valuemin="0" aria-valuemax="100"></div>
                </div>
                <div className="small text-muted mt-1">{c.completedCount} of {c.lessonCount} lessons complete</div>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
