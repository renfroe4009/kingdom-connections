import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../../api/client.js';
import { parseApiError } from '../../../utils/apiError.js';
import { renderLessonBody } from '../../../utils/renderLessonBody.js';
import { toast } from '../../../components/Toast.jsx';

function QuizSection({ lessonId }) {
  const [paper, setPaper] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    setResult(null);
    setAnswers({});
    api.get(`/portal/lms/lessons/${lessonId}/quiz`)
      .then((r) => setPaper(r.data))
      .catch((e) => setError(parseApiError(e)))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [lessonId]);

  async function submit() {
    if (paper.questions.some((q) => !answers[q.id])) {
      toast('Answer every question before submitting.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post(`/portal/lms/quizzes/${paper.id}/attempts`, { answers });
      setResult(data);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-muted small">Loading quiz…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!paper) return null;

  if (result) {
    const reviewByQuestion = new Map(result.review.map((r) => [r.questionId, r]));
    return (
      <div className="card mt-3">
        <div className="card-body">
          <div className={`alert ${result.passed ? 'alert-success' : 'alert-warning'} d-flex align-items-center gap-2`}>
            <iconify-icon icon={result.passed ? 'solar:check-circle-bold' : 'solar:danger-triangle-bold'} class="fs-4"></iconify-icon>
            <div>
              <strong>{result.passed ? 'Passed' : 'Not quite'}</strong> — scored {result.score}% (passing is {result.passingScore}%).
              {!result.passed && result.attemptsLeft !== null && ` ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left.`}
            </div>
          </div>
          {paper.questions.map((q) => {
            const r = reviewByQuestion.get(q.id);
            return (
              <div key={q.id} className="mb-3">
                <div className="fw-semibold mb-1">{q.prompt}</div>
                {q.options.map((o) => {
                  const isChosen = r?.chosenOptionId === o.id;
                  const isCorrect = r?.correctOptionId === o.id;
                  let cls = 'list-group-item';
                  if (isCorrect) cls += ' list-group-item-success';
                  else if (isChosen && !isCorrect) cls += ' list-group-item-danger';
                  return <div key={o.id} className={cls}>{o.label}</div>;
                })}
                {r?.explanation && <div className="small text-muted mt-1">{r.explanation}</div>}
              </div>
            );
          })}
          {!result.passed && (result.attemptsLeft === null || result.attemptsLeft > 0) && (
            <button className="btn btn-primary" onClick={load}>Try Again</button>
          )}
        </div>
      </div>
    );
  }

  const outOfAttempts = paper.attemptsLeft !== null && paper.attemptsLeft <= 0;

  return (
    <div className="card mt-3">
      <div className="card-body">
        <h5 className="fw-bold mb-1">{paper.title}</h5>
        {paper.instructions && <p className="text-muted small">{paper.instructions}</p>}
        <div className="small text-muted mb-3">
          Passing score {paper.passingScore}%
          {paper.attemptsLeft !== null && ` · ${paper.attemptsLeft} attempt${paper.attemptsLeft === 1 ? '' : 's'} left`}
          {paper.hasPassed && <span className="badge bg-success-subtle text-success ms-2">Already passed</span>}
        </div>

        {outOfAttempts ? (
          <div className="alert alert-secondary mb-0">You've used all your attempts at this quiz.</div>
        ) : (
          <>
            {paper.questions.map((q, qi) => (
              <div key={q.id} className="mb-3">
                <div className="fw-semibold mb-1">{qi + 1}. {q.prompt}</div>
                {q.options.map((o) => (
                  <div key={o.id} className="form-check">
                    <input
                      className="form-check-input" type="radio" name={`q-${q.id}`} id={`opt-${o.id}`}
                      checked={answers[q.id] === o.id}
                      onChange={() => setAnswers({ ...answers, [q.id]: o.id })}
                    />
                    <label className="form-check-label" htmlFor={`opt-${o.id}`}>{o.label}</label>
                  </div>
                ))}
              </div>
            ))}
            <button className="btn btn-primary" onClick={submit} disabled={submitting}>Submit</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function PortalLessonView() {
  const { courseSlug, lessonSlug } = useParams();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/portal/lms/courses/${courseSlug}/lessons/${lessonSlug}`)
      .then((r) => setLesson(r.data))
      .catch((e) => setError(parseApiError(e)))
      .finally(() => setLoading(false));
  }, [courseSlug, lessonSlug]);

  async function toggleComplete() {
    setBusy(true);
    try {
      if (lesson.progress?.status === 'completed') {
        await api.post(`/portal/lms/lessons/${lesson.id}/uncomplete`);
      } else {
        const { data } = await api.post(`/portal/lms/lessons/${lesson.id}/complete`);
        if (data.courseCompleted) toast('Course complete! 🎉', 'success');
      }
      const { data: fresh } = await api.get(`/portal/lms/courses/${courseSlug}/lessons/${lessonSlug}`);
      setLesson(fresh);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-muted">Loading…</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!lesson) return <div className="empty-state">Lesson not found.</div>;

  const isCompleted = lesson.progress?.status === 'completed';

  return (
    <div>
      <Link to={`/portal/learning/${courseSlug}`} className="btn btn-sm btn-light mb-3">← {lesson.courseTitle}</Link>

      <div className="small text-muted mb-1">{lesson.moduleTitle}</div>
      <h3 className="fw-bolder mb-3">{lesson.title}</h3>

      {lesson.body && (
        <div
          className="mb-3"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderLessonBody(lesson.body, lesson.bodyFormat) }}
        />
      )}

      {lesson.keyPoints.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h6 className="fw-bold mb-2">Key Points</h6>
            <ul className="mb-0">{lesson.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
          </div>
        </div>
      )}

      {lesson.reflectionQuestions.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h6 className="fw-bold mb-2">Reflect</h6>
            <ul className="mb-0">{lesson.reflectionQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
          </div>
        </div>
      )}

      {lesson.attachments.length > 0 && (
        <div className="card mb-3">
          <div className="card-body">
            <h6 className="fw-bold mb-2">Attachments</h6>
            <ul className="list-unstyled mb-0">
              {lesson.attachments.map((a) => (
                <li key={a.id}>
                  <a href={a.url} target="_blank" rel="noreferrer">
                    <iconify-icon icon="solar:paperclip-line-duotone" class="me-1"></iconify-icon>{a.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <button className={`btn ${isCompleted ? 'btn-outline-success' : 'btn-success'}`} onClick={toggleComplete} disabled={busy}>
          <iconify-icon icon={isCompleted ? 'solar:check-circle-bold' : 'solar:check-circle-line-duotone'} class="me-1"></iconify-icon>
          {isCompleted ? 'Completed' : 'Mark Complete'}
        </button>
        <div className="d-flex gap-2 ms-auto">
          {lesson.previousSlug && (
            <button className="btn btn-light" onClick={() => navigate(`/portal/learning/${courseSlug}/${lesson.previousSlug}`)}>← Previous</button>
          )}
          {lesson.nextSlug && (
            <button className="btn btn-light" onClick={() => navigate(`/portal/learning/${courseSlug}/${lesson.nextSlug}`)}>Next →</button>
          )}
        </div>
      </div>

      {lesson.hasQuiz && <QuizSection lessonId={lesson.id} />}
    </div>
  );
}
