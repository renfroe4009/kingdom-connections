import { Fragment, useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

function blankCohort() {
  return { name: '', description: '', startsOn: '', endsOn: '' };
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

// Inline panel for one cohort's membership + released courses — expanded in
// place under its row rather than a separate page, since both lists are
// short and the common workflow is "create cohort, then immediately enroll
// a few people and release a course or two" in one sitting.
function CohortManagePanel({ cohort, courses, onChanged }) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [members, setMembers] = useState([]);
  const [releases, setReleases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState([]);
  const [courseToRelease, setCourseToRelease] = useState('');
  const [availableFrom, setAvailableFrom] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [{ data: m }, { data: r }] = await Promise.all([
        api.get(`/lms/cohorts/${cohort.id}/members`),
        api.get(`/lms/cohorts/${cohort.id}/courses`),
      ]);
      setMembers(m);
      setReleases(r);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [cohort.id]);

  async function searchContacts(q) {
    setContactSearch(q);
    if (!q.trim()) { setContactResults([]); return; }
    const { data: res } = await api.get('/contacts', { params: { q, pageSize: 10 } });
    setContactResults(res?.rows || []);
  }

  async function addMember(contact) {
    try {
      await api.post(`/lms/cohorts/${cohort.id}/members`, { contactId: contact.id });
      setContactSearch(''); setContactResults([]);
      load(); onChanged();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function removeMember(contact) {
    if (!(await confirm(`Remove ${contact.first_name} ${contact.last_name} from this cohort?`, { danger: true }))) return;
    try {
      await api.delete(`/lms/cohorts/${cohort.id}/members/${contact.id}`);
      load(); onChanged();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function releaseCourse() {
    if (!courseToRelease) return;
    try {
      await api.post(`/lms/cohorts/${cohort.id}/courses`, {
        courseId: courseToRelease,
        availableFrom: availableFrom ? new Date(availableFrom).toISOString() : null,
      });
      setCourseToRelease(''); setAvailableFrom('');
      load(); onChanged();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function withdrawCourse(courseId) {
    if (!(await confirm('Withdraw this course from the cohort? Members already in it keep their progress.', { danger: true }))) return;
    try {
      await api.delete(`/lms/cohorts/${cohort.id}/courses/${courseId}`);
      load(); onChanged();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  const releasedIds = new Set(releases.map((r) => r.courseId));
  const availableCourses = courses.filter((c) => !releasedIds.has(c.id));

  return (
    <tr>
      <td colSpan="5" className="bg-light-subtle p-3">
        {confirmDialog}
        {loading ? (
          <div className="text-muted small">Loading…</div>
        ) : (
          <div className="row g-3">
            <div className="col-12 col-lg-6">
              <h6 className="mb-2">Members ({members.length})</h6>
              <input
                type="text"
                className="form-control form-control-sm mb-2"
                placeholder="Search contacts by name, email, or phone…"
                value={contactSearch}
                onChange={(e) => searchContacts(e.target.value)}
              />
              {contactSearch && contactResults.length > 0 && (
                <ul className="list-group mb-2" style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {contactResults.map((c) => {
                    const already = members.some((m) => m.id === c.id);
                    return (
                      <li key={c.id} className="list-group-item d-flex align-items-center justify-content-between py-1 px-2">
                        <span className="small">{c.first_name} {c.last_name} <span className="text-muted">{c.email || ''}</span></span>
                        {already ? (
                          <span className="badge bg-success-subtle text-success">Enrolled</span>
                        ) : (
                          <button className="btn btn-sm btn-primary" onClick={() => addMember(c)}>Add</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <ul className="list-group" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {members.map((m) => (
                  <li key={m.id} className="list-group-item d-flex align-items-center justify-content-between py-1 px-2">
                    <span className="small">{m.first_name} {m.last_name} <span className="text-muted">{m.email || ''}</span></span>
                    <button className="btn btn-sm btn-light text-danger" onClick={() => removeMember(m)} aria-label={`Remove ${m.first_name}`}>
                      <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                    </button>
                  </li>
                ))}
                {members.length === 0 && <li className="list-group-item small text-muted py-2">No one enrolled yet.</li>}
              </ul>
            </div>

            <div className="col-12 col-lg-6">
              <h6 className="mb-2">Released Courses ({releases.length})</h6>
              <div className="d-flex flex-column flex-sm-row gap-2 mb-2">
                <select className="form-select form-select-sm" value={courseToRelease} onChange={(e) => setCourseToRelease(e.target.value)}>
                  <option value="">Choose a course…</option>
                  {availableCourses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <input
                  type="date"
                  className="form-control form-control-sm"
                  style={{ maxWidth: 160 }}
                  value={availableFrom}
                  onChange={(e) => setAvailableFrom(e.target.value)}
                  title="Available from (optional — leave blank to open immediately)"
                />
                <button className="btn btn-sm btn-primary flex-shrink-0" disabled={!courseToRelease} onClick={releaseCourse}>Release</button>
              </div>
              <ul className="list-group" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {releases.map((r) => (
                  <li key={r.courseId} className="list-group-item d-flex align-items-center justify-content-between py-1 px-2">
                    <span className="small">
                      {r.title}
                      {r.availableFrom && <span className="text-muted"> · opens {fmtDate(r.availableFrom)}</span>}
                    </span>
                    <button className="btn btn-sm btn-light text-danger" onClick={() => withdrawCourse(r.courseId)} aria-label={`Withdraw ${r.title}`}>
                      <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                    </button>
                  </li>
                ))}
                {releases.length === 0 && <li className="list-group-item small text-muted py-2">No courses released yet.</li>}
              </ul>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

export default function LmsCohortsPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(blankCohort());
  const [formError, setFormError] = useState('');
  const [expanded, setExpanded] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [{ data: cohorts }, { data: allCourses }] = await Promise.all([
        api.get('/lms/cohorts'),
        api.get('/lms/courses'),
      ]);
      setRows(cohorts);
      setCourses(allCourses);
    } catch (e) {
      toast(parseApiError(e), 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openNew() { setForm(blankCohort()); setFormError(''); setShow(true); }

  async function save() {
    if (!form.name.trim()) { setFormError('A name is required.'); return; }
    try {
      const created = await api.post('/lms/cohorts', {
        name: form.name.trim(),
        description: form.description.trim() || null,
        startsOn: form.startsOn ? new Date(form.startsOn).toISOString() : null,
        endsOn: form.endsOn ? new Date(form.endsOn).toISOString() : null,
      });
      setShow(false);
      await load();
      setExpanded(created.data.id);
    } catch (e) {
      setFormError(parseApiError(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Cohorts"
        subtitle="Groups of people who move through courses together"
        actions={can('lms.write') && (
          <button className="btn btn-primary" onClick={openNew}>
            <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Cohort
          </button>
        )}
      />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Members</th>
                  <th>Courses</th>
                  <th>Dates</th>
                  <th style={{ width: 100 }} className="text-end">Manage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <Fragment key={c.id}>
                    <tr>
                      <td>
                        <div className="fw-semibold">{c.name}</div>
                        {c.description && <div className="text-muted small">{c.description}</div>}
                      </td>
                      <td>{c.memberCount}</td>
                      <td>{c.courseCount}</td>
                      <td className="small text-muted">{fmtDate(c.startsOn)} – {fmtDate(c.endsOn)}</td>
                      <td className="text-end">
                        <button
                          className="btn btn-sm btn-light"
                          onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                        >
                          <iconify-icon icon={expanded === c.id ? 'solar:alt-arrow-up-line-duotone' : 'solar:alt-arrow-down-line-duotone'}></iconify-icon>
                          <span className="ms-1 d-none d-sm-inline">Manage</span>
                        </button>
                      </td>
                    </tr>
                    {expanded === c.id && (
                      <CohortManagePanel cohort={c} courses={courses} onChanged={load} />
                    )}
                  </Fragment>
                ))}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan="5"><div className="empty-state">No cohorts yet — create one to start enrolling people.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal
        show={show}
        onClose={() => setShow(false)}
        title="New Cohort"
        size="md"
        footer={<>
          <button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </>}
      >
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-12">
            <label className="form-label">Name</label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Spring 2026 New Members" />
          </div>
          <div className="col-12">
            <label className="form-label">Description</label>
            <textarea className="form-control" rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="col-md-6">
            <label className="form-label">Starts</label>
            <input type="date" className="form-control" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} />
          </div>
          <div className="col-md-6">
            <label className="form-label">Ends</label>
            <input type="date" className="form-control" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
