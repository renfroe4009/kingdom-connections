import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { SECTIONS, INTEGRATIONS } from '../navConfig.js';
import { useModuleConfig } from '../context/ModuleConfigContext.jsx';

// Flattens a section's items (including nested children) into one list of
// {to, label} toggles — same shape AppLayout checks via isItemEnabled(to).
function flattenItems(section) {
  const out = [];
  for (const item of section.items) {
    out.push({ to: item.to, label: item.label });
    for (const child of item.children || []) {
      out.push({ to: child.to, label: `${item.label} — ${child.label}`, nested: true });
    }
  }
  return out;
}

export default function ModuleManagerPage() {
  const { refresh: refreshGlobalConfig } = useModuleConfig();
  const [config, setConfig] = useState(null); // null = loading
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/settings/module-manager')
      .then((r) => setConfig(r.data))
      .catch(() => setMsg('Failed to load module configuration.'));
  }, []);

  function isSectionOn(key) { return config?.sections?.[key] !== false; }
  function isItemOn(to) { return config?.items?.[to] !== false; }
  function isIntegrationOn(key) { return config?.integrations?.[key] !== false; }

  function toggleSection(key) {
    setConfig((c) => ({ ...c, sections: { ...c.sections, [key]: !isSectionOn(key) } }));
  }
  function toggleItem(to) {
    setConfig((c) => ({ ...c, items: { ...c.items, [to]: !isItemOn(to) } }));
  }
  function toggleIntegration(key) {
    setConfig((c) => ({ ...c, integrations: { ...c.integrations, [key]: !isIntegrationOn(key) } }));
  }

  async function save() {
    setSaving(true); setMsg('');
    try {
      await api.put('/settings/module-manager', config);
      await refreshGlobalConfig();
      setMsg('Saved — the sidebar and Settings tabs update immediately for everyone.');
    } catch (e) {
      setMsg(e.response?.data?.error || 'Failed to save.');
    } finally { setSaving(false); }
  }

  if (!config) {
    return (
      <div>
        <PageHeader title="Module Manager" subtitle="Hide modules, submodules, and integrations this business doesn't use" />
        <div className="text-muted">{msg || 'Loading…'}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Module Manager" subtitle="Hide modules, submodules, and integrations this business doesn't use" />

      <p className="text-muted small mb-3">
        Turning a module off hides it from the sidebar for every user — it doesn't delete any data or
        revoke anyone's permissions, so turning it back on later brings everything right back.
      </p>

      {msg && <div className="alert alert-info py-2">{msg}</div>}

      <div className="row g-3">
        {SECTIONS.map((section) => {
          const items = flattenItems(section);
          const sectionOn = isSectionOn(section.key);
          return (
            <div className="col-12 col-lg-6" key={section.key}>
              <div className="card h-100">
                <div className="card-body">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <div className="d-flex align-items-center gap-2">
                      <iconify-icon icon={section.icon} class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
                      <h6 className="mb-0 fw-bold">{section.label}</h6>
                    </div>
                    <div className="form-check form-switch mb-0">
                      <input
                        type="checkbox" className="form-check-input" role="switch"
                        id={`section-${section.key}`}
                        checked={sectionOn}
                        onChange={() => toggleSection(section.key)}
                      />
                    </div>
                  </div>

                  <div className={sectionOn ? '' : 'opacity-50'} style={{ pointerEvents: sectionOn ? 'auto' : 'none' }}>
                    {items.map((item) => (
                      <div className="form-check form-switch mb-1" key={item.to} style={item.nested ? { paddingLeft: 36 } : undefined}>
                        <input
                          type="checkbox" className="form-check-input" role="switch"
                          id={`item-${item.to}`}
                          checked={isItemOn(item.to)}
                          onChange={() => toggleItem(item.to)}
                        />
                        <label className="form-check-label small" htmlFor={`item-${item.to}`}>{item.label}</label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        <div className="col-12 col-lg-6">
          <div className="card h-100">
            <div className="card-body">
              <div className="d-flex align-items-center gap-2 mb-2">
                <iconify-icon icon="solar:plug-circle-line-duotone" class="fs-5" style={{ color: 'var(--secondary)' }}></iconify-icon>
                <h6 className="mb-0 fw-bold">Integrations</h6>
              </div>
              <p className="text-muted small mb-2">
                Hides the tab in Settings → Integrations for tools this business doesn't use
                (e.g. ConnectWise is an IT/MSP tool, not relevant to most nonprofits or churches).
                Email/SMTP and Payment Gateways are core and always shown.
              </p>
              {INTEGRATIONS.map((integ) => (
                <div className="form-check form-switch mb-1" key={integ.key}>
                  <input
                    type="checkbox" className="form-check-input" role="switch"
                    id={`integ-${integ.key}`}
                    checked={isIntegrationOn(integ.key)}
                    onChange={() => toggleIntegration(integ.key)}
                  />
                  <label className="form-check-label small" htmlFor={`integ-${integ.key}`}>{integ.label}</label>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="d-flex justify-content-end mt-3">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
