import { useEffect, useRef, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useTheme } from '../../theme/ThemeContext.jsx';
import PhoneInput from '../../components/PhoneInput.jsx';
import MediaPickerModal from '../../components/MediaPickerModal.jsx';

// Relative `/api/...` logo URLs are same-origin only in local dev (where Vite
// proxies /api) — in a split deploy (Vercel client + Railway API) they need
// the API origin prefixed to actually resolve.
const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
function resolveLogoUrl(url) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

// ─────────────────────────────────────────────────────────────
// Logo upload helper — picks from the shared Media Library rather than a
// bespoke direct-upload endpoint, so logos are just media-library assets
// like any other image used across the site.
// ─────────────────────────────────────────────────────────────
function LogoUploadField({ slot, url, error, onUrlChange }) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <div>
      {url && (
        <div className="mb-2 rounded border bg-white" style={{ width: 270, padding: '10px' }}>
          <img
            src={resolveLogoUrl(url)}
            alt={`${slot} logo preview`}
            style={{ display: 'block', width: '100%', height: 'auto' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        </div>
      )}
      <div className="d-flex gap-2 mb-1">
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowPicker(true)}>
          <iconify-icon icon="solar:gallery-wide-line-duotone" class="me-1"></iconify-icon>
          Choose from Library
        </button>
        {url && (
          <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => onUrlChange('')} title="Remove">
            <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
          </button>
        )}
      </div>
      <input
        type="text"
        className="form-control form-control-sm mt-1"
        value={url || ''}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="Or paste an external URL…"
      />
      {error && <div className="form-text text-danger">{error}</div>}
      <MediaPickerModal
        show={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(file) => onUrlChange(file.file_url)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Invoices settings tab
// ─────────────────────────────────────────────────────────────
const INV_DEFAULTS = {
  invoice_prefix:        'INV',
  default_terms:         'net30',
  default_memo:          '',
  default_footer:        '',
  auto_send_on_create:   false,
  reminder_enabled:      false,
  reminder_days_before:  [7, 1],
  reminder_days_after:   [3, 7],
  late_fee_enabled:      false,
  late_fee_type:         'percent',
  late_fee_amount:       0,
  late_fee_grace_days:   5,
  allow_partial_payments: true,
  require_po_number:     false,
  default_currency:      'USD',
  auto_void_days:        null,
};

function InvoiceSettingsTab() {
  const [cfg, setCfg]     = useState(INV_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState('');
  const [msgType, setMsgType] = useState('success');

  useEffect(() => {
    api.get('/settings/module/invoices')
      .then((r) => setCfg({ ...INV_DEFAULTS, ...r.data }))
      .catch(() => {});
  }, []);

  function set(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.value }));
  }
  function setCheck(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.checked }));
  }
  function setDaysArray(field) {
    return (e) => {
      const arr = e.target.value
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((n) => !isNaN(n));
      setCfg((c) => ({ ...c, [field]: arr }));
    };
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const payload = {
        ...cfg,
        late_fee_amount:  Number(cfg.late_fee_amount) || 0,
        late_fee_grace_days: Number(cfg.late_fee_grace_days) || 0,
        auto_void_days: cfg.auto_void_days === '' || cfg.auto_void_days === null
          ? null : Number(cfg.auto_void_days),
      };
      await api.put('/settings/module/invoices', payload);
      setMsg('Invoice settings saved.');
      setMsgType('success');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Save failed.');
      setMsgType('danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      {/* Numbering & Defaults */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:document-text-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Numbering &amp; Defaults</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-3">
              <label className="form-label">Invoice Prefix</label>
              <input
                className="form-control font-monospace"
                value={cfg.invoice_prefix}
                onChange={set('invoice_prefix')}
                placeholder="INV"
                maxLength={10}
              />
              <div className="form-text">e.g. INV → INV-2025-0001</div>
            </div>
            <div className="col-md-3">
              <label className="form-label">Default Payment Terms</label>
              <select className="form-select" value={cfg.default_terms} onChange={set('default_terms')}>
                <option value="due_on_receipt">Due on Receipt</option>
                <option value="net15">Net 15</option>
                <option value="net30">Net 30</option>
                <option value="net60">Net 60</option>
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Default Currency</label>
              <select className="form-select" value={cfg.default_currency} onChange={set('default_currency')}>
                <option value="USD">USD — US Dollar</option>
                <option value="CAD">CAD — Canadian Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — British Pound</option>
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label">Auto-Void After (days)</label>
              <input
                type="number"
                className="form-control"
                value={cfg.auto_void_days ?? ''}
                onChange={set('auto_void_days')}
                placeholder="Leave blank to never auto-void"
                min={1}
              />
              <div className="form-text">Blank = never.</div>
            </div>
            <div className="col-md-6">
              <label className="form-label">Default Memo</label>
              <textarea
                className="form-control"
                rows={2}
                value={cfg.default_memo}
                onChange={set('default_memo')}
                placeholder="Thank you for your business!"
              />
            </div>
            <div className="col-md-6">
              <label className="form-label">Default Footer</label>
              <textarea
                className="form-control"
                rows={2}
                value={cfg.default_footer}
                onChange={set('default_footer')}
                placeholder="Payment due upon receipt."
              />
            </div>
          </div>
        </div>
      </div>

      {/* Behavior */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:settings-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Behavior</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="auto_send_on_create"
                  checked={!!cfg.auto_send_on_create}
                  onChange={setCheck('auto_send_on_create')}
                />
                <label className="form-check-label" htmlFor="auto_send_on_create">
                  Auto-send invoice to customer when created
                </label>
              </div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="allow_partial_payments"
                  checked={!!cfg.allow_partial_payments}
                  onChange={setCheck('allow_partial_payments')}
                />
                <label className="form-check-label" htmlFor="allow_partial_payments">
                  Allow partial payments
                </label>
              </div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="require_po_number"
                  checked={!!cfg.require_po_number}
                  onChange={setCheck('require_po_number')}
                />
                <label className="form-check-label" htmlFor="require_po_number">
                  Require PO number
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reminders */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:bell-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Payment Reminders</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="reminder_enabled"
                  checked={!!cfg.reminder_enabled}
                  onChange={setCheck('reminder_enabled')}
                />
                <label className="form-check-label" htmlFor="reminder_enabled">
                  Enable payment reminder emails
                </label>
              </div>
            </div>
            <div className="col-md-6">
              <label className="form-label">Days Before Due Date</label>
              <input
                className="form-control"
                value={Array.isArray(cfg.reminder_days_before) ? cfg.reminder_days_before.join(', ') : ''}
                onChange={setDaysArray('reminder_days_before')}
                placeholder="7, 1"
                disabled={!cfg.reminder_enabled}
              />
              <div className="form-text">Comma-separated number of days (e.g. 7, 1).</div>
            </div>
            <div className="col-md-6">
              <label className="form-label">Days After Due Date (overdue)</label>
              <input
                className="form-control"
                value={Array.isArray(cfg.reminder_days_after) ? cfg.reminder_days_after.join(', ') : ''}
                onChange={setDaysArray('reminder_days_after')}
                placeholder="3, 7"
                disabled={!cfg.reminder_enabled}
              />
              <div className="form-text">Comma-separated number of days after due date.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Late Fees */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:money-bag-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Late Fees</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="late_fee_enabled"
                  checked={!!cfg.late_fee_enabled}
                  onChange={setCheck('late_fee_enabled')}
                />
                <label className="form-check-label" htmlFor="late_fee_enabled">
                  Automatically apply late fees to overdue invoices
                </label>
              </div>
            </div>
            <div className="col-md-4">
              <label className="form-label">Fee Type</label>
              <select
                className="form-select"
                value={cfg.late_fee_type}
                onChange={set('late_fee_type')}
                disabled={!cfg.late_fee_enabled}
              >
                <option value="percent">Percentage of balance</option>
                <option value="flat">Flat dollar amount</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">
                {cfg.late_fee_type === 'percent' ? 'Rate (%)' : 'Amount ($)'}
              </label>
              <input
                type="number"
                className="form-control"
                value={cfg.late_fee_amount}
                onChange={set('late_fee_amount')}
                min={0}
                step={cfg.late_fee_type === 'percent' ? 0.01 : 1}
                disabled={!cfg.late_fee_enabled}
                placeholder="0"
              />
            </div>
            <div className="col-md-4">
              <label className="form-label">Grace Period (days)</label>
              <input
                type="number"
                className="form-control"
                value={cfg.late_fee_grace_days}
                onChange={set('late_fee_grace_days')}
                min={0}
                disabled={!cfg.late_fee_enabled}
                placeholder="5"
              />
              <div className="form-text">Days after due date before fee is applied.</div>
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} d-flex align-items-center gap-2`}>
          <iconify-icon
            icon={msgType === 'success' ? 'solar:check-circle-line-duotone' : 'solar:close-circle-line-duotone'}
            class="fs-5"
          ></iconify-icon>
          {msg}
        </div>
      )}
      <div className="d-flex justify-content-end">
        <button type="submit" className="btn btn-primary px-4" disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
            : <>Save Invoice Settings</>}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Payments settings tab
// ─────────────────────────────────────────────────────────────
const PAY_DEFAULTS = {
  auto_send_receipt:    true,
  receipt_footer:       '',
  processing_fee_label: 'Processing fee',
  allow_ach:            true,
};

function PaymentSettingsTab() {
  const [cfg, setCfg]       = useState(PAY_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState('');
  const [msgType, setMsgType] = useState('success');

  useEffect(() => {
    api.get('/settings/module/payments')
      .then((r) => setCfg({ ...PAY_DEFAULTS, ...r.data }))
      .catch(() => {});
  }, []);

  function set(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.value }));
  }
  function setCheck(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.checked }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      await api.put('/settings/module/payments', cfg);
      setMsg('Payment settings saved.');
      setMsgType('success');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Save failed.');
      setMsgType('danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      {/* Receipts */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:receipt-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Receipts</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="auto_send_receipt"
                  checked={!!cfg.auto_send_receipt}
                  onChange={setCheck('auto_send_receipt')}
                />
                <label className="form-check-label" htmlFor="auto_send_receipt">
                  Automatically send receipt email after payment is captured
                </label>
              </div>
            </div>
            <div className="col-12">
              <label className="form-label">Receipt Footer Text</label>
              <textarea
                className="form-control"
                rows={3}
                value={cfg.receipt_footer}
                onChange={set('receipt_footer')}
                placeholder="Thank you for your payment! Questions? Contact us at billing@example.com"
              />
              <div className="form-text">Appears at the bottom of every payment receipt email.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Processing */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:card-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Processing</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">Processing Fee Label</label>
              <input
                className="form-control"
                value={cfg.processing_fee_label}
                onChange={set('processing_fee_label')}
                placeholder="Processing fee"
              />
              <div className="form-text">Label shown to customers on the payment page for any surcharge.</div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="allow_ach"
                  checked={!!cfg.allow_ach}
                  onChange={setCheck('allow_ach')}
                />
                <label className="form-check-label" htmlFor="allow_ach">
                  Allow ACH / bank account payments on the customer portal
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} d-flex align-items-center gap-2`}>
          <iconify-icon
            icon={msgType === 'success' ? 'solar:check-circle-line-duotone' : 'solar:close-circle-line-duotone'}
            class="fs-5"
          ></iconify-icon>
          {msg}
        </div>
      )}
      <div className="d-flex justify-content-end">
        <button type="submit" className="btn btn-primary px-4" disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
            : <>Save Payment Settings</>}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Business tab (existing form)
