import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';

// Token field — shows masked value when saved, reveals a fresh input only when
// the user explicitly clicks "Change". Prevents accidental paste-overwrites.
function SmsTokenField({ value, onChange }) {
  const isSaved = value && value.startsWith('•');
  const [changing, setChanging] = useState(false);

  if (isSaved && !changing) {
    return (
      <div className="input-group">
        <input className="form-control" readOnly value="••••••••••••••••••••••••••••••••" />
        <button type="button" className="btn btn-outline-secondary" onClick={() => { onChange(''); setChanging(true); }}>
          Change
        </button>
      </div>
    );
  }
  return (
    <input
      type="text"
      className="form-control font-monospace"
      value={value || ''}
      maxLength={64}
      placeholder="Paste 32-character token here"
      onChange={(e) => {
        const v = e.target.value.trim();
        if (v.length > 64 || v.includes(' ') || v.toLowerCase().includes('curl')) return;
        onChange(v);
      }}
      autoFocus={changing}
    />
  );
}

// Shown in the Google setup instructions — the OAuth redirect URI must match
// wherever the API is actually reachable (Railway in production, the local
// dev server otherwise), since it's registered per-environment in both
// Google Cloud Console and the server's GOOGLE_REDIRECT_URI env var.
const GOOGLE_REDIRECT_URI = `${(import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '')}/api/google/oauth/callback`;

