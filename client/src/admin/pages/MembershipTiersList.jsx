import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import Modal from '../../components/Modal.jsx';
import FormErrorBanner from '../../components/FormErrorBanner.jsx';
import { toast } from '../../components/Toast.jsx';
import { parseApiError } from '../../utils/apiError.js';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { parseTierBenefits } from '../../utils/tierBenefits.js';

function blankTier() {
  return {
    id: null, name: '', slug: '', description: '', price: '',
    interval_unit: 'year', interval_count: 1, benefits: [''], benefitsMeta: {}, is_active: true, sort_order: 0,
  };
}

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MembershipTiersList() {
  const { can } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(blankTier());
  const [formError, setFormError] = useState('');

  async function load() {
    const { data } = await api.get('/membership/admin/tiers');
    setRows(data);
  }
  useEffect(() => { load(); }, []);

  function openNew() { setForm(blankTier()); setFormError(''); setShow(true); }
  function openEdit(t) {
    // Only the features list is edited here — badge/cta/image ride along
    // untouched so a save keeps the /join card's gold highlight, button label
    // and photo.
    const { features, ...benefitsMeta } = parseTierBenefits(t.benefits_json);
    setForm({
      id: t.id, name: t.name, slug: t.slug, description: t.description || '',
      price: t.price, interval_unit: t.interval_unit, interval_count: t.interval_count,
      benefits: features.length ? features : [''], benefitsMeta, is_active: !!t.is_active, sort_order: t.sort_order,
    });
    setFormError('');
    setShow(true);
  }

  function updateBenefit(i, value) {
    const benefits = form.benefits.slice();
    benefits[i] = value;
    setForm({ ...form, benefits });
  }
  function addBenefit() { setForm({ ...form, benefits: [...form.benefits, ''] }); }
  function removeBenefit(i) {
    const benefits = form.benefits.slice();
    benefits.splice(i, 1);
    setForm({ ...form, benefits: benefits.length ? benefits : [''] });
  }

  async function save() {
    if (!form.name || !form.price) { setFormError('Name and price are required.'); return; }
    const payload = {
      name: form.name, slug: form.slug || undefined, description: form.description || null,
      price: Number(form.price), interval_unit: form.interval_unit, interval_count: Number(form.interval_count || 1),
      benefits: { ...form.benefitsMeta, features: form.benefits.filter((b) => b.trim()) },
      is_active: !!form.is_active, sort_order: Number(form.sort_order || 0),
    };
    try {
      if (form.id) await api.put(`/membership/admin/tiers/${form.id}`, payload);
      else await api.post('/membership/admin/tiers', payload);
      setShow(false);
      load();
    } catch (e) {
      setFormError(parseApiError(e));
    }
  }

  async function remove(t) {
    if (!(await confirm(`Delete tier "${t.name}"? Existing members keep their recurring plan but lose this tier's details.`, { danger: true }))) return;
    try {
      await api.delete(`/membership/admin/tiers/${t.id}`);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  async function move(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const a = rows[index], b = rows[target];
    try {
      await Promise.all([
        api.put(`/membership/admin/tiers/${a.id}`, { ...a, benefits: parseTierBenefits(a.benefits_json), is_active: !!a.is_active, sort_order: b.sort_order }),
        api.put(`/membership/admin/tiers/${b.id}`, { ...b, benefits: parseTierBenefits(b.benefits_json), is_active: !!b.is_active, sort_order: a.sort_order }),
      ]);
      load();
    } catch (e) {
      toast(parseApiError(e), 'error');
    }
  }

  return (
    <div>
      <PageHeader title="Membership Tiers" subtitle="Pricing and benefits for each membership level"
        actions={<>
          <Link to="/admin/membership" className="btn btn-light">← Members</Link>
          {can('membership.write') && (
            <button className="btn btn-primary ms-2" onClick={openNew}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> New Tier
            </button>
          )}
        </>} />

      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Order</th>
                  <th>Name</th>
                  <th className="text-end">Price</th>
                  <th>Active</th>
                  <th style={{ width: 110 }} className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => (
                  <tr key={t.id}>
                    <td>
                      {can('membership.write') ? (
                        <div className="d-flex align-items-center gap-1">
                          <button className="btn btn-sm btn-light" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${t.name} up`} title="Move up">
                            <iconify-icon icon="solar:alt-arrow-up-line-duotone"></iconify-icon>
                          </button>
                          <button className="btn btn-sm btn-light" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${t.name} down`} title="Move down">
                            <iconify-icon icon="solar:alt-arrow-down-line-duotone"></iconify-icon>
                          </button>
                        </div>
                      ) : (
                        <span className="text-muted small">{t.sort_order}</span>
                      )}
                    </td>
                    <td className="fw-semibold">{t.name}<div className="text-muted small">/{t.slug}</div></td>
                    <td className="text-end">{fmtMoney(t.price)} / {t.interval_unit}</td>
                    <td>{t.is_active ? <span className="badge bg-success-subtle text-success">Active</span> : <span className="badge bg-secondary-subtle text-secondary">Inactive</span>}</td>
                    <td className="text-end">
                      {can('membership.write') && (
                        <>
                          <button className="btn btn-sm btn-light" onClick={() => openEdit(t)}>
                            <iconify-icon icon="solar:pen-line-duotone"></iconify-icon>
                          </button>
                          <button className="btn btn-sm btn-light text-danger ms-1" onClick={() => remove(t)}>
                            <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan="5"><div className="empty-state">No tiers yet — create one to start accepting members.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={show} onClose={() => setShow(false)} title={form.id ? 'Edit Tier' : 'New Tier'} size="md"
        footer={<><button className="btn btn-light" onClick={() => setShow(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={save}>Save</button></>}>
        <FormErrorBanner error={formError} />
        <div className="row g-2">
          <div className="col-12"><label className="form-label">Name</label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Gold" /></div>
          <div className="col-12"><label className="form-label">Slug (auto-generated if left blank)</label>
            <input className="form-control" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="gold" /></div>
          <div className="col-12"><label className="form-label">Description</label>
            <textarea className="form-control" rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Price</label>
            <input type="number" step="0.01" className="form-control" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
          <div className="col-md-6"><label className="form-label">Billing interval</label>
            <div className="input-group">
              <span className="input-group-text">Every</span>
              <input type="number" min="1" className="form-control" style={{ maxWidth: 70 }} value={form.interval_count} onChange={(e) => setForm({ ...form, interval_count: e.target.value })} />
              <select className="form-select" value={form.interval_unit} onChange={(e) => setForm({ ...form, interval_unit: e.target.value })}>
                <option value="month">month(s)</option>
                <option value="year">year(s)</option>
              </select>
            </div></div>
          <div className="col-md-6"><label className="form-label">Sort Order</label>
            <input type="number" className="form-control" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            <div className="form-text">Lower numbers show first on the public signup page. Ties break by price.</div></div>

          <div className="col-12 mt-2">
            <label className="form-label">Benefits</label>
            {form.benefits.map((b, i) => (
              <div key={i} className="d-flex gap-2 mb-2">
                <input className="form-control" value={b} onChange={(e) => updateBenefit(i, e.target.value)} placeholder="e.g. Personalized membership card" />
                <button type="button" className="btn btn-light text-danger" onClick={() => removeBenefit(i)}>
                  <iconify-icon icon="solar:trash-bin-trash-line-duotone"></iconify-icon>
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-light" onClick={addBenefit}>
              <iconify-icon icon="solar:add-circle-line-duotone" class="me-1"></iconify-icon> Add benefit
            </button>
          </div>

          <div className="col-12 mt-2">
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" id="tier_active" checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              <label className="form-check-label" htmlFor="tier_active">Active (visible in the public signup)</label>
            </div>
          </div>
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}