// ─────────────────────────────────────────────────────────────
const BIZ_DEFAULTS = {
  business_name:    '',
  address:          '',
  city:             '',
  state:            '',
  zip:              '',
  country:          '',
  phone:            '',
  email:            '',
  website:          '',
  primary_color:    '#F05523',
  secondary_color:  '#1A1A1A',
  logo_web_url:     '',
  logo_print_url:   '',
  alert_emails:     [],
  default_tax_rate: '',
  tax_state:        '',
  tax_id_number:    '',
};

function BusinessTab() {
  const { refreshTheme } = useTheme();
  const [form, setForm]           = useState(BIZ_DEFAULTS);
  const [alertInput, setAlertInput] = useState('');
  const [msg, setMsg]             = useState('');
  const [msgType, setMsgType]     = useState('success');
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    api.get('/settings/business')
      .then((r) => {
        const d = r.data || {};
        setForm({ ...BIZ_DEFAULTS, ...d, alert_emails: Array.isArray(d.alert_emails) ? d.alert_emails : [] });
        setAlertInput((Array.isArray(d.alert_emails) ? d.alert_emails : []).join(', '));
      })
      .catch(() => {});
  }, []);

  function set(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    const alert_emails = alertInput.split(',').map((x) => x.trim()).filter(Boolean);
    try {
      await api.put('/settings/business', { ...form, alert_emails });
      refreshTheme();
      setMsg('Business settings saved successfully.');
      setMsgType('success');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to save settings.');
      setMsgType('danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      {/* Business Profile */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:buildings-2-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Business Profile</strong>
        </div>
        <div className="card-body">
          <p className="text-muted small mb-3">
            This information appears as the "From" company on invoices and receipts.
          </p>
          <div className="row g-3">
            <div className="col-12">
              <label className="form-label">Business Name</label>
              <input className="form-control" value={form.business_name} onChange={set('business_name')} placeholder="Acme Corporation" />
            </div>
            <div className="col-12">
              <label className="form-label">Street Address</label>
              <input className="form-control" value={form.address} onChange={set('address')} placeholder="123 Main St" />
            </div>
            <div className="col-md-5">
              <label className="form-label">City</label>
              <input className="form-control" value={form.city} onChange={set('city')} placeholder="Springfield" />
            </div>
            <div className="col-md-2">
              <label className="form-label">State</label>
              <input className="form-control" value={form.state} onChange={set('state')} placeholder="IL" />
            </div>
            <div className="col-md-2">
              <label className="form-label">Zip</label>
              <input className="form-control" value={form.zip} onChange={set('zip')} placeholder="62701" />
            </div>
            <div className="col-md-3">
              <label className="form-label">Country</label>
              <input className="form-control" value={form.country} onChange={set('country')} placeholder="USA" />
            </div>
            <div className="col-md-4">
              <label className="form-label">Phone</label>
              <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
            </div>
            <div className="col-md-4">
              <label className="form-label">Email</label>
              <input type="email" className="form-control" value={form.email} onChange={set('email')} placeholder="billing@example.com" />
            </div>
            <div className="col-md-4">
              <label className="form-label">Website</label>
              <input className="form-control" value={form.website} onChange={set('website')} placeholder="https://example.com" />
            </div>
          </div>
        </div>
      </div>

      {/* Branding */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:palette-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Branding</strong>
        </div>
        <div className="card-body">
          <p className="text-muted small mb-3">
            Brand colors and logos used in invoices, receipts, and the customer portal.
          </p>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">Primary Color</label>
              <div className="input-group">
                <input
                  type="color"
                  className="form-control form-control-color"
                  style={{ maxWidth: 48 }}
                  value={form.primary_color}
                  onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                />
                <input
                  className="form-control font-monospace"
                  value={form.primary_color}
                  onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                  placeholder="#F05523"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="col-md-6">
              <label className="form-label">Secondary / Accent Color</label>
              <div className="input-group">
                <input
                  type="color"
                  className="form-control form-control-color"
                  style={{ maxWidth: 48 }}
                  value={form.secondary_color}
                  onChange={(e) => setForm((f) => ({ ...f, secondary_color: e.target.value }))}
                />
                <input
                  className="form-control font-monospace"
                  value={form.secondary_color}
                  onChange={(e) => setForm((f) => ({ ...f, secondary_color: e.target.value }))}
                  placeholder="#1A1A1A"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="col-md-6">
              <label className="form-label">Logo for Web</label>
              <LogoUploadField
                slot="web"
                url={form.logo_web_url}
                onUrlChange={(v) => setForm((f) => ({ ...f, logo_web_url: v }))}
              />
              <div className="form-text">Used across the CRM, customer portal, and public site header. Click Save below to apply.</div>
            </div>
            <div className="col-md-6">
              <label className="form-label">Logo for Print / Invoices</label>
              <LogoUploadField
                slot="print"
                url={form.logo_print_url}
                onUrlChange={(v) => setForm((f) => ({ ...f, logo_print_url: v }))}
              />
              <div className="form-text">Used on invoices, receipts, and transactional emails. Click Save below to apply.</div>
            </div>
          </div>
        </div>
      </div>

      {/* System Email Alerts */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:bell-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>System Email Alerts</strong>
        </div>
        <div className="card-body">
          <p className="text-muted small mb-3">
            These addresses receive system notifications such as payment received and new invoice created.
            Enter multiple addresses separated by commas.
          </p>
          <div className="row g-3">
            <div className="col-12">
              <label className="form-label">Alert Email Addresses</label>
              <textarea
                className="form-control"
                rows={3}
                value={alertInput}
                onChange={(e) => setAlertInput(e.target.value)}
                placeholder="alerts@example.com, admin@example.com"
              />
              <div className="form-text">Comma-separated list of email addresses.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tax Settings */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:bill-list-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Tax Settings</strong>
        </div>
        <div className="card-body">
          <p className="text-muted small mb-3">
            Default sales tax configuration used on invoices and the Sales Tax Report.
          </p>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Default Tax Rate (%)</label>
              <input
                type="number"
                step="0.001"
                min="0"
                max="100"
                className="form-control"
                value={form.default_tax_rate}
                onChange={set('default_tax_rate')}
                placeholder="8.250"
              />
            </div>
            <div className="col-md-4">
              <label className="form-label">Tax State</label>
              <input className="form-control" value={form.tax_state} onChange={set('tax_state')} placeholder="TX" />
            </div>
            <div className="col-md-4">
              <label className="form-label">Tax ID / EIN</label>
              <input className="form-control" value={form.tax_id_number} onChange={set('tax_id_number')} placeholder="12-3456789" />
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} d-flex align-items-center gap-2`}>
          <iconify-icon
            icon={msgType === 'success' ? 'solar:check-circle-line-duotone' : 'solar:close-circle-line-duotone'}
            class="fs-5"
          ></iconify-icon>
          {msg}
        </div>
      )}
      <div className="d-flex justify-content-end">
        <button type="submit" className="btn btn-primary px-4" disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
            : <>Save Business Settings</>}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Contacts settings tab
// ─────────────────────────────────────────────────────────────
const CONTACTS_DEFAULTS = {
  default_lifecycle_stage:     'lead',
  require_email:               false,
  require_phone:               false,
  require_organization:        false,
  duplicate_detection_enabled: true,
  duplicate_fields:            ['email'],
  show_linkedin:               true,
  show_department:             true,
  default_lead_source:         '',
};

const LIFECYCLE_STAGES = [
  { value: 'lead',       label: 'Lead' },
  { value: 'mql',        label: 'MQL' },
  { value: 'sql',        label: 'SQL' },
  { value: 'customer',   label: 'Customer' },
  { value: 'evangelist', label: 'Evangelist' },
  { value: 'other',      label: 'Other' },
];

function ContactsSettingsTab() {
  const [cfg, setCfg]       = useState(CONTACTS_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState('');
  const [msgType, setMsgType] = useState('success');

  useEffect(() => {
    api.get('/settings/module/contacts')
      .then((r) => setCfg({ ...CONTACTS_DEFAULTS, ...r.data }))
      .catch(() => {});
  }, []);

  function setCheck(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.checked }));
  }
  function setVal(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.value }));
  }
  function toggleDuplicateField(field) {
    setCfg((c) => {
      const current = Array.isArray(c.duplicate_fields) ? c.duplicate_fields : [];
      const next = current.includes(field)
        ? current.filter((f) => f !== field)
        : [...current, field];
      return { ...c, duplicate_fields: next };
    });
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      await api.put('/settings/module/contacts', cfg);
      setMsg('Contact settings saved.');
      setMsgType('success');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Save failed.');
      setMsgType('danger');
    } finally {
      setSaving(false);
    }
  }

  const dupFields = Array.isArray(cfg.duplicate_fields) ? cfg.duplicate_fields : [];

  return (
    <form onSubmit={save}>
      {/* Defaults */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:user-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Defaults</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Default Lifecycle Stage</label>
              <select
                className="form-select"
                value={cfg.default_lifecycle_stage}
                onChange={setVal('default_lifecycle_stage')}
              >
                {LIFECYCLE_STAGES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <div className="form-text">Applied to new contacts when no stage is specified.</div>
            </div>
            <div className="col-md-4">
              <label className="form-label">Default Lead Source</label>
              <input
                className="form-control"
                value={cfg.default_lead_source}
                onChange={setVal('default_lead_source')}
                placeholder="e.g. Website, Referral"
              />
              <div className="form-text">Pre-fills the Lead Source field on new contacts.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Required Fields */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:shield-check-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Required Fields</strong>
        </div>
        <div className="card-body">
          <p className="text-muted small mb-3">
            Fields marked required must be filled in before a contact can be saved.
          </p>
          <div className="row g-2">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="require_email"
                  checked={!!cfg.require_email}
                  onChange={setCheck('require_email')}
                />
                <label className="form-check-label" htmlFor="require_email">Require email address</label>
              </div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="require_phone"
                  checked={!!cfg.require_phone}
                  onChange={setCheck('require_phone')}
                />
                <label className="form-check-label" htmlFor="require_phone">Require phone number</label>
              </div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="require_organization"
                  checked={!!cfg.require_organization}
                  onChange={setCheck('require_organization')}
                />
                <label className="form-check-label" htmlFor="require_organization">Require linked organization</label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Duplicate Detection */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:copy-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Duplicate Detection</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="duplicate_detection_enabled"
                  checked={!!cfg.duplicate_detection_enabled}
                  onChange={setCheck('duplicate_detection_enabled')}
                />
                <label className="form-check-label" htmlFor="duplicate_detection_enabled">
                  Warn when a potential duplicate contact is detected
                </label>
              </div>
            </div>
            <div className="col-12">
              <label className="form-label">Check for duplicates using</label>
              <div className="d-flex gap-3">
                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="dup_email"
                    checked={dupFields.includes('email')}
                    onChange={() => toggleDuplicateField('email')}
                    disabled={!cfg.duplicate_detection_enabled}
                  />
                  <label className="form-check-label" htmlFor="dup_email">Email address</label>
                </div>
                <div className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="dup_phone"
                    checked={dupFields.includes('phone')}
                    onChange={() => toggleDuplicateField('phone')}
                    disabled={!cfg.duplicate_detection_enabled}
                  />
                  <label className="form-check-label" htmlFor="dup_phone">Phone number</label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Display */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:eye-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Display</strong>
        </div>
        <div className="card-body">
          <p className="text-muted small mb-3">
            Control which optional fields appear on the contact form.
          </p>
          <div className="row g-2">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="show_linkedin"
                  checked={!!cfg.show_linkedin}
                  onChange={setCheck('show_linkedin')}
                />
                <label className="form-check-label" htmlFor="show_linkedin">Show LinkedIn URL field</label>
              </div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="show_department"
                  checked={!!cfg.show_department}
                  onChange={setCheck('show_department')}
                />
                <label className="form-check-label" htmlFor="show_department">Show Department field</label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} d-flex align-items-center gap-2`}>
          <iconify-icon
            icon={msgType === 'success' ? 'solar:check-circle-line-duotone' : 'solar:close-circle-line-duotone'}
            class="fs-5"
          ></iconify-icon>
          {msg}
        </div>
      )}
      <div className="d-flex justify-content-end">
        <button type="submit" className="btn btn-primary px-4" disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
            : <>Save Contact Settings</>}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Organizations settings tab
