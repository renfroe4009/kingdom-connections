import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const KIND_ICON = {
  video: 'solar:videocamera-record-line-duotone',
  reading: 'solar:document-text-line-duotone',
  assignment: 'solar:checklist-minimalistic-line-duotone',
};

function linesToList(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
}
function listToLines(list) {
  return (list || []).join('\n');
}

function blankModule() { return { id: null, title: '', summary: '' }; }
function blankLesson(moduleId) {
  return {
    id: null, moduleId, title: '', summary: '', kind: 'reading', body: '', bodyFormat: 'markdown',
    keyPoints: '', reflectionQuestions: '', estimatedMinutes: '', isPublished: false,
  };
}
function blankQuiz(lessonId) {
  return {
    lessonId, title: '', instructions: '', passingScore: 80, maxAttempts: 3,
    questions: [{ prompt: '', explanation: '', options: [{ label: '', isCorrect: true }, { label: '', isCorrect: false }] }],
  };
}

export default function LmsCourseEditorPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [course, setCourse] = useState(null);
  const [loading, setLoading] = useState(true);

  const [moduleShow, setModuleShow] = useState(false);
  const [moduleForm, setModuleForm] = useState(blankModule());
  const [moduleError, setModuleError] = useState('');

  const [lessonShow, setLessonShow] = useState(false);
  const [lessonForm, setLessonForm] = useState(null);
  const [lessonError, setLessonError] = useState('');

  const [quizShow, setQuizShow] = useState(false);
  const [quizForm, setQuizForm] = useState(null);
  const [quizError, setQuizError] = useState('');
  const [quizLoading, setQuizLoading] = useState(false);

  const [mediaLesson, setMediaLesson] = useState(null);

  const canWrite = can('lms.write');

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/lms/courses/${id}`);
      setCourse(data);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [id]);

  /* ------------------------------------------------------------ modules */

  function openNewModule() { setModuleForm(blankModule()); setModuleError(''); setModuleShow(true); }
  function openEditModule(m) { setModuleForm({ id: m.id, title: m.title, summary: m.summary || '' }); setModuleError(''); setModuleShow(true); }

  async function saveModule() {
    if (!moduleForm.title.trim()) { setModuleError('A title is required.'); return; }
    try {
      if (moduleForm.id) {
        await api.put(`/lms/modules/${moduleForm.id}`, { title: moduleForm.title.trim(), summary: moduleForm.summary.trim() || null });
      } else {
        await api.post('/lms/modules', { courseId: id, title: moduleForm.title.trim(), summary: moduleForm.summary.trim() || null });
      }
      setModuleShow(false);
      load();
    } catch (e) {
      setModuleError(parseApiError(e));
    }
  }

  async function deleteModule(m) {
    if (!(await confirm(`Delete module "${m.title}"? This deletes its lessons too.`, { danger: true }))) return;
    try {
      await api.delete(`/lms/modules/${m.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  /* ------------------------------------------------------------ lessons */

  function openNewLesson(moduleId) { setLessonForm(blankLesson(moduleId)); setLessonError(''); setLessonShow(true); }
  function openEditLesson(l) {
    setLessonForm({
      id: l.id, moduleId: null, title: l.title, summary: l.summary || '', kind: l.kind,
      body: l.body || '', bodyFormat: l.bodyFormat || 'markdown',
      keyPoints: listToLines(l.keyPoints), reflectionQuestions: listToLines(l.reflectionQuestions),
      estimatedMinutes: l.estimatedMinutes ?? '', isPublished: !!l.isPublished,
    });
    setLessonError('');
    setLessonShow(true);
  }

  async function saveLesson() {
    if (!lessonForm.title.trim()) { setLessonError('A title is required.'); return; }
    const payload = {
      title: lessonForm.title.trim(),
      summary: lessonForm.summary.trim() || null,
      kind: lessonForm.kind,
      body: lessonForm.body || null,
      bodyFormat: lessonForm.bodyFormat,
      keyPoints: linesToList(lessonForm.keyPoints),
      reflectionQuestions: linesToList(lessonForm.reflectionQuestions),
      estimatedMinutes: lessonForm.estimatedMinutes ? Number(lessonForm.estimatedMinutes) : null,
    };
    try {
      if (lessonForm.id) {
        await api.put(`/lms/lessons/${lessonForm.id}`, { ...payload, isPublished: lessonForm.isPublished });
      } else {
        await api.post('/lms/lessons', { ...payload, moduleId: lessonForm.moduleId });
      }
      setLessonShow(false);
      load();
    } catch (e) {
      setLessonError(parseApiError(e));
    }
  }

  async function deleteLesson(l) {
    if (!(await confirm(`Delete lesson "${l.title}"?`, { danger: true }))) return;
    try {
      await api.delete(`/lms/lessons/${l.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  /* -------------------------------------------------------------- quiz */

  async function openQuiz(lesson) {
    setQuizError('');
    setQuizShow(true);
    setQuizLoading(true);
    try {
      const { data } = await api.get(`/lms/lessons/${lesson.id}/quiz`);
      setQuizForm(data ? {
        id: data.id, lessonId: lesson.id,
        title: data.title, instructions: data.instructions || '',
        passingScore: data.passingScore, maxAttempts: data.maxAttempts,
        questions: data.questions.map((q) => ({
          prompt: q.prompt, explanation: q.explanation || '',
          options: q.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
        })),
      } : blankQuiz(lesson.id));
    } catch (e) {
      toast(parseApiError(e), 'error');
      setQuizShow(false);
    } finally {
      setQuizLoading(false);
    }
  }

  function updateQuestion(qi, patch) {
    const questions = quizForm.questions.slice();
    questions[qi] = { ...questions[qi], ...patch };
    setQuizForm({ ...quizForm, questions });
  }
  function updateOption(qi, oi, patch) {
    const questions = quizForm.questions.slice();
    const options = questions[qi].options.slice();
    options[oi] = { ...options[oi], ...patch };
    questions[qi] = { ...questions[qi], options };
    setQuizForm({ ...quizForm, questions });
  }
  function setCorrectOption(qi, oi) {
    const questions = quizForm.questions.slice();
    questions[qi] = { ...questions[qi], options: questions[qi].options.map((o, i) => ({ ...o, isCorrect: i === oi })) };
    setQuizForm({ ...quizForm, questions });
  }
  function addOption(qi) {
    const questions = quizForm.questions.slice();
    questions[qi] = { ...questions[qi], options: [...questions[qi].options, { label: '', isCorrect: false }] };
    setQuizForm({ ...quizForm, questions });
  }
  function removeOption(qi, oi) {
    const questions = quizForm.questions.slice();
    const options = questions[qi].options.slice();
    options.splice(oi, 1);
    if (!options.some((o) => o.isCorrect) && options.length) options[0].isCorrect = true;
    questions[qi] = { ...questions[qi], options };
    setQuizForm({ ...quizForm, questions });
  }
  function addQuestion() {
    setQuizForm({ ...quizForm, questions: [...quizForm.questions, { prompt: '', explanation: '', options: [{ label: '', isCorrect: true }, { label: '', isCorrect: false }] }] });
  }
  function removeQuestion(qi) {
    const questions = quizForm.questions.slice();
    questions.splice(qi, 1);
    setQuizForm({ ...quizForm, questions });
  }

  async function saveQuiz() {
    if (!quizForm.title.trim()) { setQuizError('A title is required.'); return; }
    for (const q of quizForm.questions) {
      if (!q.prompt.trim()) { setQuizError('Every question needs a prompt.'); return; }
      if (q.options.some((o) => !o.label.trim())) { setQuizError('Every option needs text.'); return; }
    }
    try {
      await api.put(`/lms/lessons/${quizForm.lessonId}/quiz`, {
        title: quizForm.title.trim(),
        instructions: quizForm.instructions.trim() || null,
        passingScore: Number(quizForm.passingScore),
        maxAttempts: Number(quizForm.maxAttempts),
        questions: quizForm.questions,
      });
      setQuizShow(false);
      load();
    } catch (e) {
      setQuizError(parseApiError(e));
    }
  }

  async function deleteCurrentQuiz() {
    if (!(await confirm('Delete this quiz?', { danger: true }))) return;
    try {
      await api.delete(`/lms/quizzes/${quizForm.id}`);
      setQuizShow(false);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  if (loading && !course) return <div className="text-muted p-3">Loading…</div>;
  if (!course) return <div className="empty-state">Course not found.</div>;

  return (
    <div>
      {confirmDialog}
      <PageHeader
        title={course.title}
        subtitle={`${course.lessonCount} published lesson${course.lessonCount === 1 ? '' : 's'} · ${course.percent}% an example learner would see complete`}
        actions={<>
          <Link to="/admin/lms/courses" className="btn btn-light">← Courses</Link>
          {canWrite && (
            <button className="btn btn-primary ms-2" onClick={openNewModule}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add Module
            </button>
          )}
        </>}
      />

      {course.modules.length === 0 && (
        <div className="empty-state">No modules yet — add one to start building the course outline.</div>
      )}

      {course.modules.map((m) => (
        <div className="card mb-3" key={m.id}>
          <div className="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">
            <div>
              <div className="fw-semibold">{m.title}</div>
              {m.summary && <div className="text-muted small">{m.summary}</div>}
            </div>
            {canWrite && (
              <div className="d-flex gap-1">
                <button className="btn btn-sm btn-light" onClick={() => openEditModule(m)} title="Edit module">
                  <iconify-icon icon="solar:pen-line-duotone"></iconify-icon>
                </button>
                <button className="btn btn-sm btn-light text-danger" onClick={() => deleteModule(m)} title="Delete module">
                  <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                </button>
              </div>
            )}
          </div>
          <ul className="list-group list-group-flush">
            {m.lessons.map((l) => (
              <li key={l.id} className="list-group-item d-flex align-items-center justify-content-between flex-wrap gap-2">
                <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                  <iconify-icon icon={KIND_ICON[l.kind] || KIND_ICON.reading} class="fs-5 text-muted flex-shrink-0"></iconify-icon>
                  <div style={{ minWidth: 0 }}>
                    <div className="fw-medium text-truncate">{l.title}</div>
                    <div className="small text-muted">
                      {l.isPublished
                        ? <span className="badge bg-success-subtle text-success me-1">Published</span>
                        : <span className="badge bg-secondary-subtle text-secondary me-1">Draft</span>}
                      {l.hasQuiz && <span className="badge bg-info-subtle text-info me-1">Quiz</span>}
                      {l.estimatedMinutes ? `${l.estimatedMinutes} min` : null}
                    </div>
                  </div>
                </div>
                {canWrite && (
                  <div className="d-flex gap-1 flex-shrink-0">
                    <button className="btn btn-sm btn-light" onClick={() => setMediaLesson(l)} title="Video & Attachments">
                      <iconify-icon icon="solar:videocamera-add-line-duotone"></iconify-icon>
                    </button>
                    <button className="btn btn-sm btn-light" onClick={() => openQuiz(l)} title="Quiz">
                      <iconify-icon icon="solar:clipboard-check-line-duotone"></iconify-icon>
                    </button>
                    <button className="btn btn-sm btn-light" onClick={() => openEditLesson(l)} title="Edit lesson">
                      <iconify-icon icon="solar:pen-line-duotone"></iconify-icon>
                    </button>
                    <button className="btn btn-sm btn-light text-danger" onClick={() => deleteLesson(l)} title="Delete lesson">
                      <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                    </button>
                  </div>
                )}
              </li>
            ))}
            {canWrite && (
              <li className="list-group-item">
                <button className="btn btn-sm btn-light" onClick={() => openNewLesson(m.id)}>
                  <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add Lesson
                </button>
              </li>
            )}
            {m.lessons.length === 0 && !canWrite && (
              <li className="list-group-item text-muted small">No lessons yet.</li>
            )}
          </ul>
        </div>
      ))}

      {/* --------------------------------------------------------- module modal */}
      <Modal
        show={moduleShow} onClose={() => setModuleShow(false)}
        title={moduleForm.id ? 'Edit Module' : 'New Module'} size="md"
        footer={<><button className="btn btn-light" onClick={() => setModuleShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveModule}>Save</button></>}
      >
        <FormErrorBanner error={moduleError} />
        <div className="row g-2">
          <div className="col-12">
            <label className="form-label">Title</label>
            <input className="form-control" value={moduleForm.title} onChange={(e) => setModuleForm({ ...moduleForm, title: e.target.value })} />
          </div>
          <div className="col-12">
            <label className="form-label">Summary</label>
            <textarea className="form-control" rows="2" value={moduleForm.summary} onChange={(e) => setModuleForm({ ...moduleForm, summary: e.target.value })} />
          </div>
        </div>
      </Modal>

      {/* --------------------------------------------------------- lesson modal */}
      {lessonForm && (
        <Modal
          show={lessonShow} onClose={() => setLessonShow(false)}
          title={lessonForm.id ? 'Edit Lesson' : 'New Lesson'} size="lg"
          footer={<><button className="btn btn-light" onClick={() => setLessonShow(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={saveLesson}>Save</button></>}
        >
          <FormErrorBanner error={lessonError} />
          <div className="row g-2">
            <div className="col-12">
              <label className="form-label">Title</label>
              <input className="form-control" value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} />
            </div>
            <div className="col-12">
              <label className="form-label">Summary</label>
              <textarea className="form-control" rows="2" value={lessonForm.summary} onChange={(e) => setLessonForm({ ...lessonForm, summary: e.target.value })} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Kind</label>
              <select className="form-select" value={lessonForm.kind} onChange={(e) => setLessonForm({ ...lessonForm, kind: e.target.value })}>
                <option value="reading">Reading</option>
                <option value="video">Video</option>
                <option value="assignment">Assignment</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">Estimated Minutes</label>
              <input type="number" min="1" className="form-control" value={lessonForm.estimatedMinutes} onChange={(e) => setLessonForm({ ...lessonForm, estimatedMinutes: e.target.value })} />
            </div>
            {lessonForm.kind === 'video' && lessonForm.id && (
              <div className="col-md-4 d-flex align-items-end">
                <div className="form-text mb-0">Upload the video file from the <strong>Media</strong> button on the lesson row, after saving.</div>
              </div>
            )}
            <div className="col-md-4">
              <label className="form-label">Body Format</label>
              <select className="form-select" value={lessonForm.bodyFormat} onChange={(e) => setLessonForm({ ...lessonForm, bodyFormat: e.target.value })}>
                <option value="markdown">Markdown</option>
                <option value="html">HTML</option>
              </select>
            </div>
            <div className="col-12">
              <label className="form-label">Body</label>
              <textarea className="form-control" rows="6" value={lessonForm.body} onChange={(e) => setLessonForm({ ...lessonForm, body: e.target.value })} />
            </div>
            <div className="col-md-6">
              <label className="form-label">Key Points <span className="text-muted small">(one per line)</span></label>
              <textarea className="form-control" rows="3" value={lessonForm.keyPoints} onChange={(e) => setLessonForm({ ...lessonForm, keyPoints: e.target.value })} />
            </div>
            <div className="col-md-6">
              <label className="form-label">Reflection Questions <span className="text-muted small">(one per line)</span></label>
              <textarea className="form-control" rows="3" value={lessonForm.reflectionQuestions} onChange={(e) => setLessonForm({ ...lessonForm, reflectionQuestions: e.target.value })} />
            </div>
            {lessonForm.id && (
              <div className="col-12">
                <div className="form-check form-switch">
                  <input className="form-check-input" type="checkbox" id="lesson_published" checked={lessonForm.isPublished}
                    onChange={(e) => setLessonForm({ ...lessonForm, isPublished: e.target.checked })} />
                  <label className="form-check-label" htmlFor="lesson_published">Published (visible to learners)</label>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ------------------------------------------------------------ quiz modal */}
      {quizForm && (
        <Modal
          show={quizShow} onClose={() => setQuizShow(false)}
          title="Quiz" size="xl"
          footer={<>
            {quizForm.id && (
              <button className="btn btn-outline-danger me-auto" onClick={deleteCurrentQuiz}>Delete Quiz</button>
            )}
            <button className="btn btn-light" onClick={() => setQuizShow(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveQuiz} disabled={quizLoading}>Save Quiz</button>
          </>}
        >
          <FormErrorBanner error={quizError} />
          {quizLoading ? <div className="text-muted small">Loading…</div> : (
            <div>
              <div className="row g-2 mb-3">
                <div className="col-12">
                  <label className="form-label">Title</label>
                  <input className="form-control" value={quizForm.title} onChange={(e) => setQuizForm({ ...quizForm, title: e.target.value })} />
                </div>
                <div className="col-12">
                  <label className="form-label">Instructions</label>
                  <textarea className="form-control" rows="2" value={quizForm.instructions} onChange={(e) => setQuizForm({ ...quizForm, instructions: e.target.value })} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Passing Score (%)</label>
                  <input type="number" min="1" max="100" className="form-control" value={quizForm.passingScore} onChange={(e) => setQuizForm({ ...quizForm, passingScore: e.target.value })} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Max Attempts <span className="text-muted small">(0 = unlimited)</span></label>
                  <input type="number" min="0" className="form-control" value={quizForm.maxAttempts} onChange={(e) => setQuizForm({ ...quizForm, maxAttempts: e.target.value })} />
                </div>
              </div>

              {quizForm.questions.map((q, qi) => (
                <div className="card mb-2" key={qi}>
                  <div className="card-body">
                    <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                      <label className="form-label mb-0 flex-grow-1">Question {qi + 1}</label>
                      {quizForm.questions.length > 1 && (
                        <button className="btn btn-sm btn-light text-danger" onClick={() => removeQuestion(qi)}>
                          <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                        </button>
                      )}
                    </div>
                    <input className="form-control mb-2" value={q.prompt} onChange={(e) => updateQuestion(qi, { prompt: e.target.value })} placeholder="Question prompt" />
                    <textarea className="form-control mb-2" rows="2" value={q.explanation} onChange={(e) => updateQuestion(qi, { explanation: e.target.value })} placeholder="Explanation shown after the attempt (optional)" />
                    <div className="small text-muted mb-1">Options — mark the one correct answer</div>
                    {q.options.map((o, oi) => (
                      <div key={oi} className="d-flex align-items-center gap-2 mb-1">
                        <input type="radio" name={`correct-${qi}`} checked={o.isCorrect} onChange={() => setCorrectOption(qi, oi)} />
                        <input className="form-control form-control-sm" value={o.label} onChange={(e) => updateOption(qi, oi, { label: e.target.value })} />
                        {q.options.length > 2 && (
                          <button className="btn btn-sm btn-light text-danger" onClick={() => removeOption(qi, oi)}>
                            <iconify-icon icon="solar:close-circle-line-duotone"></iconify-icon>
                          </button>
                        )}
                      </div>
                    ))}
                    <button className="btn btn-sm btn-light mt-1" onClick={() => addOption(qi)}>
                      <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add option
                    </button>
                  </div>
                </div>
              ))}
              <button className="btn btn-light" onClick={addQuestion}>
                <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add Question
              </button>
            </div>
          )}
        </Modal>
      )}

      {mediaLesson && (
        <LessonMediaModal lesson={mediaLesson} onClose={() => setMediaLesson(null)} onChanged={load} />
      )}
    </div>
  );
}

function blankAttachmentForm() { return { file: null, label: '' }; }

// Video upload + attachments for one lesson — its own modal rather than
// folded into the edit-lesson form, since a file upload is a different kind
// of operation (multipart, progress, immediate effect) than editing text
// fields that only take effect on Save.
function LessonMediaModal({ lesson, onClose, onChanged }) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [lessonDetail, setLessonDetail] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [videoFile, setVideoFile] = useState(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [attachForm, setAttachForm] = useState(blankAttachmentForm());
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [{ data: detail }, { data: atts }] = await Promise.all([
        api.get(`/lms/lessons/${lesson.id}`),
        api.get(`/lms/lessons/${lesson.id}/attachments`),
      ]);
      setLessonDetail(detail);
      setAttachments(atts);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [lesson.id]);

  async function uploadVideo() {
    if (!videoFile) return;
    setVideoBusy(true);
    setVideoError('');
    try {
      const form = new FormData();
      form.append('file', videoFile);
      await api.post(`/lms/lessons/${lesson.id}/video`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setVideoFile(null);
      await load();
      onChanged();
    } catch (e) {
      setVideoError(parseApiError(e));
    } finally {
      setVideoBusy(false);
    }
  }

  async function removeVideo() {
    if (!(await confirm('Remove this lesson\'s video?', { danger: true }))) return;
    setVideoBusy(true);
    try {
      await api.delete(`/lms/lessons/${lesson.id}/video`);
      await load();
      onChanged();
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setVideoBusy(false);
    }
  }

  async function uploadAttachment() {
    if (!attachForm.file) return;
    setAttachBusy(true);
    setAttachError('');
    try {
      const form = new FormData();
      form.append('file', attachForm.file);
      if (attachForm.label.trim()) form.append('label', attachForm.label.trim());
      await api.post(`/lms/lessons/${lesson.id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setAttachForm(blankAttachmentForm());
      await load();
      onChanged();
    } catch (e) {
      setAttachError(parseApiError(e));
    } finally {
      setAttachBusy(false);
    }
  }

  async function removeAttachment(att) {
    if (!(await confirm(`Remove "${att.label}"?`, { danger: true }))) return;
    try {
      await api.delete(`/lms/attachments/${att.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  return (
    <Modal show onClose={onClose} title={`Media — ${lesson.title}`} size="lg" footer={<button className="btn btn-light" onClick={onClose}>Close</button>}>
      {confirmDialog}
      {loading ? <div className="text-muted small">Loading…</div> : (
        <div>
          <h6 className="fw-bold mb-2">Video</h6>
          <FormErrorBanner error={videoError} />
          {lessonDetail?.videoRef ? (
            <div className="mb-3">
              <div className="d-flex align-items-center gap-2 mb-2">
                <span className={`badge ${lessonDetail.videoStatus === 'ready' ? 'bg-success-subtle text-success' : 'bg-secondary-subtle text-secondary'}`}>
                  {lessonDetail.videoStatus}
                </span>
                <button className="btn btn-sm btn-outline-danger" onClick={removeVideo} disabled={videoBusy}>Remove video</button>
              </div>
            </div>
          ) : (
            <div className="text-muted small mb-2">No video uploaded yet.</div>
          )}
          <div className="d-flex gap-2 mb-4">
            <input type="file" accept="video/mp4,video/webm" className="form-control" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
            <button className="btn btn-primary flex-shrink-0" disabled={!videoFile || videoBusy} onClick={uploadVideo}>
              {lessonDetail?.videoRef ? 'Replace' : 'Upload'}
            </button>
          </div>

          <h6 className="fw-bold mb-2">Attachments</h6>
          <FormErrorBanner error={attachError} />
          <ul className="list-group mb-3">
            {attachments.map((a) => (
              <li key={a.id} className="list-group-item d-flex align-items-center justify-content-between">
                <span className="small">{a.label} <span className="text-muted">({Math.round(a.sizeBytes / 1024)} KB)</span></span>
                <button className="btn btn-sm btn-light text-danger" onClick={() => removeAttachment(a)}>
                  <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                </button>
              </li>
            ))}
            {attachments.length === 0 && <li className="list-group-item small text-muted">No attachments yet.</li>}
          </ul>
          <div className="d-flex flex-column flex-sm-row gap-2">
            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="form-control" onChange={(e) => setAttachForm({ ...attachForm, file: e.target.files?.[0] || null })} />
            <input className="form-control" placeholder="Label (optional)" value={attachForm.label} onChange={(e) => setAttachForm({ ...attachForm, label: e.target.value })} style={{ maxWidth: 200 }} />
            <button className="btn btn-primary flex-shrink-0" disabled={!attachForm.file || attachBusy} onClick={uploadAttachment}>Add</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
