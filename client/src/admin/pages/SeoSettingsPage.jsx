// =============================================================================
// SEO Settings — Phase 8
// Route: /reports/seo-settings
// =============================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import MediaPickerModal from '../../components/MediaPickerModal.jsx';

const SERVER_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const resolveUrl = (url) => {
  if (!url || !SERVER_BASE) return url;
  if (url.startsWith('/uploads/') || url.startsWith('/api/')) return `${SERVER_BASE}${url}`;
  return url;
};

export default function SeoSettingsPage() {
  const [form, setForm]       = useState({
    site_url: '',
    preferred_domain: 'apex',
    clarity_project_id: '',
    ga4_measurement_id: '',
    google_search_console_verification: '',
    gsc_property: '',
    gsc_service_account_json: '',
    default_og_image: '',
    robots_txt: 'User-agent: *\nAllow: /\n\nSitemap: /api/sitemap-index.xml\n',
    head_scripts: '',
    body_scripts: '',
  });
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [error,       setError]       = useState('');
  const [showPicker,  setShowPicker]  = useState(false);

  useEffect(() => {
    api.get('/seo/settings')
      .then((r) => setForm((f) => ({ ...f, ...r.data })))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function onChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setSaved(false);
  }

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await api.put('/seo/settings', form);
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  const clarityPreview = form.clarity_project_id
    ? `<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window,document,"clarity","script","${form.clarity_project_id}");
</script>`
    : null;

  if (loading) return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;

  return (
    <div>
      <PageHeader
        title="SEO Settings"
        subtitle="Configure tracking, analytics, and search engine preferences"
        actions={
          <Link to="/admin/reports/traffic" className="btn btn-sm btn-outline-secondary">
            Back to Reports
          </Link>
        }
      />

      {error && <div className="alert alert-danger">{error}</div>}
      {saved && <div className="alert alert-success">Settings saved successfully.</div>}

      <form onSubmit={onSave}>
        <div className="row g-4">

          {/* ── Domain Settings ── */}
          <div className="col-12">
            <div className="card">
              <div className="card-header d-flex align-items-center gap-2 fw-semibold">
                <iconify-icon icon="solar:global-bold" class="fs-5"></iconify-icon>
                Domain Settings
              </div>
              <div className="card-body row g-3">
                <div className="col-lg-6">
                  <label className="form-label fw-medium">Site URL</label>
                  <div className="input-group">
                    <span className="input-group-text">https://</span>
                    <input
                      type="text"
                      className="form-control"
                      name="site_url"
                      value={form.site_url}
                      onChange={onChange}
                      placeholder="vcsf.org"
                    />
                  </div>
                  <div className="form-text">Your root domain, no https:// or trailing slash. Used to build canonical URLs.</div>
                </div>
                <div className="col-lg-6">
                  <label className="form-label fw-medium">Preferred Domain</label>
                  <select
                    className="form-select"
                    name="preferred_domain"
                    value={form.preferred_domain}
                    onChange={onChange}
                  >
                    <option value="apex">Apex — https://vcsf.org (no www)</option>
                    <option value="www">WWW — https://www.vcsf.org</option>
                  </select>
                  <div className="form-text">
                    Sets the canonical tag on every public page so Google indexes only your preferred version.
                    {' '}To enforce the redirect (www → apex or apex → www), set a Cloudflare Page Rule or redirect rule on your host.
                  </div>
                </div>
                {form.site_url && (
                  <div className="col-12">
                    <div className="alert alert-secondary py-2 mb-0 fs-3">
                      Canonical will be:{' '}
                      <code>
                        https://{form.preferred_domain === 'www' ? 'www.' : ''}{form.site_url}/current-page-path
                      </code>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Microsoft Clarity ── */}
          <div className="col-lg-6">
            <div className="card h-100">
              <div className="card-header d-flex align-items-center gap-2 fw-semibold">
                <iconify-icon icon="simple-icons:microsoftclarity" class="fs-5"></iconify-icon>
                Microsoft Clarity
              </div>
              <div className="card-body">
                <label className="form-label fw-medium">Clarity Project ID</label>
                <input
                  type="text"
                  className="form-control"
                  name="clarity_project_id"
                  value={form.clarity_project_id}
                  onChange={onChange}
                  placeholder="e.g. abc123xyz"
                />
                <div className="form-text">
                  Find your project ID at{' '}
                  <a href="https://clarity.microsoft.com" target="_blank" rel="noopener noreferrer">
                    clarity.microsoft.com
                  </a>
                  . Once saved, the tracking script will be injected automatically on every page load.
                </div>

                {clarityPreview && (
                  <div className="mt-3">
                    <label className="form-label fw-medium fs-2 text-muted">Script Preview</label>
                    <pre className="bg-light p-2 rounded fs-2" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {clarityPreview}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Google Analytics / Search Console Verification ── */}
          <div className="col-lg-6">
            <div className="card h-100">
              <div className="card-header d-flex align-items-center gap-2 fw-semibold">
                <iconify-icon icon="logos:google-analytics" class="fs-5"></iconify-icon>
                Google Analytics
              </div>
              <div className="card-body">
                <label className="form-label fw-medium">GA4 Measurement ID</label>
                <input
                  type="text"
                  className="form-control mb-3"
                  name="ga4_measurement_id"
                  value={form.ga4_measurement_id}
                  onChange={onChange}
                  placeholder="G-XXXXXXXXXX"
                />

                <label className="form-label fw-medium">Search Console Verification Tag</label>
                <input
                  type="text"
                  className="form-control"
                  name="google_search_console_verification"
                  value={form.google_search_console_verification}
                  onChange={onChange}
                  placeholder="Paste the content= value from the meta tag"
                />
                <div className="form-text">
                  In Search Console, choose "HTML tag" and paste only the <code>content</code> value (not the full tag). This verifies ownership — separate from live data below.
                </div>
              </div>
            </div>
          </div>

          {/* ── Google Search Console — Live Data ── */}
          <div className="col-12">
            <div className="card">
              <div className="card-header d-flex align-items-center gap-2 fw-semibold">
                <iconify-icon icon="logos:google" class="fs-5"></iconify-icon>
                Google Search Console — Live SEO Data
              </div>
              <div className="card-body row g-3">
                <div className="col-lg-6">
                  <label className="form-label fw-medium">GSC Property</label>
                  <input
                    type="text"
                    className="form-control"
                    name="gsc_property"
                    value={form.gsc_property}
                    onChange={onChange}
                    placeholder="sc-domain:vcsf.org  or  https://vcsf.org/"
                  />
                  <div className="form-text">
                    Exact property string from Search Console — either a domain property (<code>sc-domain:example.com</code>) or a URL-prefix property (<code>https://www.example.com/</code>).
                  </div>
                </div>
                <div className="col-12">
                  <label className="form-label fw-medium">Service Account JSON</label>
                  <textarea
                    className="form-control font-monospace"
                    name="gsc_service_account_json"
                    rows={6}
                    value={form.gsc_service_account_json}
                    onChange={onChange}
                    spellCheck={false}
                    placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key": "...",\n  "client_email": "...",\n  ...\n}'}
                  />
                  <div className="form-text">
                    Paste the full contents of your GCP service account JSON key file.{' '}
                    Steps: GCP Console → IAM → Service Accounts → Create → Download JSON key.
                    Then in Search Console → Settings → Users and permissions → Add user → paste the service account email → set role to <strong>Owner</strong> or <strong>Restricted (Verified)</strong>.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── OG Image ── */}
          <div className="col-12">
            <div className="card">
              <div className="card-header d-flex align-items-center gap-2 fw-semibold">
                <iconify-icon icon="solar:gallery-bold" class="fs-5"></iconify-icon>
                Social Sharing
              </div>
              <div className="card-body">
                <label className="form-label fw-medium">Default OG Image</label>
                <div className="input-group">
                  <input
                    type="url"
                    className="form-control"
                    name="default_og_image"
                    value={form.default_og_image}
                    onChange={onChange}
                    placeholder="https://example.com/og-image.jpg"
                  />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setShowPicker(true)}
                  >
                    <iconify-icon icon="solar:gallery-line-duotone" class="me-1" />
                    Choose from Library
                  </button>
                  {form.default_og_image && (
                    <button
                      type="button"
                      className="btn btn-outline-danger"
                      onClick={() => setForm((f) => ({ ...f, default_og_image: '' }))}
                      title="Clear image"
                    >
                      <iconify-icon icon="solar:close-circle-line-duotone" />
                    </button>
                  )}
                </div>
                <div className="form-text">
                  Used as the default Open Graph image when a page doesn't specify its own.
                  Recommended size: 1200 × 630 px.
                </div>
                {form.default_og_image && (
                  <div className="mt-2">
                    <img
                      src={form.default_og_image}
                      alt="OG preview"
                      className="img-thumbnail"
                      style={{ maxHeight: 120 }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                )}
              </div>

              <MediaPickerModal
                show={showPicker}
                onClose={() => setShowPicker(false)}
                onSelect={(file) => {
                  setForm((f) => ({ ...f, default_og_image: resolveUrl(file.file_url) }));
                }}
              />
            </div>
          </div>

          {/* ── Custom Scripts ── */}
          <div className="col-12">
            <div className="card">
              <div className="card-header d-flex align-items-center gap-2 fw-semibold">
                <iconify-icon icon="solar:code-square-line-duotone" class="fs-5"></iconify-icon>
                Custom Scripts &amp; Tags
              </div>
              <div className="card-body row g-4">
                <div className="col-12">
                  <label className="form-label fw-medium">&lt;head&gt; Scripts</label>
                  <textarea
                    className="form-control font-monospace"
                    name="head_scripts"
                    rows={6}
                    value={form.head_scripts}
                    onChange={onChange}
                    spellCheck={false}
                    placeholder={'<!-- Google Tag Manager -->\n<script>(function(w,d,s,l,i){...})(window,document,\'script\',\'dataLayer\',\'GTM-XXXXXXX\');</script>'}
                  />
                  <div className="form-text">
                    Injected into <code>&lt;head&gt;</code> on every public page. Paste full <code>&lt;script&gt;</code> or <code>&lt;meta&gt;</code> tags here — GTM head snippet, custom fonts, Hotjar, etc.
                  </div>
                </div>
                <div className="col-12">
                  <label className="form-label fw-medium">&lt;body&gt; Scripts</label>
                  <textarea
                    className="form-control font-monospace"
                    name="body_scripts"
                    rows={4}
                    value={form.body_scripts}
                    onChange={onChange}
                    spellCheck={false}
                    placeholder={'<!-- Google Tag Manager (noscript) -->\n<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>'}
                  />
                  <div className="form-text">
                    Injected at the start of <code>&lt;body&gt;</code> on every public page. Used for the GTM <code>&lt;noscript&gt;</code> fallback.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── robots.txt ── */}
          <div className="col-12">
            <div className="card">
              <div className="card-header d-flex align-items-center gap-2 fw-semibold">
                <iconify-icon icon="solar:robot-bold" class="fs-5"></iconify-icon>
                robots.txt
                <span className="badge bg-secondary-subtle text-secondary ms-auto fs-1">
                  Served at /api/seo/robots.txt
                </span>
              </div>
              <div className="card-body">
                <label className="form-label fw-medium">Content</label>
                <textarea
                  className="form-control font-monospace"
                  name="robots_txt"
                  rows={8}
                  value={form.robots_txt}
                  onChange={onChange}
                  spellCheck={false}
                />
                <div className="form-text">
                  Standard robots.txt directives. The sitemap line is included automatically.{' '}
                  <a href="/api/seo/robots.txt" target="_blank" rel="noopener noreferrer">View current robots.txt</a>
                  {' | '}
                  <a href="/api/seo/sitemap-index.xml" target="_blank" rel="noopener noreferrer">View sitemap index</a>
                </div>
              </div>
            </div>
          </div>

        </div>

        <div className="mt-4 d-flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving
              ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
              : <><iconify-icon icon="solar:floppy-disk-bold" class="me-1"></iconify-icon>Save Settings</>
            }
          </button>
          {saved && (
            <span className="text-success align-self-center fs-3">
              <iconify-icon icon="solar:check-circle-bold" class="me-1"></iconify-icon>
              Saved
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
