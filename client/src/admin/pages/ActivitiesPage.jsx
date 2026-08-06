import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { parseServerDate, relativeTime } from '../../utils/date.js';

const ENTITY_ROUTES = {
  contact:      (id) => `/contacts/${id}`,
  organization: (id) => `/organizations/${id}`,
  deal:         (id) => `/deals/${id}`,
  task:         (id) => `/tasks`,
  invoice:      (id) => `/invoices/${id}`,
  subscription: (id) => `/subscriptions/${id}`,
};

const ACTION_META = {
  created:  { icon: 'solar:add-circle-line-duotone',       color: '#22c55e' },
  updated:  { icon: 'solar:pen-new-square-line-duotone',   color: '#3b82f6' },
  deleted:  { icon: 'solar:trash-bin-trash-line-duotone',  color: '#ef4444' },
  won:      { icon: 'solar:cup-star-line-duotone',         color: '#f59e0b' },
  lost:     { icon: 'solar:close-circle-line-duotone',     color: '#ef4444' },
  stage:    { icon: 'solar:arrow-right-line-duotone',      color: '#8b5cf6' },
  sent:     { icon: 'solar:letter-line-duotone',           color: '#06b6d4' },
  paid:     { icon: 'solar:wallet-money-line-duotone',     color: '#22c55e' },
  imported: { icon: 'solar:import-line-duotone',           color: '#F05523' },
  default:  { icon: 'solar:bell-line-duotone',             color: '#6b7280' },
};

function actionMeta(action) {
  const key = action?.toLowerCase() || '';
  for (const [word, meta] of Object.entries(ACTION_META)) {
    if (key.includes(word)) return meta;
  }
  return ACTION_META.default;
}

export default function ActivitiesPage() {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [entityType, setEntityType] = useState('');
  const [action, setAction]       = useState('');

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/activities', {
        params: { entity_type: entityType, action, limit: 200 },
      });
      setRows(data.rows || data);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [entityType, action]);

  function entityLabel(type) {
    return type ? type.charAt(0).toUpperCase() + type.slice(1) : '';
  }

  return (
    <div>
      <PageHeader title="Activity Feed" subtitle={loading ? '…' : `${rows.length} events`} />

      <div className="card">
        <div className="card-body">
          <div className="d-flex flex-wrap gap-2 mb-3">
            <select
              className="form-select"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            >
              <option value="">All types</option>
              <option value="contact">Contacts</option>
              <option value="organization">Organizations</option>
              <option value="deal">Deals</option>
              <option value="task">Tasks</option>
              <option value="invoice">Invoices</option>
            </select>
            <input
              className="form-control"
              placeholder="Filter by action…"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </div>

          {loading && <div className="text-muted small py-2">Loading…</div>}

          {!loading && rows.length === 0 && (
            <div className="empty-state">No activity found.</div>
          )}

          {!loading && rows.length > 0 && (
            <ul className="list-unstyled mb-0">
              {rows.map((a) => {
                const meta   = actionMeta(a.action);
                const route  = ENTITY_ROUTES[a.entity_type];
                return (
                  <li key={a.id} className="py-2 border-top d-flex gap-3 align-items-start">
                    <iconify-icon
                      icon={meta.icon}
                      style={{ fontSize: 22, color: meta.color, flex: '0 0 auto', marginTop: 2 }}
                    />
                    <div className="flex-grow-1 min-width-0">
                      <div>
                        <strong>{a.user_name || 'System'}</strong>
                        {' '}
                        <span className="text-muted">{a.action?.replace(/_/g, ' ')}</span>
                        {a.entity_type && a.entity_id && (
                          <>
                            {' — '}
                            {route ? (
                              <Link to={route(a.entity_id)} className="fw-semibold">
                                {entityLabel(a.entity_type)} #{a.entity_id}
                              </Link>
                            ) : (
                              <span className="fw-semibold">{entityLabel(a.entity_type)} #{a.entity_id}</span>
                            )}
                          </>
                        )}
                      </div>
                      {a.description && (
                        <div className="text-muted small mt-1">{a.description}</div>
                      )}
                    </div>
                    <small className="text-muted text-nowrap" title={parseServerDate(a.created_at)?.toLocaleString()}>
                      {relativeTime(a.created_at)}
                    </small>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
