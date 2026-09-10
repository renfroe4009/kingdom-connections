// =============================================================================
// Reports Dashboard — Phase 8
// Tabs: Traffic / SEO / Revenue / Social  (Sales Tax & Reconciliation redirect)
// =============================================================================
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

// Resolve active tab from pathname
function tabFromPath(pathname) {
  if (pathname.includes('/reports/seo'))     return 'seo';
  if (pathname.includes('/reports/social'))  return 'social';
  return 'traffic';
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, tint = 'primary', sub }) {
  return (
    <div className="col-sm-6 col-xl-3 mb-3">
      <div className="card h-100">
        <div className="card-body">
          <div className="d-flex align-items-center gap-2 mb-2">
            <div className={`p-2 bg-${tint}-subtle rounded-1`}>
              <iconify-icon icon={icon} class={`text-${tint} fs-5`}></iconify-icon>
            </div>
            <span className="fs-3 text-muted fw-semibold">{label}</span>
          </div>
          <h3 className="mb-0 fw-bolder">{value}</h3>
          {sub && <p className="text-muted fs-2 mb-0 mt-1">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Traffic tab ───────────────────────────────────────────────────────────────
function fmtBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function TrafficTab() {
  const [traffic, setTraffic]   = useState(null);
  const [seoSettings, setSeo]   = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/analytics/traffic'),
      api.get('/seo/settings'),
    ]).then(([tRes, seoRes]) => {
      setTraffic(tRes.data);
      setSeo(seoRes.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;

  const cfConfigured  = traffic?.source === 'cloudflare' && traffic?.configured;
  const ga4Active     = !!seoSettings?.ga4_measurement_id;
  const clarityActive = !!seoSettings?.clarity_project_id;

  const totals = traffic?.totals || {};
  const days   = (traffic?.days || []).map((d) => ({
    date:      d.date.slice(5),   // "MM-DD"
    pageviews: d.pageviews,
    uniques:   d.uniques,
    requests:  d.requests,
  }));

  return (
    <>
      {/* ── Source badge ── */}
      {cfConfigured ? (
        <div className="d-flex align-items-center gap-2 mb-3 p-2 rounded" style={{ background: '#fff3cd', border: '1px solid #ffc107' }}>
          <iconify-icon icon="simple-icons:cloudflare" style={{ color: '#f38020', fontSize: '1.25rem' }}></iconify-icon>
          <span className="fw-semibold" style={{ color: '#664d03' }}>Live Cloudflare Analytics — last 30 days</span>
          {ga4Active && <span className="badge bg-secondary ms-auto">GA4 script also active (tracking only)</span>}
        </div>
      ) : (
        <div className="alert alert-warning d-flex align-items-center gap-2 mb-3">
          <iconify-icon icon="solar:chart-bold" class="fs-5"></iconify-icon>
          <div>
            {traffic?.message
              ? traffic.message
              : traffic?.error
                ? <>Cloudflare error: {traffic.error}</>
                : <>Cloudflare Analytics not configured. Add <code>CF_API_TOKEN</code> to Railway environment variables.</>
            }
            {' '}<Link to="/admin/reports/seo-settings" className="alert-link">SEO Settings</Link>
          </div>
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="row">
        <StatCard label="Pageviews (30d)"   value={(totals.pageviews || 0).toLocaleString()}  icon="solar:eye-bold"                          tint="primary" />
        <StatCard label="Unique Visitors"   value={(totals.uniques   || 0).toLocaleString()}  icon="solar:users-group-two-rounded-bold"       tint="success" />
        <StatCard label="Total Requests"    value={(totals.requests  || 0).toLocaleString()}  icon="solar:transfer-horizontal-bold"           tint="info"    />
        <StatCard label="Bandwidth Served"  value={totals.bytes ? fmtBytes(totals.bytes) : '—'} icon="solar:database-bold"                  tint="warning" />
      </div>

      {/* ── Daily pageviews chart ── */}
      {cfConfigured && days.length > 0 && (
        <div className="card mb-3">
          <div className="card-header fw-semibold">Daily Pageviews — Last 30 Days</div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={days} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="pvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--bs-primary)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--bs-primary)" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                <YAxis tick={{ fontSize: 11 }} width={45} />
                <Tooltip />
                <Area type="monotone" dataKey="pageviews" stroke="var(--bs-primary)" fill="url(#pvGrad)" strokeWidth={2} dot={false} name="Pageviews" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Integrations status ── */}
      <div className="card">
        <div className="card-header fw-semibold">Active Integrations</div>
        <div className="card-body p-0">
          <table className="table table-sm mb-0">
            <thead><tr><th>Integration</th><th>Status</th><th>Purpose</th></tr></thead>
            <tbody>
              <tr>
                <td><iconify-icon icon="simple-icons:cloudflare" style={{ color: '#f38020' }}></iconify-icon> Cloudflare Analytics</td>
                <td>{cfConfigured ? <span className="badge bg-success">Live</span> : <span className="badge bg-secondary">Not configured</span>}</td>
                <td className="text-muted fs-3">Traffic, bandwidth, bots filtered — no cookie needed</td>
              </tr>
              <tr>
                <td><iconify-icon icon="logos:google-analytics"></iconify-icon> Google Analytics 4</td>
                <td>{ga4Active ? <span className="badge bg-success">Script active</span> : <span className="badge bg-secondary">Not configured</span>}</td>
                <td className="text-muted fs-3">Session depth, events, conversions (requires cookie consent)</td>
              </tr>
              <tr>
                <td><iconify-icon icon="simple-icons:microsoftclarity" style={{ color: '#0078d4' }}></iconify-icon> Microsoft Clarity</td>
                <td>{clarityActive ? <span className="badge bg-success">Script active</span> : <span className="badge bg-secondary">Not configured</span>}</td>
                <td className="text-muted fs-3">
                  Heatmaps and session recordings
                  {clarityActive && (
                    <a href="https://clarity.microsoft.com" target="_blank" rel="noopener noreferrer" className="ms-2 text-decoration-none">
                      View dashboard ↗
                    </a>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 text-end">
        <Link to="/admin/reports/seo-settings" className="btn btn-sm btn-outline-secondary">Manage Integrations</Link>
      </div>
    </>
  );
}

// ── SEO tab ───────────────────────────────────────────────────────────────────
function SeoTab() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/analytics/search-console')
      .then((r) => setData(r.data))
      .catch(() => setData({ source: 'none', configured: false }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;

  const gscConfigured = data?.source === 'google-search-console' && data?.configured;

  if (!gscConfigured) {
    return (
      <div className="card border-0">
        <div className="card-body text-center py-5">
          <iconify-icon icon="logos:google-search-console" style={{ fontSize: '3rem' }}></iconify-icon>
          <h5 className="mt-3 mb-2">Google Search Console not connected</h5>
          <p className="text-muted mb-3" style={{ maxWidth: 460, margin: '0 auto 1.25rem' }}>
            {data?.message || 'Connect GSC to see live search impressions, clicks, top queries, and average ranking position.'}
          </p>
          <Link to="/admin/reports/seo-settings" className="btn btn-primary btn-sm me-2">Configure in SEO Settings</Link>
          <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="btn btn-outline-secondary btn-sm">Open Search Console ↗</a>
        </div>
      </div>
    );
  }

  const daily = (data.daily || []).map((d) => ({ ...d, date: d.date.slice(5) }));

  return (
    <>
      {/* Source badge */}
      <div className="d-flex align-items-center gap-2 mb-3 p-2 rounded" style={{ background: '#e8f5e9', border: '1px solid #a5d6a7' }}>
        <iconify-icon icon="logos:google-search-console" style={{ fontSize: '1.25rem' }}></iconify-icon>
        <span className="fw-semibold" style={{ color: '#1b5e20' }}>Live Google Search Console — last 28 days</span>
        <a href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" className="ms-auto btn btn-sm btn-outline-success">Open GSC ↗</a>
      </div>

      <div className="row">
        <StatCard label="Impressions"        value={(data.impressions || 0).toLocaleString()} icon="solar:graph-bold"     tint="primary" />
        <StatCard label="Clicks"             value={(data.clicks      || 0).toLocaleString()} icon="solar:cursor-bold"    tint="success" />
        <StatCard label="Avg Position"       value={`#${data.position || '—'}`}               icon="solar:ranking-bold"   tint="warning" />
        <StatCard label="Click-through Rate" value={`${data.ctr || 0}%`}                      icon="solar:chart-2-bold"   tint="info"    />
      </div>

      {/* Daily clicks chart */}
      {daily.length > 0 && (
        <div className="card mb-3">
          <div className="card-header fw-semibold">Daily Clicks &amp; Impressions</div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={daily} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="clickGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--bs-success)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--bs-success)" stopOpacity={0}    />
                  </linearGradient>
                  <linearGradient id="impGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--bs-primary)" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="var(--bs-primary)" stopOpacity={0}    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={3} />
                <YAxis tick={{ fontSize: 11 }} width={45} />
                <Tooltip />
                <Area type="monotone" dataKey="impressions" stroke="var(--bs-primary)" fill="url(#impGrad)" strokeWidth={1.5} dot={false} name="Impressions" />
                <Area type="monotone" dataKey="clicks"      stroke="var(--bs-success)" fill="url(#clickGrad)" strokeWidth={2} dot={false} name="Clicks" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top queries */}
      <div className="card">
        <div className="card-header fw-semibold">Top Search Queries</div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-sm table-hover mb-0">
              <thead>
                <tr>
                  <th>Query</th>
                  <th className="text-end">Clicks</th>
                  <th className="text-end">Impressions</th>
                  <th className="text-end">CTR</th>
                  <th className="text-end">Position</th>
                </tr>
              </thead>
              <tbody>
                {data.queries?.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-muted py-3">No query data yet</td></tr>
                )}
                {(data.queries || []).map((q) => (
                  <tr key={q.query}>
                    <td className="font-monospace small">{q.query}</td>
                    <td className="text-end">{q.clicks.toLocaleString()}</td>
                    <td className="text-end">{q.impressions.toLocaleString()}</td>
                    <td className="text-end">{q.ctr}%</td>
                    <td className="text-end">#{q.position}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Revenue tab ───────────────────────────────────────────────────────────────
const fmtMoney = (n) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Social tab ────────────────────────────────────────────────────────────────
function SocialTab() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const PLATFORM_META = {
    facebook:  { name: 'Facebook',  icon: 'logos:facebook' },
    instagram: { name: 'Instagram', icon: 'skill-icons:instagram' },
    linkedin:  { name: 'LinkedIn',  icon: 'logos:linkedin-icon' },
  };

  useEffect(() => {
    api.get('/social/stats')
      .then((r) => setData(r.data))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load social data.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;
  if (error)   return <div className="alert alert-danger">{error}</div>;

  const accounts   = data?.accounts || [];
  const byPlatform = data?.by_platform || [];
  const statsFor   = (platform) => byPlatform.find((p) => p.platform === platform);

  return (
    <>
      <div className="alert alert-secondary d-flex align-items-center gap-2 mb-4">
        <iconify-icon icon="solar:link-bold" class="fs-5"></iconify-icon>
        <span>
          Post counts below come from posts composed in the CRM. Real platform
          reach/engagement metrics require connecting live Facebook/Instagram/
          LinkedIn APIs (not yet wired) — see the{' '}
          <Link to="/admin/marketing/social-composer">Social Composer</Link>.
        </span>
      </div>

      <div className="row">
        {Object.entries(PLATFORM_META).map(([key, p]) => {
          const stats     = statsFor(key);
          const connected = accounts.filter((a) => a.platform === key && a.is_active);
          return (
            <div key={key} className="col-sm-6 col-xl-4 mb-3">
              <div className="card h-100 border-0 shadow-sm">
                <div className="card-body">
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <iconify-icon icon={p.icon} class="fs-4"></iconify-icon>
                    <h6 className="mb-0 fw-semibold">{p.name}</h6>
                  </div>
                  <div className="row g-2 text-center">
                    {[
                      { label: 'Published', value: stats?.published ?? 0 },
                      { label: 'Scheduled',  value: stats?.scheduled ?? 0 },
                      { label: 'Drafts',     value: stats?.draft ?? 0 },
                    ].map((stat) => (
                      <div key={stat.label} className="col-4">
                        <div className="bg-light rounded p-2">
                          <div className="fw-bold">{stat.value}</div>
                          <div className="text-muted fs-2">{stat.label}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-center">
                    {connected.length ? (
                      <span className="badge bg-success-subtle text-success">
                        {connected.length} account{connected.length > 1 ? 's' : ''} connected
                      </span>
                    ) : (
                      <span className="badge bg-secondary-subtle text-secondary">Not connected</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ReportsDashboardPage() {
  const location = useLocation();
  const navigate  = useNavigate();
  const activeTab = tabFromPath(location.pathname);

  const tabs = [
    { key: 'traffic', label: 'Traffic',  path: '/admin/reports/traffic',  icon: 'solar:eye-bold' },
    { key: 'seo',     label: 'SEO',      path: '/admin/reports/seo',      icon: 'solar:graph-bold' },
    { key: 'social',  label: 'Social',   path: '/admin/reports/social',   icon: 'solar:share-circle-bold' },
    { key: 'tax',     label: 'Sales Tax',       path: '/admin/billing/tax-report',    icon: 'solar:receipt-bold' },
    { key: 'recon',   label: 'Reconciliation',  path: '/admin/billing/reconciliation', icon: 'solar:shield-check-bold' },
  ];

  // Handle redirect tabs immediately
  useEffect(() => {
    if (activeTab === 'tax')   navigate('/admin/billing/tax-report',    { replace: true });
    if (activeTab === 'recon') navigate('/admin/billing/reconciliation', { replace: true });
  }, [activeTab, navigate]);

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Traffic, SEO, and social performance"
        actions={
          <Link to="/admin/reports/seo-settings" className="btn btn-sm btn-outline-secondary">
            <iconify-icon icon="solar:settings-bold" class="me-1"></iconify-icon>
            SEO Settings
          </Link>
        }
      />

      {/* Tab navigation */}
      <ul className="nav nav-tabs mb-4">
        {tabs.map((t) => (
          <li className="nav-item" key={t.key}>
            <Link
              to={t.path}
              className={`nav-link d-flex align-items-center gap-1 ${activeTab === t.key ? 'active' : ''}`}
            >
              <iconify-icon icon={t.icon} class="fs-5"></iconify-icon>
              <span className="d-none d-sm-inline">{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Tab content */}
      {activeTab === 'traffic' && <TrafficTab />}
      {activeTab === 'seo'     && <SeoTab />}
      {activeTab === 'social'  && <SocialTab />}
    </div>
  );
}
