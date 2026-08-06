import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';

const emptyZone = { name: '', description: '', is_active: true };
const emptyRate = { zone_id: null, name: '', method: 'flat', rate: '', min_order_total: '', max_order_total: '' };

export default function ShippingPage() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [zones, setZones] = useState([]);
  const [zoneModal, setZoneModal] = useState(false);
  const [zoneForm, setZoneForm] = useState(emptyZone);
  const [zoneEditId, setZoneEditId] = useState(null);
  const [rateModal, setRateModal] = useState(false);
  const [rateForm, setRateForm] = useState(emptyRate);
  const [rateEditId, setRateEditId] = useState(null);

  async function load() {
    const { data } = await api.get('/shipping/zones');
    setZones(data);
  }
  useEffect(() => { load(); }, []);

  function openNewZone() { setZoneEditId(null); setZoneForm(emptyZone); setZoneModal(true); }
  function openEditZone(z) { setZoneEditId(z.id); setZoneForm({ name: z.name, description: z.description || '', is_active: !!z.is_active }); setZoneModal(true); }
  async function saveZone() {
    try {
      if (zoneEditId) await api.put(`/shipping/zones/${zoneEditId}`, zoneForm);
      else await api.post('/shipping/zones', zoneForm);
      setZoneModal(false); load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }
  async function removeZone(z) {
    if (!(await confirm(`Delete zone "${z.name}" and all its rates?`, { danger: true }))) return;
    try {
      await api.delete(`/shipping/zones/${z.id}`); load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  function openNewRate(zoneId) { setRateEditId(null); setRateForm({ ...emptyRate, zone_id: zoneId }); setRateModal(true); }
  function openEditRate(r) {
    setRateEditId(r.id);
    setRateForm({ zone_id: r.zone_id, name: r.name, method: r.method, rate: r.rate,
      min_order_total: r.min_order_total ?? '', max_order_total: r.max_order_total ?? '' });
    setRateModal(true);
  }
  async function saveRate() {
    try {
      const payload = { ...rateForm, rate: Number(rateForm.rate) || 0,
        min_order_total: rateForm.min_order_total === '' ? null : Number(rateForm.min_order_total),
        max_order_total: rateForm.max_order_total === '' ? null : Number(rateForm.max_order_total) };
      if (rateEditId) await api.put(`/shipping/rates/${rateEditId}`, payload);
      else await api.post('/shipping/rates', payload);
      setRateModal(false); load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }
  async function removeRate(r) {
    if (!(await confirm(`Delete rate "${r.name}"?`, { danger: true }))) return;
    try {
      await api.delete(`/shipping/rates/${r.id}`); load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  return (
    <div>
      <PageHeader title="Shipping" subtitle="Zones and rates"
        actions={<button className="btn btn-primary" onClick={openNewZone}>+ New Zone</button>} />

      {zones.map(z => (
        <div className="card mb-3" key={z.id}>
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-start mb-2">
              <div>
                <h6 className="fw-bolder mb-0">{z.name} {!z.is_active && <span className="badge bg-secondary-subtle text-secondary ms-1">Inactive</span>}</h6>
                {z.description && <div className="text-muted fs-3">{z.description}</div>}
              </div>
              <div className="text-nowrap">
                <button className="btn btn-sm btn-light me-1" onClick={() => openEditZone(z)}>Edit</button>
                <button className="btn btn-sm btn-light text-danger" onClick={() => removeZone(z)}>Delete</button>
              </div>
            </div>
            <table className="table table-sm mb-2">
              <thead><tr><th>Rate</th><th>Method</th><th>Cost</th><th>Conditions</th><th className="text-end">Actions</th></tr></thead>
              <tbody>
                {z.rates.map(r => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="text-muted">{r.method}</td>
                    <td>{r.method === 'free' ? 'Free' : `$${Number(r.rate).toFixed(2)}`}</td>
                    <td className="text-muted fs-3">
                      {r.min_order_total != null && `Min $${r.min_order_total} `}
                      {r.max_order_total != null && `Max $${r.max_order_total}`}
                    </td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-light me-1" onClick={() => openEditRate(r)}>Edit</button>
                      <button className="btn btn-sm btn-light text-danger" onClick={() => removeRate(r)}>Delete</button>
                    </td>
                  </tr>
                ))}
                {z.rates.length === 0 && <tr><td colSpan="5" className="text-muted">No rates yet.</td></tr>}
              </tbody>
            </table>
            <button className="btn btn-sm btn-outline-primary" onClick={() => openNewRate(z.id)}>+ Add Rate</button>
          </div>
        </div>
      ))}
      {zones.length === 0 && <div className="card"><div className="card-body"><div className="empty-state">No shipping zones yet.</div></div></div>}

      <Modal show={zoneModal} onClose={() => setZoneModal(false)} title={zoneEditId ? 'Edit Zone' : 'New Zone'}
        footer={<><button className="btn btn-light" onClick={() => setZoneModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveZone}>Save</button></>}>
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Name</label>
            <input className="form-control" value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} /></div>
          <div className="col-12"><label className="form-label">Description</label>
            <input className="form-control" value={zoneForm.description} onChange={(e) => setZoneForm({ ...zoneForm, description: e.target.value })} /></div>
          <div className="col-12 form-check form-switch">
            <input className="form-check-input" type="checkbox" checked={zoneForm.is_active} onChange={(e) => setZoneForm({ ...zoneForm, is_active: e.target.checked })} id="zone-active" />
            <label className="form-check-label" htmlFor="zone-active">Active</label>
          </div>
        </div>
      </Modal>

      <Modal show={rateModal} onClose={() => setRateModal(false)} title={rateEditId ? 'Edit Rate' : 'New Rate'}
        footer={<><button className="btn btn-light" onClick={() => setRateModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveRate}>Save</button></>}>
        <div className="row g-2">
          <div className="col-md-8"><label className="form-label">Name</label>
            <input className="form-control" value={rateForm.name} onChange={(e) => setRateForm({ ...rateForm, name: e.target.value })} /></div>
          <div className="col-md-4"><label className="form-label">Method</label>
            <select className="form-select" value={rateForm.method} onChange={(e) => setRateForm({ ...rateForm, method: e.target.value })}>
              <option value="flat">Flat</option>
              <option value="free">Free</option>
              <option value="weight">Weight</option>
              <option value="order_total">Order Total</option>
            </select></div>
          {rateForm.method !== 'free' && (
            <div className="col-md-4"><label className="form-label">Rate ($)</label>
              <input type="number" step="0.01" className="form-control" value={rateForm.rate} onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })} /></div>
          )}
          <div className="col-md-4"><label className="form-label">Min Order Total</label>
            <input type="number" step="0.01" className="form-control" value={rateForm.min_order_total} onChange={(e) => setRateForm({ ...rateForm, min_order_total: e.target.value })} /></div>
          <div className="col-md-4"><label className="form-label">Max Order Total</label>
            <input type="number" step="0.01" className="form-control" value={rateForm.max_order_total} onChange={(e) => setRateForm({ ...rateForm, max_order_total: e.target.value })} /></div>
        </div>
      </Modal>
      {confirmDialog}
    </div>
  );
}
