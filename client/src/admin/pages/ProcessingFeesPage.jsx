import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';

const empty = {
  gateway: 'valor', fee_type: 'percent', fee_percent: '', fee_flat: '',
  apply_to_tax: false, apply_to_ship: false, apply_to_ach: false,
  label: 'Processing Fee', is_active: true,
};

export default function ProcessingFeesPage() {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/commerce-settings/processing-fee').then(r => {
      if (r.data) setForm({
        gateway: r.data.gateway, fee_type: r.data.fee_type,
        fee_percent: r.data.fee_percent ?? '', fee_flat: r.data.fee_flat ?? '',
        apply_to_tax: !!r.data.apply_to_tax, apply_to_ship: !!r.data.apply_to_ship,
        apply_to_ach: !!r.data.apply_to_ach,
        label: r.data.label || 'Processing Fee', is_active: !!r.data.is_active,
      });
    });
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.put('/commerce-settings/processing-fee', {
        ...form,
        fee_percent: form.fee_percent === '' ? null : Number(form.fee_percent),
        fee_flat: form.fee_flat === '' ? null : Number(form.fee_flat),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  return (
    <div>
      <PageHeader title="Processing Fees" subtitle="Convenience fee charged at checkout, shown as a line item before payment" />
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="card-body">
          <div className="row g-2">
            <div className="col-12 form-check form-switch">
              <input className="form-check-input" type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} id="pf-active" />
              <label className="form-check-label" htmlFor="pf-active">Charge a processing fee</label>
            </div>
            <div className="col-md-6"><label className="form-label">Fee Type</label>
              <select className="form-select" value={form.fee_type} onChange={(e) => setForm({ ...form, fee_type: e.target.value })}>
                <option value="percent">Percent</option>
                <option value="flat">Flat</option>
                <option value="percent_plus_flat">Percent + Flat</option>
              </select></div>
            <div className="col-md-6"><label className="form-label">Label shown to customer</label>
              <input className="form-control" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
            {form.fee_type !== 'flat' && (
              <div className="col-md-6"><label className="form-label">Fee Percent (%)</label>
                <input type="number" step="0.0001" className="form-control" value={form.fee_percent} onChange={(e) => setForm({ ...form, fee_percent: e.target.value })} /></div>
            )}
            {form.fee_type !== 'percent' && (
              <div className="col-md-6"><label className="form-label">Fee Flat ($)</label>
                <input type="number" step="0.01" className="form-control" value={form.fee_flat} onChange={(e) => setForm({ ...form, fee_flat: e.target.value })} /></div>
            )}
            <div className="col-md-6 form-check form-switch mt-3">
              <input className="form-check-input" type="checkbox" checked={form.apply_to_tax} onChange={(e) => setForm({ ...form, apply_to_tax: e.target.checked })} id="pf-tax" />
              <label className="form-check-label" htmlFor="pf-tax">Apply to tax amount</label>
            </div>
            <div className="col-md-6 form-check form-switch mt-3">
              <input className="form-check-input" type="checkbox" checked={form.apply_to_ship} onChange={(e) => setForm({ ...form, apply_to_ship: e.target.checked })} id="pf-ship" />
              <label className="form-check-label" htmlFor="pf-ship">Apply to shipping amount</label>
            </div>
            <div className="col-md-6 form-check form-switch mt-3">
              <input className="form-check-input" type="checkbox" checked={form.apply_to_ach} onChange={(e) => setForm({ ...form, apply_to_ach: e.target.checked })} id="pf-ach" />
              <label className="form-check-label" htmlFor="pf-ach">Apply to ACH (bank) payments</label>
              <div className="form-text">Off by default — card-network surcharge rules exist because of card interchange cost, not bank transfers.</div>
            </div>
            <div className="col-12 mt-3">
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              {saved && <span className="text-success ms-2">Saved.</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