// ─────────────────────────────────────────────────────────────
const ORG_DEFAULTS = {
  default_owner_id:             null,
  auto_link_contacts_by_domain: false,
  require_website:              false,
  require_phone:                false,
  require_industry:             false,
  require_address:              false,
  duplicate_detection_enabled:  true,
  default_country:              '',
};

function OrganizationsSettingsTab() {
  const [cfg, setCfg]         = useState(ORG_DEFAULTS);
  const [users, setUsers]     = useState([]);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState('');
  const [msgType, setMsgType] = useState('success');

  useEffect(() => {
    api.get('/settings/module/organizations')
      .then((r) => setCfg({ ...ORG_DEFAULTS, ...r.data }))
      .catch(() => {});
    api.get('/users')
      .then((r) => setUsers(Array.isArray(r.data) ? r.data : (r.data?.users || [])))
      .catch(() => {});
  }, []);

  function setCheck(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.checked }));
  }
  function setVal(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const payload = {
        ...cfg,
        default_owner_id: cfg.default_owner_id ? Number(cfg.default_owner_id) : null,
      };
      await api.put('/settings/module/organizations', payload);
      setMsg('Organization settings saved.');
      setMsgType('success');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Save failed.');
      setMsgType('danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      {/* Defaults */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:buildings-2-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Defaults</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-5">
              <label className="form-label">Default Owner</label>
              <select
                className="form-select"
                value={cfg.default_owner_id ?? ''}
                onChange={setVal('default_owner_id')}
              >
                <option value="">— None (unassigned) —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name} ({u.email})
                  </option>
                ))}
              </select>
              <div className="form-text">Auto-assigned when a new organization is created without an owner.</div>
            </div>
            <div className="col-md-4">
              <label className="form-label">Default Country</label>
              <input
                className="form-control"
                value={cfg.default_country}
                onChange={setVal('default_country')}
                placeholder="USA"
              />
              <div className="form-text">Pre-fills the Country field on new organizations.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Auto-linking */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:link-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Contact Linking</strong>
        </div>
        <div className="card-body">
          <div className="form-check form-switch">
            <input
              className="form-check-input"
              type="checkbox"
              id="auto_link_contacts_by_domain"
              checked={!!cfg.auto_link_contacts_by_domain}
              onChange={setCheck('auto_link_contacts_by_domain')}
            />
            <label className="form-check-label" htmlFor="auto_link_contacts_by_domain">
              Auto-link contacts to an organization when their email domain matches the organization's website
            </label>
          </div>
          <div className="form-text mt-1">
            e.g. a contact with <em>jane@acme.com</em> is automatically linked to the org whose website is <em>acme.com</em>.
          </div>
        </div>
      </div>

      {/* Required Fields */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:shield-check-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Required Fields</strong>
        </div>
        <div className="card-body">
          <p className="text-muted small mb-3">
            Fields marked required must be filled in before an organization can be saved.
          </p>
          <div className="row g-2">
            {[
              { id: 'require_website',  label: 'Require website' },
              { id: 'require_phone',    label: 'Require phone number' },
              { id: 'require_industry', label: 'Require industry' },
              { id: 'require_address',  label: 'Require street address' },
            ].map(({ id, label }) => (
              <div key={id} className="col-12">
                <div className="form-check form-switch">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={id}
                    checked={!!cfg[id]}
                    onChange={setCheck(id)}
                  />
                  <label className="form-check-label" htmlFor={id}>{label}</label>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Duplicate Detection */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:copy-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Duplicate Detection</strong>
        </div>
        <div className="card-body">
          <div className="form-check form-switch">
            <input
              className="form-check-input"
              type="checkbox"
              id="org_dup_detection"
              checked={!!cfg.duplicate_detection_enabled}
              onChange={setCheck('duplicate_detection_enabled')}
            />
            <label className="form-check-label" htmlFor="org_dup_detection">
              Warn when an organization with the same name already exists
            </label>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} d-flex align-items-center gap-2`}>
          <iconify-icon
            icon={msgType === 'success' ? 'solar:check-circle-line-duotone' : 'solar:close-circle-line-duotone'}
            class="fs-5"
          ></iconify-icon>
          {msg}
        </div>
      )}
      <div className="d-flex justify-content-end">
        <button type="submit" className="btn btn-primary px-4" disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
            : <>Save Organization Settings</>}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Deals settings tab
// ─────────────────────────────────────────────────────────────
const DEALS_DEFAULTS = {
  default_pipeline_id:     null,
  default_currency:        'USD',
  default_probability:     50,
  require_amount:          false,
  require_close_date:      false,
  require_primary_contact: false,
  lost_reason_required:    false,
  auto_close_won_tasks:    false,
  auto_close_lost_tasks:   false,
};

function DealsSettingsTab() {
  const [cfg, setCfg]           = useState(DEALS_DEFAULTS);
  const [pipelines, setPipelines] = useState([]);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState('');
  const [msgType, setMsgType]   = useState('success');

  useEffect(() => {
    api.get('/settings/module/deals')
      .then((r) => setCfg({ ...DEALS_DEFAULTS, ...r.data }))
      .catch(() => {});
    api.get('/pipelines')
      .then((r) => setPipelines(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  function setCheck(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.checked }));
  }
  function setVal(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const payload = {
        ...cfg,
        default_pipeline_id: cfg.default_pipeline_id ? Number(cfg.default_pipeline_id) : null,
        default_probability:  Number(cfg.default_probability) || 0,
      };
      await api.put('/settings/module/deals', payload);
      setMsg('Deal settings saved.');
      setMsgType('success');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Save failed.');
      setMsgType('danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      {/* Defaults */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:hand-money-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Defaults</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-5">
              <label className="form-label">Default Pipeline</label>
              <select
                className="form-select"
                value={cfg.default_pipeline_id ?? ''}
                onChange={setVal('default_pipeline_id')}
              >
                <option value="">— None —</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="form-text">Pre-selects this pipeline when creating a new deal.</div>
            </div>
            <div className="col-md-3">
              <label className="form-label">Default Currency</label>
              <select
                className="form-select"
                value={cfg.default_currency}
                onChange={setVal('default_currency')}
              >
                <option value="USD">USD — US Dollar</option>
                <option value="CAD">CAD — Canadian Dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — British Pound</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">Default Probability (%)</label>
              <input
                type="number"
                className="form-control"
                value={cfg.default_probability}
                onChange={setVal('default_probability')}
                min={0}
                max={100}
                step={5}
                placeholder="50"
              />
              <div className="form-text">Applied to new deals when probability is not set.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Required Fields */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:shield-check-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Required Fields</strong>
        </div>
        <div className="card-body">
          <div className="row g-2">
            {[
              { id: 'require_amount',          label: 'Require deal amount' },
              { id: 'require_close_date',      label: 'Require expected close date' },
              { id: 'require_primary_contact', label: 'Require a primary contact' },
            ].map(({ id, label }) => (
              <div key={id} className="col-12">
                <div className="form-check form-switch">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={id}
                    checked={!!cfg[id]}
                    onChange={setCheck(id)}
                  />
                  <label className="form-check-label" htmlFor={id}>{label}</label>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Win / Loss */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:cup-star-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Win / Loss</strong>
        </div>
        <div className="card-body">
          <div className="row g-2">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="lost_reason_required"
                  checked={!!cfg.lost_reason_required}
                  onChange={setCheck('lost_reason_required')}
                />
                <label className="form-check-label" htmlFor="lost_reason_required">
                  Require a lost reason when marking a deal as lost
                </label>
              </div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="auto_close_won_tasks"
                  checked={!!cfg.auto_close_won_tasks}
                  onChange={setCheck('auto_close_won_tasks')}
                />
                <label className="form-check-label" htmlFor="auto_close_won_tasks">
                  Auto-complete open tasks when a deal is won
                </label>
              </div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="auto_close_lost_tasks"
                  checked={!!cfg.auto_close_lost_tasks}
                  onChange={setCheck('auto_close_lost_tasks')}
                />
                <label className="form-check-label" htmlFor="auto_close_lost_tasks">
                  Auto-complete open tasks when a deal is lost
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} d-flex align-items-center gap-2`}>
          <iconify-icon
            icon={msgType === 'success' ? 'solar:check-circle-line-duotone' : 'solar:close-circle-line-duotone'}
            class="fs-5"
          ></iconify-icon>
          {msg}
        </div>
      )}
      <div className="d-flex justify-content-end">
        <button type="submit" className="btn btn-primary px-4" disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
            : <>Save Deal Settings</>}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Tasks settings tab
