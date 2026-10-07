import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../../api/client.js';
import { parseApiError } from '../../../utils/apiError.js';

const KIND_ICON = {
  video: 'solar:videocamera-record-line-duotone',
  reading: 'solar:document-text-line-duotone',
  assignment: 'solar:checklist-minimalistic-line-duotone',
};

export default function PortalCourseView() {
  const { courseSlug } = useParams();
  const [course, setCourse] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/portal/lms/courses/${courseSlug}`)
      .then((r) => setCourse(r.data))
      .catch((e) => setError(parseApiError(e)))
      .finally(() => setLoading(false));
  }, [courseSlug]);

  if (loading) return <div className="text-muted">Loading…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!course) return <div className="empty-state">Course not found.</div>;

  return (
    <div>
      <Link to="/portal/learning" className="btn btn-sm btn-light mb-3">← My Learning</Link>
      <h3 className="fw-bolder mb-1">{course.title}</h3>
      {course.subtitle && <p className="text-muted mb-2">{course.subtitle}</p>}
      {course.summary && <p className="mb-3">{course.summary}</p>}

      <div className="d-flex align-items-center gap-2 mb-3">
        <div className="progress flex-grow-1" style={{ height: 8, maxWidth: 300 }}>
          <div className="progress-bar" role="progressbar" style={{ width: `${course.percent}%` }} aria-valuenow={course.percent} aria-valuemin="0" aria-valuemax="100"></div>
        </div>
        <span className="small text-muted flex-shrink-0">{course.completedCount} of {course.lessonCount} complete</span>
      </div>

      {course.nextLessonSlug && (
        <Link to={`/portal/learning/${course.slug}/${course.nextLessonSlug}`} className="btn btn-primary mb-4">
          {course.completedCount === 0 ? 'Start Course' : 'Continue'}
        </Link>
      )}

      {course.modules.map((m) => (
        <div className="card mb-3" key={m.id}>
          <div className="card-header">
            <div className="fw-semibold">{m.title}</div>
            {m.summary && <div className="text-muted small">{m.summary}</div>}
          </div>
          <ul className="list-group list-group-flush">
            {m.lessons.map((l) => (
              <li key={l.id} className="list-group-item">
                <Link to={`/portal/learning/${course.slug}/${l.slug}`} className="d-flex align-items-center justify-content-between text-decoration-none text-reset">
                  <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                    <iconify-icon
                      icon={l.isCompleted ? 'solar:check-circle-bold' : (KIND_ICON[l.kind] || KIND_ICON.reading)}
                      class={`fs-5 flex-shrink-0 ${l.isCompleted ? 'text-success' : 'text-muted'}`}
                    ></iconify-icon>
                    <div className="text-truncate">{l.title}</div>
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-shrink-0 small text-muted">
                    {l.hasQuiz && <span className="badge bg-info-subtle text-info">Quiz</span>}
                    {l.estimatedMinutes ? `${l.estimatedMinutes} min` : null}
                  </div>
                </Link>
              </li>
            ))}
            {m.lessons.length === 0 && <li className="list-group-item text-muted small">No lessons yet.</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}
