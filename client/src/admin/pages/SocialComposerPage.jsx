import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

// Platform display metadata
const PLATFORMS = [
  { value: 'facebook',  label: 'Facebook',  icon: 'logos:facebook', color: '#1877F2' },
  { value: 'instagram', label: 'Instagram', icon: 'skill-icons:instagram', color: '#E1306C' },
  { value: 'linkedin',  label: 'LinkedIn',  icon: 'logos:linkedin-icon', color: '#0A66C2' },
];

function toLocalInput(s) {
  if (!s) return '';
  const d = typeof s === 'string' ? new Date(s) : s;
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

const MAX_CHARS = 2200; // common Instagram limit — we show a Twitter-style counter

const emptyForm = {
  platform:     'facebook',
  account_id:   '',
  content:      '',
  media_urls:   ['', '', '', ''],
  schedule:     false,
  scheduled_at: '',
};

export default function SocialComposerPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  const [form, setForm]       = useState(emptyForm);
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  useEffect(() => {
    api.get('/social/accounts').then(({ data }) => setAccounts(data || [])).catch(() => {});
    // Pre-fill platform from query param (e.g. ?platform=instagram)
    const p = searchParams.get('platform');
    if (p && PLATFORMS.find((x) => x.value === p)) {
      setForm((f) => ({ ...f, platform: p }));
    }
  }, [searchParams]);

  // Accounts filtered to the selected platform
  const platformAccounts = accounts.filter((a) => a.platform === form.platform && a.is_active);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setMediaUrl(idx, value) {
    setForm((f) => {
      const next = [...f.media_urls];
      next[idx] = value;
      return { ...f, media_urls: next };
    });
  }

  function validate() {
    if (!form.content.trim()) return 'Post content is required.';
    if (!form.platform) return 'Select a platform.';
    if (form.schedule && !form.scheduled_at) return 'Pick a date and time to schedule.';
    const mediaFilled = form.media_urls.filter(Boolean);
    if (mediaFilled.some((u) => { try { new URL(u); return false; } catch { return true; } })) {
      return 'One or more media URLs are invalid. Must be full URLs (https://…).';
    }
    return null;
  }

  async function submit(action) {
    setErr('');
    const v = validate();
    if (v) { setErr(v); return; }
    setBusy(true);
    try {
      const payload = {
        platform:     form.platform,
        account_id:   form.account_id ? Number(form.account_id) : null,
        content:      form.content.trim(),
        media_urls:   form.media_urls.filter(Boolean),
        scheduled_at: form.schedule && form.scheduled_at
          ? new Date(form.scheduled_at).toISOString()
          : null,
      };
      const { data } = await api.post('/social/posts', payload);

      if (action === 'publish') {
        await api.post(`/social/posts/${data.id}/publish`);
      }

      nav('/admin/marketing/post-queue');
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Save failed');
    } finally { setBusy(false); }
  }

  const charCount = form.content.length;
  const charOver  = charCount > MAX_CHARS;

  // Preview card
  const previewMedia = form.media_urls.filter(Boolean);
  const selectedPlat = PLATFORMS.find((p) => p.value === form.platform) || PLATFORMS[0];

  return (
    <div>
      <PageHeader
        title="Compose Post"
        subtitle="Create a new social media post — save as draft, schedule, or publish now"
        actions={(
          <Link to="/admin/marketing/post-queue" className="btn btn-light">
            <iconify-icon icon="solar:arrow-left-line-duotone" class="me-1"></iconify-icon>
            Post Queue
          </Link>
        )}
      />

      {err && <div className="alert alert-danger">{err}</div>}

      <div className="row g-3">
        {/* ---- Composer (left) ---- */}
        <div className="col-lg-7">

          {/* Platform + Account */}
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="card-title mb-3">Platform</h6>
              <div className="d-flex gap-2 flex-wrap mb-3">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`btn btn-${form.platform === p.value ? 'primary' : 'light'} d-flex align-items-center gap-1`}
                    onClick={() => { setField('platform', p.value); setField('account_id', ''); }}
                  >
                    <iconify-icon icon={p.icon}></iconify-icon>
                    {p.label}
                  </button>
                ))}
              </div>

              {platformAccounts.length > 0 ? (
                <div>
                  <label className="form-label small text-muted">Post as account (optional)</label>
                  <select className="form-select form-select-sm" value={form.account_id}
                    onChange={(e) => setField('account_id', e.target.value)}>
                    <option value="">— No specific account —</option>
                    {platformAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.account_name}{a.page_name ? ` / ${a.page_name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="text-muted small mb-0">
                  No {selectedPlat.label} accounts connected.{' '}
                  <Link to="/admin/marketing/accounts">Connect one</Link>
                </p>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="card mb-3">
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="card-title mb-0">Content</h6>
                <span className={`badge ${charOver ? 'bg-danger' : charCount > MAX_CHARS * 0.9 ? 'bg-warning text-dark' : 'bg-secondary'}`}>
                  {charCount} / {MAX_CHARS}
                </span>
              </div>
              <textarea
                className={`form-control ${charOver ? 'is-invalid' : ''}`}
                rows={6}
                placeholder="What do you want to share?"
                value={form.content}
                onChange={(e) => setField('content', e.target.value)}
              />
              {charOver && <div className="invalid-feedback">Character limit exceeded</div>}
              <small className="text-muted">
                Instagram allows up to 2,200 characters; Facebook up to 63,206; LinkedIn up to 3,000.
              </small>
            </div>
          </div>

          {/* Media URLs */}
          <div className="card mb-3">
            <div className="card-body">
              <h6 className="card-title mb-3">Media (optional)</h6>
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className="mb-2">
                  <input
                    type="url"
                    className="form-control form-control-sm"
                    placeholder={`Image URL ${idx + 1}`}
                    value={form.media_urls[idx]}
                    onChange={(e) => setMediaUrl(idx, e.target.value)}
                  />
                </div>
              ))}
              <small className="text-muted">Enter up to 4 public image URLs.</small>
            </div>
          </div>

          {/* Schedule */}
          <div className="card mb-3">
            <div className="card-body">
              <div className="form-check form-switch mb-2">
                <input className="form-check-input" type="checkbox" id="scheduleToggle"
                  checked={form.schedule}
                  onChange={(e) => setField('schedule', e.target.checked)} />
                <label className="form-check-label fw-semibold" htmlFor="scheduleToggle">
                  Schedule for later
                </label>
              </div>
              {form.schedule && (
                <input
                  type="datetime-local"
                  className="form-control"
                  value={form.scheduled_at}
                  onChange={(e) => setField('scheduled_at', e.target.value)}
                  min={toLocalInput(new Date())}
                />
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="d-flex gap-2 flex-wrap">
            <button className="btn btn-primary" disabled={busy || charOver}
              onClick={() => submit(form.schedule ? 'schedule' : 'draft')}>
              {busy ? 'Saving…' : form.schedule ? 'Schedule Post' : 'Save Draft'}
            </button>
            {!form.schedule && (
              <button className="btn btn-success" disabled={busy || charOver}
                onClick={() => submit('publish')}>
                {busy ? 'Publishing…' : 'Publish Now'}
              </button>
            )}
            <Link to="/admin/marketing/post-queue" className="btn btn-light">Cancel</Link>
          </div>
        </div>

        {/* ---- Preview (right) ---- */}
        <div className="col-lg-5">
          <div className="card sticky-top" style={{ top: '1rem' }}>
            <div className="card-header d-flex align-items-center gap-2">
              <iconify-icon icon={selectedPlat.icon} style={{ fontSize: '1.1rem' }}></iconify-icon>
              <span className="fw-semibold">{selectedPlat.label} Preview</span>
            </div>
            <div className="card-body">
              <div className="d-flex align-items-center gap-2 mb-3">
                <div className="rounded-circle bg-secondary d-flex align-items-center justify-content-center"
                  style={{ width: 40, height: 40, flexShrink: 0 }}>
                  <iconify-icon icon={selectedPlat.icon} style={{ fontSize: '1.2rem' }}></iconify-icon>
                </div>
                <div>
                  <div className="fw-semibold small">
                    {platformAccounts.find((a) => String(a.id) === String(form.account_id))?.account_name
                      || `Your ${selectedPlat.label} Page`}
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                    {form.schedule && form.scheduled_at
                      ? `Scheduled: ${new Date(form.scheduled_at).toLocaleString()}`
                      : 'Just now'}
                  </div>
                </div>
              </div>

              <p className="mb-3" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.9rem' }}>
                {form.content || <span className="text-muted fst-italic">Your post content will appear here…</span>}
              </p>

              {previewMedia.length > 0 && (
                <div className={`row g-1 ${previewMedia.length === 1 ? '' : 'row-cols-2'}`}>
                  {previewMedia.map((url, i) => (
                    <div key={i} className="col">
                      <img
                        src={url}
                        alt={`media ${i + 1}`}
                        className="img-fluid rounded"
                        style={{ maxHeight: 160, width: '100%', objectFit: 'cover' }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {previewMedia.length === 0 && (
                <div className="rounded bg-light d-flex align-items-center justify-content-center"
                  style={{ height: 120 }}>
                  <span className="text-muted small">No media attached</span>
                </div>
              )}

              <div className="d-flex gap-3 mt-3 pt-2 border-top text-muted" style={{ fontSize: '0.8rem' }}>
                <span><iconify-icon icon="solar:like-line-duotone"></iconify-icon> Like</span>
                <span><iconify-icon icon="solar:chat-line-line-duotone"></iconify-icon> Comment</span>
                <span><iconify-icon icon="solar:share-line-duotone"></iconify-icon> Share</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