// ─────────────────────────────────────────────────────────────
const TASKS_DEFAULTS = {
  default_due_offset_days:  3,
  default_assignee:         'creator',
  default_assignee_user_id: null,
  reminder_enabled:         true,
  reminder_hours_before:    24,
};

function TasksSettingsTab() {
  const [cfg, setCfg]       = useState(TASKS_DEFAULTS);
  const [users, setUsers]   = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState('');
  const [msgType, setMsgType] = useState('success');

  useEffect(() => {
    api.get('/settings/module/tasks')
      .then((r) => setCfg({ ...TASKS_DEFAULTS, ...r.data }))
      .catch(() => {});
    api.get('/users')
      .then((r) => setUsers(Array.isArray(r.data) ? r.data : (r.data?.users || [])))
      .catch(() => {});
  }, []);

  function setCheck(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.checked }));
  }
  function setVal(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const payload = {
        ...cfg,
        default_due_offset_days:  Number(cfg.default_due_offset_days) || 0,
        reminder_hours_before:    Number(cfg.reminder_hours_before) || 0,
        default_assignee_user_id: cfg.default_assignee_user_id ? Number(cfg.default_assignee_user_id) : null,
      };
      await api.put('/settings/module/tasks', payload);
      setMsg('Task settings saved.');
      setMsgType('success');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Save failed.');
      setMsgType('danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      {/* Defaults */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:checklist-minimalistic-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Defaults</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Default Due Date Offset (days)</label>
              <input
                type="number"
                className="form-control"
                value={cfg.default_due_offset_days}
                onChange={setVal('default_due_offset_days')}
                min={0}
                placeholder="3"
              />
              <div className="form-text">New tasks pre-fill the due date this many days from today.</div>
            </div>
            <div className="col-md-4">
              <label className="form-label">Default Assignee</label>
              <select className="form-select" value={cfg.default_assignee} onChange={setVal('default_assignee')}>
                <option value="creator">Task creator</option>
                <option value="specific_user">Specific user</option>
                <option value="unassigned">Unassigned</option>
              </select>
            </div>
            {cfg.default_assignee === 'specific_user' && (
              <div className="col-md-4">
                <label className="form-label">Assign To</label>
                <select
                  className="form-select"
                  value={cfg.default_assignee_user_id ?? ''}
                  onChange={setVal('default_assignee_user_id')}
                >
                  <option value="">— Select user —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reminders */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:bell-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Reminders</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="task_reminder_enabled"
                  checked={!!cfg.reminder_enabled}
                  onChange={setCheck('reminder_enabled')}
                />
                <label className="form-check-label" htmlFor="task_reminder_enabled">
                  Send reminder notification before a task is due
                </label>
              </div>
            </div>
            <div className="col-md-4">
              <label className="form-label">Hours Before Due</label>
              <input
                type="number"
                className="form-control"
                value={cfg.reminder_hours_before}
                onChange={setVal('reminder_hours_before')}
                min={1}
                placeholder="24"
                disabled={!cfg.reminder_enabled}
              />
              <div className="form-text">e.g. 24 = reminder sent 1 day before due.</div>
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} d-flex align-items-center gap-2`}>
          <iconify-icon
            icon={msgType === 'success' ? 'solar:check-circle-line-duotone' : 'solar:close-circle-line-duotone'}
            class="fs-5"
          ></iconify-icon>
          {msg}
        </div>
      )}
      <div className="d-flex justify-content-end">
        <button type="submit" className="btn btn-primary px-4" disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
            : <>Save Task Settings</>}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Subscriptions settings tab
// ─────────────────────────────────────────────────────────────
const SUBS_DEFAULTS = {
  default_billing_cycle:       'monthly',
  renewal_reminder_days:       14,
  auto_invoice_on_renewal:     false,
  failed_payment_retry_2_days: 3,
  failed_payment_retry_3_days: 7,
};

function SubscriptionsSettingsTab() {
  const [cfg, setCfg]       = useState(SUBS_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState('');
  const [msgType, setMsgType] = useState('success');

  useEffect(() => {
    api.get('/settings/module/subscriptions')
      .then((r) => setCfg({ ...SUBS_DEFAULTS, ...r.data }))
      .catch(() => {});
  }, []);

  function setCheck(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.checked }));
  }
  function setVal(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const payload = {
        ...cfg,
        renewal_reminder_days:       Number(cfg.renewal_reminder_days) || 0,
        failed_payment_retry_2_days: Number(cfg.failed_payment_retry_2_days) || 0,
        failed_payment_retry_3_days: Number(cfg.failed_payment_retry_3_days) || 0,
      };
      await api.put('/settings/module/subscriptions', payload);
      setMsg('Recurring settings saved.');
      setMsgType('success');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Save failed.');
      setMsgType('danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      {/* Billing */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:refresh-circle-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Billing</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Default Billing Cycle</label>
              <select className="form-select" value={cfg.default_billing_cycle} onChange={setVal('default_billing_cycle')}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
              <div className="form-text">Pre-selected when creating a new recurring plan.</div>
            </div>
            <div className="col-md-4">
              <label className="form-label">Renewal Reminder (days before expiry)</label>
              <input
                type="number"
                className="form-control"
                value={cfg.renewal_reminder_days}
                onChange={setVal('renewal_reminder_days')}
                min={0}
                placeholder="14"
              />
              <div className="form-text">Send renewal notice this many days before the recurring plan expires.</div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="auto_invoice_on_renewal"
                  checked={!!cfg.auto_invoice_on_renewal}
                  onChange={setCheck('auto_invoice_on_renewal')}
                />
                <label className="form-check-label" htmlFor="auto_invoice_on_renewal">
                  Auto-generate invoice when a recurring plan renews
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Failed Payment Retries */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:card-recive-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Failed Payment Retry Schedule</strong>
        </div>
        <div className="card-body">
          <p className="text-muted small mb-3">
            When an initial payment attempt fails, the system will retry automatically on this schedule.
          </p>
          <div className="row g-3">
            <div className="col-md-3">
              <label className="form-label">Attempt 2 — after (days)</label>
              <input
                type="number"
                className="form-control"
                value={cfg.failed_payment_retry_2_days}
                onChange={setVal('failed_payment_retry_2_days')}
                min={1}
                placeholder="3"
              />
            </div>
            <div className="col-md-3">
              <label className="form-label">Attempt 3 — after (days)</label>
              <input
                type="number"
                className="form-control"
                value={cfg.failed_payment_retry_3_days}
                onChange={setVal('failed_payment_retry_3_days')}
                min={1}
                placeholder="7"
              />
            </div>
            <div className="col-12">
              <div className="form-text">
                Days are counted from the original failed attempt. Set 0 to disable that retry.
              </div>
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} d-flex align-items-center gap-2`}>
          <iconify-icon
            icon={msgType === 'success' ? 'solar:check-circle-line-duotone' : 'solar:close-circle-line-duotone'}
            class="fs-5"
          ></iconify-icon>
          {msg}
        </div>
      )}
      <div className="d-flex justify-content-end">
        <button type="submit" className="btn btn-primary px-4" disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
            : <>Save Recurring Settings</>}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Portal settings tab