export default function SettingsPage() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') || 'smtp');
  const [smtp, setSmtp] = useState({
    host: '', port: 587, secure: false, username: '', password: '',
    from_email: '', from_name: '', is_active: true,
  });
  const [cw, setCw] = useState({
    site_url: '', company_id: '', public_key: '', private_key: '',
    client_id: '', push_on_won: true, webhook_url: '',
    cw_member_id: '', cw_stage_name: '', cw_status_name: '',
    cw_location_id: '', cw_business_unit_id: '',
  });
  const [usps, setUsps] = useState({
    base_url: 'https://apis.usps.com', consumer_key: '', consumer_secret: '', is_active: true,
  });
  const [sms, setSms] = useState({
    provider: 'dryrun', account_sid: '', api_key_sid: '', auth_token: '', from_number: '', is_active: true,
    text_to_give_enabled: false, text_to_give_keyword: 'GIVE', text_to_give_landing_path: '',
    text_to_give_reply_template: '', text_to_give_help_template: '',
  });
  const [smsMsg, setSmsMsg] = useState('');
  const [testSmsTo, setTestSmsTo] = useState('');
  const [smtpMsg, setSmtpMsg] = useState('');
  const [cwMsg, setCwMsg] = useState('');
  const [uspsMsg, setUspsMsg] = useState('');
  const [syncLog, setSyncLog] = useState([]);
  const [testEmail, setTestEmail] = useState('');

  // Payment gateways
  // Defaults include the L2 / L3 / processing-fee fields — both gateways
  // support all three capabilities. Capability flags (`supports_*`) are set
  // server-side so the UI can stay generic.
  const emptyB2B = {
    l2_enabled: false,
    l3_enabled: false,
    b2b_only: true,
    merchant_tax_id: '',
    summary_commodity_code: '',
    default_commodity_code: '',
    fee_mode: 'none',
    fee_percent: 0,
    fee_fixed: 0,
    fee_applies_to: 'credit_only',
    fee_label: 'Processing Fee',
    fee_disclosure: '',
    // QuickBooks integration — opt-in. When OFF we send no QB fields to the gateway.
    quickbooks_enabled: false,
    quickbooks_realm_id: '',
    supports_l2: 1, supports_l3: 1, supports_surcharge: 1,
  };
  const emptyAN = {
    gateway: 'authnet', mode: 'sandbox', display_name: '',
    api_login_id: '', transaction_key: '', public_client_key: '', signature_key: '',
    is_active: true, is_default: false,
    ...emptyB2B,
  };
  const emptyValor = {
    gateway: 'valor', mode: 'sandbox', display_name: '',
    epi_id: '', api_key: '', app_id: '', app_key: '', webhook_secret: '',
    is_active: true, is_default: false,
    ach_enabled: false, ach_authorization_text: '',
    ...emptyB2B,
  };
  const [authnet, setAuthnet] = useState(emptyAN);
  const [valor, setValor] = useState(emptyValor);
  const [payMsg, setPayMsg] = useState('');

  // Google Workspace
  const [google, setGoogle] = useState(null);   // null=loading, {connected,google_email,...}
  const [googleMsg, setGoogleMsg] = useState('');
  const [googleBusy, setGoogleBusy] = useState(false);

  // ConnectWise inbound import
  const [cwImport, setCwImport] = useState({ busy: false, runId: null, status: null, msg: '' });
  const [cwImportHistory, setCwImportHistory] = useState([]);

  // Batch reconciliation
  const [batchRuns, setBatchRuns] = useState([]);
  const [reconBusy, setReconBusy] = useState(false);
  const [reconHours, setReconHours] = useState(48);

  // AI Assistant
  const [ai, setAi] = useState({ api_key: '', model: 'claude-haiku-4-5-20251001', active: true });
  const [aiMsg, setAiMsg] = useState('');
  const [aiTesting, setAiTesting] = useState(false);

  useEffect(() => {
    api.get('/settings/smtp').then((r) => r.data && setSmtp((s) => ({ ...s, ...r.data }))).catch(() => {});
    api.get('/settings/sms').then((r) => r.data && setSms((s) => ({ ...s, ...r.data, is_active: !!r.data.is_active }))).catch(() => {});
    api.get('/connectwise/settings').then((r) => r.data && setCw((c) => ({ ...c, ...r.data }))).catch(() => {});
    api.get('/usps/settings').then((r) => r.data && setUsps((u) => ({ ...u, ...r.data, is_active: r.data.is_active !== 0 }))).catch(() => {});
    api.get('/connectwise/sync-log').then((r) => setSyncLog(r.data || [])).catch(() => {});
    api.get('/connectwise/import-history').then((r) => setCwImportHistory(r.data || [])).catch(() => {});
    api.get('/google/status').then((r) => setGoogle(r.data)).catch(() => setGoogle({ connected: false }));
    api.get('/ai/settings').then((r) => r.data && setAi((a) => ({ ...a, ...r.data, active: !!r.data.active }))).catch(() => {});
    // Handle redirect back from Google OAuth
    const gConnected = searchParams.get('connected');
    const gError     = searchParams.get('error');
    if (gConnected) { setGoogleMsg('Google account connected successfully.'); setSearchParams({}); }
    if (gError)     { setGoogleMsg(`Google error: ${gError}`); setSearchParams({}); }
    api.get('/payments/settings').then((r) => {
      const rows = r.data || [];
      const an = rows.find((x) => x.gateway === 'authnet' && x.mode === 'sandbox')
              || rows.find((x) => x.gateway === 'authnet');
      const v  = rows.find((x) => x.gateway === 'valor'   && x.mode === 'sandbox')
              || rows.find((x) => x.gateway === 'valor');
      if (an) setAuthnet({ ...emptyAN, ...an, is_active: !!an.is_active, is_default: !!an.is_default });
      if (v)  setValor({   ...emptyValor, ...v,  is_active: !!v.is_active,  is_default: !!v.is_default });
    }).catch(() => {});
    loadBatchRuns();
  }, []);

  async function loadBatchRuns() {
    try {
      const { data } = await api.get('/payments/batch-runs');
      setBatchRuns(data?.rows || []);
    } catch (_e) { /* not fatal */ }
  }

  async function runReconcileNow() {
    setReconBusy(true);
    setPayMsg('');
    try {
      const { data } = await api.post('/payments/reconcile-batches', { hours: Number(reconHours) || 48 });
      const tot = (data?.results || []).reduce((acc, r) => {
        acc.matched   += Number(r.txns_matched   || 0);
        acc.unmatched += Number(r.txns_unmatched || 0);
        acc.errors    += r.ok === false ? 1 : 0;
        return acc;
      }, { matched: 0, unmatched: 0, errors: 0 });
      setPayMsg(`Reconciliation complete: ${tot.matched} matched, ${tot.unmatched} unmatched${tot.errors ? `, ${tot.errors} gateway error(s)` : ''}.`);
      loadBatchRuns();
    } catch (e) {
      setPayMsg(e.response?.data?.error || e.message || 'Reconciliation failed.');
    } finally {
      setReconBusy(false);
    }
  }

  async function connectGoogle() {
    setGoogleMsg(''); setGoogleBusy(true);
    try {
      const { data } = await api.get('/google/oauth/url');
      window.location.href = data.url;
    } catch (e) {
      setGoogleMsg(e.response?.data?.error || 'Failed to start Google authorization.');
      setGoogleBusy(false);
    }
  }

  async function disconnectGoogle() {
    if (!(await confirm('Disconnect your Google account?', { title: 'Disconnect Google?', confirmLabel: 'Disconnect' }))) return;
    setGoogleMsg(''); setGoogleBusy(true);
    try {
      await api.delete('/google/disconnect');
      setGoogle({ connected: false });
      setGoogleMsg('Google account disconnected.');
    } catch (e) {
      setGoogleMsg(e.response?.data?.error || 'Failed to disconnect.');
    } finally { setGoogleBusy(false); }
  }

  async function saveSms() {
    setSmsMsg('');
    try {
      await api.put('/settings/sms', sms);
      setSmsMsg('Twilio settings saved.');
    } catch (e) { setSmsMsg(e.response?.data?.error || 'Failed to save.'); }
  }
  async function testSms() {
    if (!testSmsTo) { setSmsMsg('Enter a phone number to send the test to.'); return; }
    setSmsMsg('Sending test SMS…');
    try {
      const r = await api.post('/settings/sms/test', { to: testSmsTo });
      if (r.data?.dryRun) {
        setSmsMsg('Dry-run mode — no real SMS sent. Switch provider to "Twilio" to send live.');
      } else {
        setSmsMsg(`Test SMS queued (SID: ${r.data?.sid || '—'}). Check the SMS log in a few seconds to confirm delivery status. If status stays "sent" and you don't receive it, verify your Twilio toll-free number is SMS-verified in the Twilio console.`);
      }
    } catch (e) { setSmsMsg(e.response?.data?.error || 'Test failed.'); }
  }

  async function saveSmtp() {
    setSmtpMsg('');
    try {
      await api.put('/settings/smtp', smtp);
      setSmtpMsg('SMTP settings saved.');
    } catch (e) {
      const data = e.response?.data;
      // If the server returned zod issues, show field-level detail.
      if (Array.isArray(data?.issues) && data.issues.length) {
        const detail = data.issues
          .map((i) => `${(i.path || []).join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        setSmtpMsg(`${data.error || 'Validation failed'} — ${detail}`);
      } else {
        setSmtpMsg(data?.error || 'Failed to save.');
      }
    }
  }
  async function testSmtp() {
    setSmtpMsg('Sending test email…');
    try {
      await api.post('/email/test', { to: testEmail });
      setSmtpMsg(`Test email sent to ${testEmail}.`);
    } catch (e) { setSmtpMsg(e.response?.data?.error || 'Test send failed.'); }
  }

  async function saveCw() {
    setCwMsg('');
    try {
      await api.put('/connectwise/settings', cw);
      setCwMsg('ConnectWise settings saved.');
    } catch (e) {
      const data = e.response?.data;
      if (Array.isArray(data?.issues) && data.issues.length) {
        const detail = data.issues.map((i) => `${i.path?.join('.') || 'field'}: ${i.message}`).join(' · ');
        setCwMsg(`Validation failed — ${detail}`);
      } else {
        setCwMsg(data?.error || 'Failed to save.');
      }
    }
  }
  async function testCw() {
    setCwMsg('Testing connection…');
    try {
      const r = await api.post('/connectwise/test');
      setCwMsg(r.data?.message || 'Connected successfully.');
    } catch (e) { setCwMsg(e.response?.data?.error || 'Connection failed.'); }
  }

  async function startCwImport() {
    setCwImport({ busy: true, runId: null, status: 'running', msg: 'Starting import…' });
    try {
      const { data } = await api.post('/connectwise/import');
      const runId = data.runId;
      setCwImport((s) => ({ ...s, runId, msg: 'Import running — this may take a minute…' }));
      // Poll until done
      const poll = setInterval(async () => {
        try {
          const { data: run } = await api.get(`/connectwise/import/${runId}`);
          if (run.status === 'completed') {
            clearInterval(poll);
            const msg = `Import complete — ${run.orgs_created} orgs created, ${run.orgs_updated} updated · ${run.contacts_created} contacts created, ${run.contacts_updated} updated.`;
            setCwImport({ busy: false, runId, status: 'completed', msg });
            api.get('/connectwise/import-history').then((r) => setCwImportHistory(r.data || [])).catch(() => {});
          } else if (run.status === 'failed') {
            clearInterval(poll);
            setCwImport({ busy: false, runId, status: 'failed', msg: `Import failed: ${run.error || 'unknown error'}` });
            api.get('/connectwise/import-history').then((r) => setCwImportHistory(r.data || [])).catch(() => {});
          }
        } catch (_e) { /* keep polling */ }
      }, 3000);
    } catch (e) {
      setCwImport({ busy: false, runId: null, status: 'failed', msg: e.response?.data?.error || 'Failed to start import.' });
    }
  }

  async function saveUsps() {
    setUspsMsg('');
    try {
      await api.put('/usps/settings', usps);
      setUspsMsg('USPS settings saved.');
    } catch (e) { setUspsMsg(e.response?.data?.error || 'Failed to save.'); }
  }
  async function savePayments() {
    setPayMsg('');
    try {
      if (authnet.api_login_id || authnet.transaction_key) {
        await api.put('/payments/settings', authnet);
      }
      if (valor.epi_id || valor.api_key) {
        await api.put('/payments/settings', valor);
      }
      setPayMsg('Payment gateway settings saved.');
    } catch (e) { setPayMsg(e.response?.data?.error || 'Failed to save.'); }
  }

  async function testUsps() {
    setUspsMsg('Testing USPS connection…');
    try {
      const r = await api.post('/usps/test');
      const probe = r.data?.info?.probe;
      setUspsMsg(probe
        ? `Connected. Probe: ${probe.address_line1}, ${probe.city}, ${probe.state} ${probe.postal_code}`
        : 'Connected successfully.');
    } catch (e) { setUspsMsg(e.response?.data?.error || 'Connection failed.'); }
  }

  async function saveAi() {
    setAiMsg('');
    try {
      await api.put('/ai/settings', ai);
      setAiMsg('AI settings saved.');
    } catch (e) { setAiMsg(e.response?.data?.error || 'Failed to save.'); }
  }
  async function testAi() {
    setAiTesting(true); setAiMsg('Testing connection…');
    try {
      const r = await api.post('/ai/test');
      setAiMsg(r.data?.ok ? `Connection successful. Reply: "${r.data.reply}"` : r.data?.error || 'Test failed.');
    } catch (e) { setAiMsg(e.response?.data?.error || 'Test failed.'); }
    finally { setAiTesting(false); }
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="System configuration" />

      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <ul className="nav nav-tabs mb-3" style={{ flexWrap: 'nowrap', minWidth: 'max-content' }}>
        <li className="nav-item"><button className={`nav-link ${tab === 'smtp' ? 'active' : ''}`} onClick={() => setTab('smtp')}>Email / SMTP</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'cw' ? 'active' : ''}`} onClick={() => setTab('cw')}>ConnectWise Manage</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'usps' ? 'active' : ''}`} onClick={() => setTab('usps')}>USPS Address API</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'pay' ? 'active' : ''}`} onClick={() => setTab('pay')}>Payment Gateways</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'sms' ? 'active' : ''}`} onClick={() => setTab('sms')}>Twilio / SMS</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>CW Sync Log</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'google' ? 'active' : ''}`} onClick={() => setTab('google')}>Google Workspace</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>
          <iconify-icon icon="solar:stars-line-duotone" class="me-1"></iconify-icon>AI Assistant
        </button></li>
      </ul>
      </div>

      {tab === 'smtp' && (
        <div className="card">
          <div className="card-body">
            <h5 className="mb-3">SMTP Configuration</h5>
            {smtpMsg && <div className="alert alert-info">{smtpMsg}</div>}
            <div className="row g-2">
              <div className="col-12 col-md-8"><label className="form-label">Host</label>
                <input className="form-control" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.example.com" /></div>
              <div className="col-6 col-md-2"><label className="form-label">Port</label>
                <input type="number" className="form-control" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} /></div>
              <div className="col-6 col-md-2 d-flex align-items-end">
                <div className="form-check me-3">
                  <input type="checkbox" className="form-check-input" id="smtpSecure" checked={!!smtp.secure} onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} />
                  <label className="form-check-label" htmlFor="smtpSecure">TLS/SSL</label>
                </div>
                <div className="form-check">
                  <input type="checkbox" className="form-check-input" id="smtpActive" checked={!!smtp.is_active} onChange={(e) => setSmtp({ ...smtp, is_active: e.target.checked })} />
                  <label className="form-check-label" htmlFor="smtpActive">Active</label>
                </div>
              </div>
              <div className="col-12 col-md-6"><label className="form-label">Username</label>
                <input className="form-control" value={smtp.username || ''} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} /></div>
              <div className="col-12 col-md-6"><label className="form-label">Password</label>
                <input type="password" className="form-control" value={smtp.password || ''} onChange={(e) => setSmtp({ ...smtp, password: e.target.value })} placeholder="••••••" /></div>
              <div className="col-12 col-md-6"><label className="form-label">From email</label>
                <input className="form-control" value={smtp.from_email || ''} onChange={(e) => setSmtp({ ...smtp, from_email: e.target.value })} /></div>
              <div className="col-12 col-md-6"><label className="form-label">From name</label>
                <input className="form-control" value={smtp.from_name || ''} onChange={(e) => setSmtp({ ...smtp, from_name: e.target.value })} /></div>
            </div>
            <div className="d-flex justify-content-between align-items-center mt-3">
              <div className="d-flex gap-2 align-items-center">
                <input className="form-control" placeholder="test@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
                <button className="btn btn-light" onClick={testSmtp} disabled={!testEmail}>Send test</button>
              </div>
              <button className="btn btn-primary" onClick={saveSmtp}>Save SMTP</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'cw' && (
        <>
        <div className="card">
          <div className="card-body">
            <h5 className="mb-3">ConnectWise Manage API</h5>
            {cwMsg && <div className="alert alert-info">{cwMsg}</div>}
            <div className="row g-2">
              <div className="col-12 col-md-8"><label className="form-label">Site URL</label>
                <input className="form-control" value={cw.site_url || ''} onChange={(e) => setCw({ ...cw, site_url: e.target.value })} placeholder="https://api-na.myconnectwise.net" /></div>
              <div className="col-12 col-md-4"><label className="form-label">Company ID</label>
                <input className="form-control" value={cw.company_id || ''} onChange={(e) => setCw({ ...cw, company_id: e.target.value })} /></div>
              <div className="col-12 col-md-6"><label className="form-label">Public Key</label>
                <input className="form-control" value={cw.public_key || ''} onChange={(e) => setCw({ ...cw, public_key: e.target.value })} /></div>
              <div className="col-12 col-md-6"><label className="form-label">Private Key</label>
                <input type="password" className="form-control" value={cw.private_key || ''} onChange={(e) => setCw({ ...cw, private_key: e.target.value })} placeholder="••••••" /></div>
              <div className="col-12 col-md-6">
                <label className="form-label">Client ID <span className="text-muted fw-normal">(optional)</span></label>
                <input className="form-control" value={cw.client_id || ''} onChange={(e) => setCw({ ...cw, client_id: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                <div className="form-text">Register at <a href="https://developer.connectwise.com" target="_blank" rel="noreferrer">developer.connectwise.com</a> to get a Client ID.</div>
              </div>
              <div className="col-12 col-md-6"><label className="form-label">Webhook URL (optional fallback)</label>
                <input className="form-control" value={cw.webhook_url || ''} onChange={(e) => setCw({ ...cw, webhook_url: e.target.value })} placeholder="https://…" /></div>
              <div className="col-12">
                <div className="form-check mt-2">
                  <input type="checkbox" className="form-check-input" id="pushOnWon" checked={!!cw.push_on_won} onChange={(e) => setCw({ ...cw, push_on_won: e.target.checked })} />
                  <label className="form-check-label" htmlFor="pushOnWon">Automatically push deals to ConnectWise when marked Won</label>
                </div>
              </div>

              <div className="col-12 mt-3">
                <h6 className="fw-semibold text-muted small text-uppercase mb-2">Opportunity Mapping</h6>
              </div>
              <div className="col-md-6">
                <label className="form-label">Sales Rep (Member ID)</label>
                <input className="form-control" value={cw.cw_member_id || ''} onChange={(e) => setCw({ ...cw, cw_member_id: e.target.value })} placeholder="e.g. jsmith" />
                <div className="form-text">Your CW member identifier — sets the Sales Rep on the opportunity so it appears under "My Opportunities".</div>
              </div>
              <div className="col-md-6">
                <label className="form-label">Stage <span className="text-muted fw-normal">(optional)</span></label>
                <input className="form-control" value={cw.cw_stage_name || ''} onChange={(e) => setCw({ ...cw, cw_stage_name: e.target.value })} placeholder="e.g. Proposal, Prospect" />
                <div className="form-text">Must match an existing stage name in your CW instance.</div>
              </div>
              <div className="col-md-4">
                <label className="form-label">Status <span className="text-muted fw-normal">(optional)</span></label>
                <input className="form-control" value={cw.cw_status_name || ''} onChange={(e) => setCw({ ...cw, cw_status_name: e.target.value })} placeholder="e.g. Open" />
              </div>
              <div className="col-md-4">
                <label className="form-label">Location ID <span className="text-muted fw-normal">(optional)</span></label>
                <input type="number" className="form-control" value={cw.cw_location_id || ''} onChange={(e) => setCw({ ...cw, cw_location_id: e.target.value })} placeholder="e.g. 2" />
              </div>
              <div className="col-md-4">
                <label className="form-label">Business Unit ID <span className="text-muted fw-normal">(optional)</span></label>
                <input type="number" className="form-control" value={cw.cw_business_unit_id || ''} onChange={(e) => setCw({ ...cw, cw_business_unit_id: e.target.value })} placeholder="e.g. 10" />
              </div>
            </div>
            <div className="d-flex justify-content-between mt-3">
              <button className="btn btn-light" onClick={testCw}>Test connection</button>
              <button className="btn btn-primary" onClick={saveCw}>Save ConnectWise</button>
            </div>
          </div>
        </div>

        <div className="card mt-3">
          <div className="card-body">
            <h5 className="mb-1">Import from ConnectWise</h5>
            <p className="text-muted small mb-3">
              Pull all Companies and Contacts from ConnectWise Manage into this CRM.
              Existing records are matched by CW ID or name/email and updated in place — new records are created.
              This operation is safe to run more than once.
            </p>
            {cwImport.msg && (
              <div className={`alert py-2 mb-3 ${cwImport.status === 'failed' ? 'alert-danger' : cwImport.status === 'completed' ? 'alert-success' : 'alert-info'}`}>
                {cwImport.msg}
              </div>
            )}
            <button className="btn btn-warning" onClick={startCwImport} disabled={cwImport.busy}>
              {cwImport.busy ? 'Importing…' : 'Import Companies & Contacts from ConnectWise'}
            </button>

            {cwImportHistory.length > 0 && (
              <div className="mt-4">
                <h6 className="fw-semibold text-muted small text-uppercase mb-2">Import History</h6>
                <table className="table table-sm">
                  <thead><tr><th>Date</th><th>Status</th><th>Orgs</th><th>Contacts</th><th>Error</th></tr></thead>
                  <tbody>
                    {cwImportHistory.map((r) => (
                      <tr key={r.id}>
                        <td className="text-nowrap">{new Date(r.started_at).toLocaleString()}</td>
                        <td>
                          <span className={`badge ${r.status === 'completed' ? 'bg-success' : r.status === 'failed' ? 'bg-danger' : 'bg-secondary'}`}>
                            {r.status}
                          </span>
                        </td>
                        <td>{r.orgs_created > 0 || r.orgs_updated > 0 ? `+${r.orgs_created} / ~${r.orgs_updated}` : '—'}</td>
                        <td>{r.contacts_created > 0 || r.contacts_updated > 0 ? `+${r.contacts_created} / ~${r.contacts_updated}` : '—'}</td>
                        <td className="text-danger small">{r.error || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {tab === 'usps' && (
        <div className="card">
          <div className="card-body">
            <h5 className="mb-1">USPS Addresses API</h5>
            <div className="small text-muted mb-3">
              OAuth2 credentials from <a href="https://developers.usps.com/apis" target="_blank" rel="noreferrer">developers.usps.com/apis</a>.
              Used to verify and standardize addresses on Contacts and Organizations.
            </div>
            {uspsMsg && <div className="alert alert-info">{uspsMsg}</div>}
            <div className="row g-2">
              <div className="col-md-12"><label className="form-label">Base URL</label>
                <input className="form-control" value={usps.base_url || ''} onChange={(e) => setUsps({ ...usps, base_url: e.target.value })} placeholder="https://apis.usps.com" /></div>
              <div className="col-md-6"><label className="form-label">Consumer Key</label>
                <input className="form-control" value={usps.consumer_key || ''} onChange={(e) => setUsps({ ...usps, consumer_key: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Consumer Secret</label>
                <input type="password" className="form-control" value={usps.consumer_secret || ''} onChange={(e) => setUsps({ ...usps, consumer_secret: e.target.value })} placeholder="••••••" /></div>
              <div className="col-12">
                <div className="form-check mt-2">
                  <input type="checkbox" className="form-check-input" id="uspsActive" checked={!!usps.is_active} onChange={(e) => setUsps({ ...usps, is_active: e.target.checked })} />
                  <label className="form-check-label" htmlFor="uspsActive">Enable USPS address verification</label>
                </div>
              </div>
            </div>
            <div className="d-flex justify-content-between mt-3">
              <button className="btn btn-light" onClick={testUsps}>Test connection</button>
              <button className="btn btn-primary" onClick={saveUsps}>Save USPS</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'pay' && (
        <div className="card">
          <div className="card-body">
            <h5 className="mb-1">Payment Gateways</h5>
            <div className="small text-muted mb-3">
              Hosted checkout keeps card data off this server, so you stay in PCI SAQ-A scope.
              Configure one or both gateways — set a default to use for customer-facing checkout.
            </div>
            {payMsg && <div className="alert alert-info">{payMsg}</div>}

            <h6 className="mt-2 fw-bold">Authorize.Net (Accept Hosted)</h6>
            <div className="row g-2 mb-3">
              <div className="col-md-3"><label className="form-label">Mode</label>
                <select className="form-select" value={authnet.mode} onChange={(e) => setAuthnet({ ...authnet, mode: e.target.value })}>
                  <option value="sandbox">sandbox</option>
                  <option value="live">live</option>
                </select></div>
              <div className="col-md-9"><label className="form-label">Display name</label>
                <input className="form-control" value={authnet.display_name || ''} onChange={(e) => setAuthnet({ ...authnet, display_name: e.target.value })} placeholder="Authorize.Net — test" /></div>
              <div className="col-md-6"><label className="form-label">API Login ID</label>
                <input className="form-control" value={authnet.api_login_id || ''} onChange={(e) => setAuthnet({ ...authnet, api_login_id: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Transaction Key</label>
                <input type="password" className="form-control" value={authnet.transaction_key || ''} onChange={(e) => setAuthnet({ ...authnet, transaction_key: e.target.value })} placeholder="••••••" /></div>
              <div className="col-md-6"><label className="form-label">Public Client Key</label>
                <input className="form-control" value={authnet.public_client_key || ''} onChange={(e) => setAuthnet({ ...authnet, public_client_key: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">Signature Key (webhook HMAC)</label>
                <input type="password" className="form-control" value={authnet.signature_key || ''} onChange={(e) => setAuthnet({ ...authnet, signature_key: e.target.value })} placeholder="••••••" /></div>
              <div className="col-12">
                <div className="form-check form-check-inline">
                  <input type="checkbox" className="form-check-input" id="anActive" checked={!!authnet.is_active} onChange={(e) => setAuthnet({ ...authnet, is_active: e.target.checked })} />
                  <label className="form-check-label" htmlFor="anActive">Active</label>
                </div>
                <div className="form-check form-check-inline">
                  <input type="checkbox" className="form-check-input" id="anDefault" checked={!!authnet.is_default} onChange={(e) => setAuthnet({ ...authnet, is_default: e.target.checked })} />
                  <label className="form-check-label" htmlFor="anDefault">Use as default</label>
                </div>
              </div>
            </div>

            <B2BPanel id="an" cfg={authnet} set={setAuthnet} />
            <QuickBooksPanel id="an" cfg={authnet} set={setAuthnet} />

            <hr />

            <h6 className="mt-2 fw-bold">Valor PayTech (Hosted Checkout)</h6>
            <div className="row g-2 mb-3">
              <div className="col-md-3"><label className="form-label">Mode</label>
                <select className="form-select" value={valor.mode} onChange={(e) => setValor({ ...valor, mode: e.target.value })}>
                  <option value="sandbox">sandbox</option>
                  <option value="live">live</option>
                </select></div>
              <div className="col-md-9"><label className="form-label">Display name</label>
                <input className="form-control" value={valor.display_name || ''} onChange={(e) => setValor({ ...valor, display_name: e.target.value })} placeholder="Valor PayTech — test" /></div>
              <div className="col-md-6"><label className="form-label">EPI ID (merchant)</label>
                <input className="form-control" value={valor.epi_id || ''} onChange={(e) => setValor({ ...valor, epi_id: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">API Key</label>
                <input type="password" className="form-control" value={valor.api_key || ''} onChange={(e) => setValor({ ...valor, api_key: e.target.value })} placeholder="••••••" /></div>
              <div className="col-md-6"><label className="form-label">App ID</label>
                <input className="form-control" value={valor.app_id || ''} onChange={(e) => setValor({ ...valor, app_id: e.target.value })} /></div>
              <div className="col-md-6"><label className="form-label">App Key</label>
                <input type="password" className="form-control" value={valor.app_key || ''} onChange={(e) => setValor({ ...valor, app_key: e.target.value })} placeholder="••••••" /></div>
              <div className="col-12"><label className="form-label">Webhook secret (IPN HMAC)</label>
                <input type="password" className="form-control" value={valor.webhook_secret || ''} onChange={(e) => setValor({ ...valor, webhook_secret: e.target.value })} placeholder="••••••" /></div>
              <div className="col-12">
                <div className="form-check form-check-inline">
                  <input type="checkbox" className="form-check-input" id="vActive" checked={!!valor.is_active} onChange={(e) => setValor({ ...valor, is_active: e.target.checked })} />
                  <label className="form-check-label" htmlFor="vActive">Active</label>
                </div>
                <div className="form-check form-check-inline">
                  <input type="checkbox" className="form-check-input" id="vDefault" checked={!!valor.is_default} onChange={(e) => setValor({ ...valor, is_default: e.target.checked })} />
                  <label className="form-check-label" htmlFor="vDefault">Use as default</label>
                </div>
              </div>
            </div>

            <B2BPanel id="v" cfg={valor} set={setValor} />
            <QuickBooksPanel id="v" cfg={valor} set={setValor} />

            <div className="mt-3 p-3" style={{ background: '#FAF5F0', borderRadius: 8 }}>
              <div className="d-flex align-items-center mb-2">
                <iconify-icon icon="solar:card-transfer-line-duotone" class="me-2" style={{ fontSize: 20 }}></iconify-icon>
                <strong>ACH (Bank Account) Payments</strong>
              </div>
              <div className="small text-muted mb-2">
                Lets payers choose a bank account instead of a card, wherever this
                app currently offers card payment. Off by default.
              </div>
              <div className="form-check mb-2">
                <input type="checkbox" className="form-check-input" id="vAch"
                  checked={!!valor.ach_enabled} onChange={(e) => setValor({ ...valor, ach_enabled: e.target.checked })} />
                <label className="form-check-label" htmlFor="vAch">Enable ACH</label>
              </div>
              <label className="form-label">Authorization disclosure (shown next to the payment form)</label>
              <textarea className="form-control form-control-sm" rows="2" value={valor.ach_authorization_text || ''}
                onChange={(e) => setValor({ ...valor, ach_authorization_text: e.target.value })}
                placeholder="By providing your bank account information, you authorize Ventura County Sheriff's Foundation to debit your account for the amount indicated. This authorization remains in effect until you notify us otherwise." />
            </div>

            <div className="alert alert-light small">
              <strong>Webhook URLs</strong> — copy these into your gateway dashboard:
              <div className="mt-1"><code>&lt;your-host&gt;/api/payments/webhook/authnet</code></div>
              <div><code>&lt;your-host&gt;/api/payments/webhook/valor</code></div>
            </div>

            <BatchReconciliationPanel
              hours={reconHours} setHours={setReconHours}
              busy={reconBusy} runs={batchRuns} onRun={runReconcileNow}
            />

            <div className="d-flex justify-content-end mt-3">
              <button className="btn btn-primary" onClick={savePayments}>Save Payment Gateways</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'sms' && (
        <div className="card">
          <div className="card-body">
            <div className="d-flex align-items-center gap-2 mb-1">
              <iconify-icon icon="solar:phone-calling-rounded-line-duotone" style={{ fontSize: 22, color: 'var(--secondary)' }}></iconify-icon>
              <h5 className="mb-0">Twilio SMS Configuration</h5>
            </div>
            <p className="text-muted small mb-3">
              Connect Twilio to send SMS messages from contacts, deals, campaigns, and automations.
              Set provider to <strong>Twilio</strong> and enter your credentials from the
              <a href="https://console.twilio.com" target="_blank" rel="noreferrer"> Twilio Console</a>.
            </p>

            {smsMsg && (
              <div className={`alert ${smsMsg.includes('saved') || smsMsg.includes('sent') ? 'alert-success' : 'alert-info'} d-flex align-items-center gap-2`}>
                <iconify-icon icon={smsMsg.includes('saved') || smsMsg.includes('sent') ? 'solar:check-circle-line-duotone' : 'solar:info-circle-line-duotone'}></iconify-icon>
                {smsMsg}
              </div>
            )}

            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Provider</label>
                <select className="form-select" value={sms.provider} onChange={(e) => setSms({ ...sms, provider: e.target.value })}>
                  <option value="dryrun">Dry-run (log only, no real SMS)</option>
                  <option value="twilio">Twilio</option>
                </select>
                <div className="form-text">Dry-run logs all sends without calling Twilio — useful for testing.</div>
              </div>
              <div className="col-md-4 d-flex align-items-end">
                <div className="form-check form-switch pb-2">
                  <input type="checkbox" className="form-check-input" id="smsActive"
                    checked={!!sms.is_active} onChange={(e) => setSms({ ...sms, is_active: e.target.checked })} />
                  <label className="form-check-label" htmlFor="smsActive">Active</label>
                </div>
              </div>
            </div>

            {sms.provider === 'twilio' && (
              <div className="row g-3 mt-1">
                <div className="col-12">
                  <div className="alert alert-light border d-flex gap-3 align-items-start py-2 mb-0">
                    <iconify-icon icon="solar:info-circle-line-duotone" class="mt-1 flex-shrink-0" style={{ color: 'var(--secondary)' }}></iconify-icon>
                    <div className="small">
                      <strong>Auth Token credentials</strong> — use Account SID (<code>AC…</code>) + Auth Token from the Twilio Console dashboard.<br/>
                      <strong>API Key credentials</strong> — use Account SID (<code>AC…</code>) + API Key SID (<code>SK…</code>) + API Key Secret from <em>Console → Account → API keys</em>.
                    </div>
                  </div>
                </div>
                <div className="col-md-6">
                  <label className="form-label">Account SID <span className="text-danger">*</span></label>
                  <input className="form-control" value={sms.account_sid || ''} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    onChange={(e) => setSms({ ...sms, account_sid: e.target.value })} />
                  <div className="form-text">Always starts with <code>AC</code> — on your Console dashboard.</div>
                </div>
                <div className="col-md-6">
                  <label className="form-label">API Key SID <span className="text-muted">(optional)</span></label>
                  <input className="form-control" value={sms.api_key_sid || ''} placeholder="SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    onChange={(e) => setSms({ ...sms, api_key_sid: e.target.value })} />
                  <div className="form-text">Only if using API Key auth. Starts with <code>SK</code>. Leave blank to use Auth Token.</div>
                </div>
                <div className="col-md-6">
                  <label className="form-label">{sms.api_key_sid ? 'API Key Secret' : 'Auth Token'} <span className="text-danger">*</span></label>
                  <SmsTokenField
                    label={sms.api_key_sid ? 'API Key Secret' : 'Auth Token'}
                    value={sms.auth_token || ''}
                    onChange={(v) => setSms({ ...sms, auth_token: v })}
                  />
                  <div className="form-text">{sms.api_key_sid ? 'The secret for the API Key above.' : '32-character hex string from your Twilio Console dashboard.'}</div>
                </div>
                <div className="col-md-6">
                  <label className="form-label">From Number <span className="text-danger">*</span></label>
                  <input className="form-control" value={sms.from_number || ''} placeholder="+15551234567"
                    onChange={(e) => setSms({ ...sms, from_number: e.target.value })} />
                  <div className="form-text">Your Twilio phone number in E.164 format.</div>
                </div>
              </div>
            )}

            <div className="mt-3 p-3 bg-body-tertiary rounded">
              <div className="d-flex align-items-center gap-2 mb-2">
                <iconify-icon icon="solar:link-round-angle-line-duotone" style={{ color: 'var(--secondary)' }}></iconify-icon>
                <strong className="small">Inbound Webhook URL</strong>
              </div>
              <div className="small text-muted mb-2">
                Set this as the webhook URL in your Twilio phone number settings to receive inbound SMS messages.
              </div>
              <div className="input-group input-group-sm">
                <input className="form-control font-monospace bg-white"
                  readOnly
                  value={`${window.location.origin.replace('5173','4000')}/api/sms/webhook/twilio`} />
                <button className="btn btn-outline-secondary"
                  onClick={() => navigator.clipboard.writeText(`${window.location.origin.replace('5173','4000')}/api/sms/webhook/twilio`)}>
                  Copy
                </button>
              </div>
            </div>

            <div className="mt-3 p-3 d-flex align-items-center gap-2" style={{ background: '#FAF5F0', borderRadius: 8 }}>
              <iconify-icon icon="solar:chat-round-money-line-duotone" style={{ fontSize: 20 }}></iconify-icon>
              <div className="small">
                <strong>Text to Give</strong> settings have moved — configure the keyword, landing page,
                and reply messages under <a href="/admin/donations/text-to-give">Fundraising → Text to Give</a>.
              </div>
            </div>

            <div className="d-flex gap-2 mt-3 flex-wrap align-items-center">
              <button className="btn btn-primary" onClick={saveSms}>Save</button>
              <input className="form-control" placeholder="+15551234567 (test to)"
                value={testSmsTo} onChange={(e) => setTestSmsTo(e.target.value)} />
              <button className="btn btn-outline-secondary" onClick={testSms}>Send Test SMS</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'google' && (
        <div className="card">
          <div className="card-body">
            <h5 className="mb-1">Google Workspace</h5>
            <p className="text-muted small mb-4">
              Connect your Google account to enable Calendar sync and Google Drive file linking.
              Each user connects their own account — credentials are stored per user.
            </p>

            {googleMsg && (
              <div className={`alert ${googleMsg.startsWith('Google error') ? 'alert-danger' : 'alert-success'} py-2 mb-3`}>
                {googleMsg}
              </div>
            )}

            {google === null && <div className="text-muted small">Loading…</div>}

            {google && !google.connected && (
              <div className="d-flex align-items-center gap-3 p-3 border rounded" style={{ maxWidth: 480 }}>
                <iconify-icon icon="logos:google" style={{ fontSize: 32 }}></iconify-icon>
                <div className="flex-grow-1">
                  <div className="fw-semibold">Not connected</div>
                  <div className="text-muted small">Click to authorize access to Calendar and Drive.</div>
                </div>
                <button className="btn btn-primary" onClick={connectGoogle} disabled={googleBusy}>
                  {googleBusy ? 'Redirecting…' : 'Connect Google'}
                </button>
              </div>
            )}

            {google && google.connected && (
              <div className="d-flex align-items-center gap-3 p-3 border border-success rounded" style={{ maxWidth: 480 }}>
                <iconify-icon icon="logos:google" style={{ fontSize: 32 }}></iconify-icon>
                <div className="flex-grow-1">
                  <div className="fw-semibold text-success">Connected</div>
                  <div className="text-muted small">{google.google_email}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>
                    Scopes: Calendar · Drive (read-only)
                  </div>
                </div>
                <button className="btn btn-outline-danger btn-sm" onClick={disconnectGoogle} disabled={googleBusy}>
                  Disconnect
                </button>
              </div>
            )}

            <hr className="my-4" />
            <h6 className="mb-1">Setup Instructions</h6>
            <ol className="small text-muted ps-3 mb-0" style={{ lineHeight: 2 }}>
              <li>Go to <strong>Google Cloud Console</strong> → APIs &amp; Services → Credentials</li>
              <li>Create an <strong>OAuth 2.0 Client ID</strong> (Web application)</li>
              <li>Add authorized redirect URI: <code>{GOOGLE_REDIRECT_URI}</code></li>
              <li>Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>GOOGLE_REDIRECT_URI</code> (the URI above) in the server's environment — <code>server/.env</code> locally, or the hosting platform's environment variables in production</li>
              <li>Enable <strong>Google Calendar API</strong> and <strong>Google Drive API</strong> in the API Library</li>
              <li>Restart the server, then click "Connect Google" above</li>
            </ol>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="card">
          <div className="card-body">
            <div className="d-flex align-items-center gap-2 mb-1">
              <iconify-icon icon="solar:stars-line-duotone" style={{ fontSize: 24, color: 'var(--secondary)' }}></iconify-icon>
              <h5 className="mb-0">AI Assistant</h5>
            </div>
            <p className="text-muted small mb-4">
              Powered by Anthropic Claude. Add your API key to enable the AI chat assistant.
              Without a key, the assistant panel shows a searchable knowledge base instead.
            </p>

            {aiMsg && (
              <div className={`alert py-2 mb-3 ${aiMsg.includes('success') || aiMsg.includes('saved') ? 'alert-success' : aiMsg.includes('failed') || aiMsg.includes('error') ? 'alert-danger' : 'alert-info'}`}>
                {aiMsg}
              </div>
            )}

            <div className="row g-3" style={{ maxWidth: 640 }}>
              <div className="col-12">
                <label className="form-label">Anthropic API Key</label>
                <input
                  type="password"
                  className="form-control font-monospace"
                  value={ai.api_key || ''}
                  onChange={(e) => setAi({ ...ai, api_key: e.target.value })}
                  placeholder="sk-ant-…"
                  autoComplete="off"
                />
                <div className="form-text">
                  Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>. Stored securely in the database.
                </div>
              </div>
              <div className="col-md-8">
                <label className="form-label">Model</label>
                <select className="form-select" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })}>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 — fastest, lowest cost (recommended)</option>
                  <option value="claude-sonnet-4-6">Claude Sonnet 4.6 — higher quality, moderate cost</option>
                </select>
              </div>
              <div className="col-md-4 d-flex align-items-end pb-1">
                <div className="form-check">
                  <input type="checkbox" className="form-check-input" id="aiActive"
                    checked={!!ai.active} onChange={(e) => setAi({ ...ai, active: e.target.checked })} />
                  <label className="form-check-label" htmlFor="aiActive">Active</label>
                </div>
              </div>
            </div>

            <div className="d-flex gap-2 mt-3">
              <button className="btn btn-primary" onClick={saveAi}>Save</button>
              <button className="btn btn-outline-secondary" onClick={testAi} disabled={aiTesting}>
                {aiTesting ? 'Testing…' : 'Test Connection'}
              </button>
            </div>

            <hr className="my-4" />
            <h6 className="mb-2">Knowledge Base</h6>
            <p className="text-muted small mb-2">
              The assistant uses your knowledge base articles to answer questions. Manage articles under{' '}
              <a href="/admin/ai-kb">Admin → AI Knowledge Base</a>.
            </p>
            <div className="d-flex gap-2">
              <a className="btn btn-outline-primary btn-sm" href="/admin/ai-kb">Manage Knowledge Base →</a>
            </div>
          </div>
        </div>
      )}

      {tab === 'log' && (
        <div className="card">
          <div className="card-body">
            <h5 className="mb-3">ConnectWise Sync Log</h5>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead><tr><th>When</th><th>Action</th><th>Deal</th><th>CW Opp ID</th><th>Status</th><th>Message</th></tr></thead>
                <tbody>
                  {syncLog.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.created_at).toLocaleString()}</td>
                      <td>{e.action}</td>
                      <td>{e.deal_id ? <a href={`/deals/${e.deal_id}`}>#{e.deal_id}</a> : '—'}</td>
                      <td>{e.cw_opportunity_id || '—'}</td>
                      <td><span className={`badge bg-${e.status === 'success' ? 'success' : 'danger'}-subtle text-${e.status === 'success' ? 'success' : 'danger'}`}>{e.status}</span></td>
                      <td className="small text-muted">{e.message}</td>
                    </tr>
                  ))}
                  {syncLog.length === 0 && <tr><td colSpan="6"><div className="empty-state">No sync events yet.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

// =============================================================================
// B2BPanel — per-gateway Level 2 / Level 3 + processing-fee configuration.
// Rendered inside each gateway card in Settings → Payment Gateways.
// =============================================================================
function B2BPanel({ id, cfg, set }) {
  const on = (k) => (e) => set({ ...cfg, [k]: e.target.checked });
  const val = (k) => (e) => set({ ...cfg, [k]: e.target.value });
  const num = (k) => (e) => set({ ...cfg, [k]: e.target.value === '' ? 0 : Number(e.target.value) });

  return (
    <div className="mt-3 p-3" style={{ background: '#FAF5F0', borderRadius: 8 }}>
      <div className="d-flex align-items-center mb-2">
        <iconify-icon icon="solar:shop-line-duotone" class="me-2" style={{ fontSize: 20 }}></iconify-icon>
        <strong>B2B Commercial-Card Data & Processing Fees</strong>
      </div>
      <div className="small text-muted mb-3">
        Send Level 2 / Level 3 data on qualifying commercial cards to earn lower interchange.
        Optionally add a surcharge or convenience/service fee at checkout (credit-card only by default —
        required for card-brand compliance).
      </div>

      <div className="row g-2">
        <div className="col-12">
          <div className="form-check form-check-inline">
            <input type="checkbox" className="form-check-input" id={`${id}-l2`}
              disabled={!cfg.supports_l2}
              checked={!!cfg.l2_enabled} onChange={on('l2_enabled')} />
            <label className="form-check-label" htmlFor={`${id}-l2`}>Send Level 2 data (tax + PO)</label>
          </div>
          <div className="form-check form-check-inline">
            <input type="checkbox" className="form-check-input" id={`${id}-l3`}
              disabled={!cfg.supports_l3}
              checked={!!cfg.l3_enabled} onChange={on('l3_enabled')} />
            <label className="form-check-label" htmlFor={`${id}-l3`}>Send Level 3 line items</label>
          </div>
          <div className="form-check form-check-inline">
            <input type="checkbox" className="form-check-input" id={`${id}-b2b`}
              checked={!!cfg.b2b_only} onChange={on('b2b_only')} />
            <label className="form-check-label" htmlFor={`${id}-b2b`}>B2B only (only when invoice is billed to an org)</label>
          </div>
        </div>

        <div className="col-md-4"><label className="form-label">Merchant tax ID</label>
          <input className="form-control form-control-sm" value={cfg.merchant_tax_id || ''} onChange={val('merchant_tax_id')} placeholder="Optional" /></div>
        <div className="col-md-4"><label className="form-label">Summary commodity code</label>
          <input className="form-control form-control-sm" value={cfg.summary_commodity_code || ''} onChange={val('summary_commodity_code')} placeholder="e.g. 7372" /></div>
        <div className="col-md-4"><label className="form-label">Default line-item commodity code</label>
          <input className="form-control form-control-sm" value={cfg.default_commodity_code || ''} onChange={val('default_commodity_code')} placeholder="fallback if line has none" /></div>
      </div>

      <hr className="my-3" />

      <div className="row g-2">
        <div className="col-md-3"><label className="form-label">Fee mode</label>
          <select className="form-select form-select-sm" value={cfg.fee_mode || 'none'} onChange={val('fee_mode')}
            disabled={!cfg.supports_surcharge}>
            <option value="none">None</option>
            <option value="surcharge">Surcharge (credit only)</option>
            <option value="convenience_fee">Convenience fee</option>
            <option value="service_fee">Service fee</option>
          </select></div>
        <div className="col-md-2"><label className="form-label">Percent</label>
          <div className="input-group input-group-sm">
            <input type="number" step="0.001" min="0" max="100" className="form-control"
              value={cfg.fee_percent ?? 0} onChange={num('fee_percent')} disabled={cfg.fee_mode === 'none'} />
            <span className="input-group-text">%</span>
          </div></div>
        <div className="col-md-2"><label className="form-label">Fixed</label>
          <div className="input-group input-group-sm">
            <span className="input-group-text">$</span>
            <input type="number" step="0.01" min="0" className="form-control"
              value={cfg.fee_fixed ?? 0} onChange={num('fee_fixed')} disabled={cfg.fee_mode === 'none'} />
          </div></div>
        <div className="col-md-2"><label className="form-label">Applies to</label>
          <select className="form-select form-select-sm" value={cfg.fee_applies_to || 'credit_only'} onChange={val('fee_applies_to')} disabled={cfg.fee_mode === 'none'}>
            <option value="credit_only">Credit only</option>
            <option value="credit_and_debit">Credit + debit</option>
            <option value="all">All cards</option>
          </select></div>
        <div className="col-md-3"><label className="form-label">Label shown to payer</label>
          <input className="form-control form-control-sm" value={cfg.fee_label || ''} onChange={val('fee_label')} disabled={cfg.fee_mode === 'none'} placeholder="Processing Fee" /></div>
        <div className="col-12"><label className="form-label">Disclosure text</label>
          <textarea className="form-control form-control-sm" rows="2" value={cfg.fee_disclosure || ''} onChange={val('fee_disclosure')} disabled={cfg.fee_mode === 'none'}
            placeholder="A merchant processing fee is added when paying by card. This is not a fee charged by your card issuer." />
          <div className="form-text">
            Shown on the checkout page. Required for surcharge compliance in most US states.
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// QuickBooksPanel — per-gateway QuickBooks Online sync toggle.
// Both Valor and Authorize.Net offer QuickBooks integration. When the toggle
// is OFF for a merchant, we don't send ANY QuickBooks-related fields with the
// gateway request — sending QB fields to a non-QB merchant produces noisy
// errors and pollutes the transaction record. Realm ID is optional: some
// integrations bind QB at the merchant-account level (no per-request id
// needed); others want the QuickBooks Online company id sent with each txn.
// =============================================================================
function QuickBooksPanel({ id, cfg, set }) {
  const enabled = !!cfg.quickbooks_enabled;
  return (
    <div className="mt-3 p-3" style={{ background: '#F0F7F4', borderRadius: 8 }}>
      <div className="d-flex align-items-center mb-2">
        <iconify-icon icon="solar:notebook-bookmark-line-duotone" class="me-2" style={{ fontSize: 20 }}></iconify-icon>
        <strong>QuickBooks Online Sync</strong>
      </div>
      <div className="small text-muted mb-3">
        When enabled, payment requests sent to this gateway include QuickBooks sync flags so the
        transaction is recorded against your QuickBooks Online account. Leave this off if the merchant
        does not use QuickBooks — sending QB fields to a non-QB merchant causes gateway errors.
      </div>

      <div className="row g-2 align-items-end">
        <div className="col-md-12">
          <div className="form-check form-switch">
            <input
              type="checkbox"
              className="form-check-input"
              id={`${id}-qb-enabled`}
              checked={enabled}
              onChange={(e) => set({ ...cfg, quickbooks_enabled: e.target.checked })}
            />
            <label className="form-check-label" htmlFor={`${id}-qb-enabled`}>
              <strong>Enable QuickBooks sync for this gateway</strong>
            </label>
          </div>
        </div>
        <div className="col-md-6">
          <label className="form-label">QuickBooks Realm ID <span className="text-muted">(optional)</span></label>
          <input
            className="form-control form-control-sm"
            value={cfg.quickbooks_realm_id || ''}
            onChange={(e) => set({ ...cfg, quickbooks_realm_id: e.target.value })}
            placeholder="e.g. 9341452123456789"
            disabled={!enabled}
          />
          <div className="form-text">
            Your QuickBooks Online <em>company id</em>. Only required if your gateway integration
            binds QB per-request rather than per-merchant.
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// BatchReconciliationPanel — kick the settled-batch reconciliation job and
// show a history of recent runs.
//
// The same job runs automatically every night at ~3:30 AM. Admins can also
// trigger it on demand here — useful for catching up after a webhook outage,
// or simply to confirm yesterday's pending payments did settle.
// =============================================================================
function BatchReconciliationPanel({ hours, setHours, busy, runs, onRun }) {
  const fmt = (d) => d ? new Date(d).toLocaleString() : '—';
  const badge = (s) => {
    const map = {
      success: 'success', partial: 'warning', failed: 'danger', running: 'secondary',
    };
    const cls = map[s] || 'secondary';
    return <span className={`badge bg-${cls}-subtle text-${cls}`}>{s}</span>;
  };
  return (
    <div className="mt-3 p-3" style={{ background: '#F4F0FA', borderRadius: 8 }}>
      <div className="d-flex align-items-center mb-2">
        <iconify-icon icon="solar:refresh-circle-line-duotone" class="me-2" style={{ fontSize: 20 }}></iconify-icon>
        <strong>Batch Settlement Reconciliation</strong>
      </div>
      <div className="small text-muted mb-3">
        Runs automatically every night at ~3:30 AM to flip yesterday's pending payments to <em>captured</em>
        once the gateway closes its merchant batch. You can trigger a run on-demand below — useful after
        a webhook outage, or to confirm a recent batch settled.
      </div>

      <div className="row g-2 align-items-end mb-3">
        <div className="col-md-3">
          <label className="form-label">Look back (hours)</label>
          <input
            type="number" min="1" max="168"
            className="form-control form-control-sm"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value) || 48)}
            disabled={busy}
          />
          <div className="form-text">Default 48h. Max 168h (7 days).</div>
        </div>
        <div className="col-md-3">
          <button className="btn btn-light w-100" onClick={onRun} disabled={busy}>
            {busy
              ? <><span className="spinner-border spinner-border-sm me-2" />Reconciling…</>
              : <>Reconcile now</>}
          </button>
        </div>
      </div>

      <div className="table-responsive" style={{ maxHeight: 280 }}>
        <table className="table table-sm align-middle mb-0">
          <thead className="sticky-top bg-white">
            <tr>
              <th>Started</th>
              <th>Gateway</th>
              <th>Trigger</th>
              <th>Status</th>
              <th className="text-end">Batches</th>
              <th className="text-end">Txns</th>
              <th className="text-end">Matched</th>
              <th className="text-end">Unmatched</th>
              <th>Window</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr><td colSpan="9"><div className="empty-state">No reconciliation runs yet.</div></td></tr>
            )}
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="small">{fmt(r.started_at)}</td>
                <td><span className="badge bg-light text-dark">{r.gateway}{r.mode ? ` · ${r.mode}` : ''}</span></td>
                <td className="small text-muted">{r.trigger_kind}</td>
                <td>{badge(r.status)}</td>
                <td className="text-end">{r.batches_seen}</td>
                <td className="text-end">{r.txns_seen}</td>
                <td className="text-end">{r.txns_matched}</td>
                <td className="text-end">{r.txns_unmatched}</td>
                <td className="small text-muted">
                  {fmt(r.window_start)} → {fmt(r.window_end)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {runs.some((r) => r.error_message) && (
        <div className="mt-2">
          <div className="small fw-bold text-danger">Recent errors</div>
          {runs.filter((r) => r.error_message).slice(0, 5).map((r) => (
            <div key={`err-${r.id}`} className="small text-muted">
              <code>{r.gateway}</code> @ {fmt(r.started_at)}: {r.error_message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
