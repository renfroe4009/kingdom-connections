import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import MergeModal from '../components/MergeModal.jsx';

export default function DuplicatesPage() {
  const [contactGroups, setContactGroups] = useState([]);
  const [orgGroups, setOrgGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mergePair, setMergePair] = useState(null); // { entityType, a, b }

  async function load() {
    setLoading(true);
    const [c, o] = await Promise.all([
      api.get('/contacts/duplicates').catch(() => ({ data: [] })),
      api.get('/organizations/duplicates').catch(() => ({ data: [] })),
    ]);
    setContactGroups(c.data);
    setOrgGroups(o.data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Duplicates" subtitle="Possible duplicate contacts and organizations, grouped by matching email or name" />

      <div className="card mb-3">
        <div className="card-body">
          <h6 className="fw-bold text-uppercase small text-muted">Contacts</h6>
          {loading && <div className="text-muted small">Scanning…</div>}
          {!loading && contactGroups.length === 0 && <div className="empty-state">No likely duplicate contacts found.</div>}
          {contactGroups.map((g) => (
            <div key={g.key} className="border rounded p-2 mb-2">
              <div className="d-flex flex-wrap gap-3 align-items-center">
                {g.contacts.map((c) => (
                  <div key={c.id} className="small">
                    <Link to={`/admin/contacts/${c.id}`}>{c.name || `#${c.id}`}</Link>
                    <div className="text-muted">{c.email || c.phone || '—'} {c.organization_name ? `· ${c.organization_name}` : ''}</div>
                  </div>
                ))}
                {g.contacts.length >= 2 && (
                  <button className="btn btn-sm btn-outline-primary ms-auto"
                    onClick={() => setMergePair({ entityType: 'contact', a: g.contacts[0], b: g.contacts[1] })}>
                    Review merge
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <h6 className="fw-bold text-uppercase small text-muted">Organizations</h6>
          {loading && <div className="text-muted small">Scanning…</div>}
          {!loading && orgGroups.length === 0 && <div className="empty-state">No likely duplicate organizations found.</div>}
          {orgGroups.map((g) => (
            <div key={g.key} className="border rounded p-2 mb-2">
              <div className="d-flex flex-wrap gap-3 align-items-center">
                {g.organizations.map((o) => (
                  <div key={o.id} className="small">
                    <Link to={`/admin/organizations/${o.id}`}>{o.name}</Link>
                    <div className="text-muted">{o.website || o.phone || '—'} {[o.city, o.state].filter(Boolean).join(', ')}</div>
                  </div>
                ))}
                {g.organizations.length >= 2 && (
                  <button className="btn btn-sm btn-outline-primary ms-auto"
                    onClick={() => setMergePair({ entityType: 'organization', a: g.organizations[0], b: g.organizations[1] })}>
                    Review merge
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {mergePair && (
        <MergeModal
          entityType={mergePair.entityType}
          recordA={mergePair.a}
          recordB={mergePair.b}
          onClose={() => setMergePair(null)}
          onMerged={() => { setMergePair(null); load(); }}
        />
      )}
    </div>
  );
}