// ─────────────────────────────────────────────────────────────
const PORTAL_DEFAULTS = {
  allow_download_invoices:     true,
  show_balance_history:        true,
  allow_update_payment_method: false,
  portal_subdomain:            '',
};

function PortalSettingsTab() {
  const [cfg, setCfg]       = useState(PORTAL_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState('');
  const [msgType, setMsgType] = useState('success');

  useEffect(() => {
    api.get('/settings/module/portal')
      .then((r) => setCfg({ ...PORTAL_DEFAULTS, ...r.data }))
      .catch(() => {});
  }, []);

  function setCheck(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.checked }));
  }
  function setVal(field) {
    return (e) => setCfg((c) => ({ ...c, [field]: e.target.value }));
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      await api.put('/settings/module/portal', cfg);
      setMsg('Portal settings saved.');
      setMsgType('success');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Save failed.');
      setMsgType('danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      {/* Customer Access */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:user-check-rounded-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Customer Access</strong>
        </div>
        <div className="card-body">
          <p className="text-muted small mb-3">
            Control what customers can see and do in the self-service portal.
          </p>
          <div className="row g-2">
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="allow_download_invoices"
                  checked={!!cfg.allow_download_invoices}
                  onChange={setCheck('allow_download_invoices')}
                />
                <label className="form-check-label" htmlFor="allow_download_invoices">
                  Allow customers to download invoices as PDF
                </label>
              </div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="show_balance_history"
                  checked={!!cfg.show_balance_history}
                  onChange={setCheck('show_balance_history')}
                />
                <label className="form-check-label" htmlFor="show_balance_history">
                  Show balance and payment history to customers
                </label>
              </div>
            </div>
            <div className="col-12">
              <div className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  id="allow_update_payment_method"
                  checked={!!cfg.allow_update_payment_method}
                  onChange={setCheck('allow_update_payment_method')}
                />
                <label className="form-check-label" htmlFor="allow_update_payment_method">
                  Allow customers to update their saved payment method
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Domain */}
      <div className="card mb-4">
        <div className="card-header d-flex align-items-center gap-2">
          <iconify-icon icon="solar:global-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
          <strong>Domain</strong>
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label">Portal Subdomain</label>
              <div className="input-group">
                <input
                  className="form-control font-monospace"
                  value={cfg.portal_subdomain}
                  onChange={setVal('portal_subdomain')}
                  placeholder="billing"
                />
                <span className="input-group-text text-muted">.yourdomain.com</span>
              </div>
              <div className="form-text">Custom domain support coming soon. Leave blank to use the default portal URL.</div>
            </div>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`alert alert-${msgType} d-flex align-items-center gap-2`}>
          <iconify-icon
            icon={msgType === 'success' ? 'solar:check-circle-line-duotone' : 'solar:close-circle-line-duotone'}
            class="fs-5"
          ></iconify-icon>
          {msg}
        </div>
      )}
      <div className="d-flex justify-content-end">
        <button type="submit" className="btn btn-primary px-4" disabled={saving}>
          {saving
            ? <><span className="spinner-border spinner-border-sm me-2" />Saving…</>
            : <>Save Portal Settings</>}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Root page with tab bar
// ─────────────────────────────────────────────────────────────
const TABS = [
  { id: 'business',       label: 'Business',       icon: 'solar:buildings-2-line-duotone' },
  { id: 'invoices',       label: 'Invoices',        icon: 'solar:document-text-line-duotone' },
  { id: 'payments',       label: 'Payments',        icon: 'solar:card-line-duotone' },
  { id: 'contacts',       label: 'Contacts',        icon: 'solar:user-line-duotone' },
  { id: 'organizations',  label: 'Organizations',   icon: 'solar:buildings-3-line-duotone' },
  { id: 'deals',          label: 'Deals',           icon: 'solar:hand-money-line-duotone' },
  { id: 'tasks',          label: 'Tasks',           icon: 'solar:checklist-minimalistic-line-duotone' },
  { id: 'subscriptions',  label: 'Recurring',       icon: 'solar:refresh-circle-line-duotone' },
  { id: 'portal',         label: 'Portal',          icon: 'solar:global-line-duotone' },
];

export default function BusinessSettings() {
  const [activeTab, setActiveTab] = useState('business');

  return (
    <div>
      <PageHeader title="Settings" subtitle="Business profile, branding, and module configuration" />

      <ul className="nav nav-tabs mb-4">
        {TABS.map((t) => (
          <li key={t.id} className="nav-item">
            <button
              type="button"
              className={`nav-link d-flex align-items-center gap-2 ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              <iconify-icon icon={t.icon} class="fs-6"></iconify-icon>
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      {activeTab === 'business'       && <BusinessTab />}
      {activeTab === 'invoices'       && <InvoiceSettingsTab />}
      {activeTab === 'payments'       && <PaymentSettingsTab />}
      {activeTab === 'contacts'       && <ContactsSettingsTab />}
      {activeTab === 'organizations'  && <OrganizationsSettingsTab />}
      {activeTab === 'deals'          && <DealsSettingsTab />}
      {activeTab === 'tasks'          && <TasksSettingsTab />}
      {activeTab === 'subscriptions'  && <SubscriptionsSettingsTab />}
      {activeTab === 'portal'         && <PortalSettingsTab />}
    </div>
  );
}
