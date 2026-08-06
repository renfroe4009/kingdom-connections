// =============================================================================
// Territory map — contacts + organizations plotted via Leaflet + OSM tiles
// -----------------------------------------------------------------------------
// Leaflet is loaded from CDN on first render (keeps it out of our bundle since
// most users never hit this page). Server geocodes addresses via Nominatim and
// returns {pins: [{lat, lng, kind, label, ...}]}.
// =============================================================================
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

// Shared singleton promise so repeated mounts (StrictMode, route revisits)
// don't stack up load-event listeners or miss a "load" that already fired.
let leafletPromise = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    let script = document.querySelector(`script[src="${LEAFLET_JS}"]`);
    const onLoad = () => {
      if (window.L) resolve(window.L);
      else reject(new Error('Leaflet loaded but window.L is undefined'));
    };
    const onError = (e) => { leafletPromise = null; reject(e); };
    if (!script) {
      script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.async = true;
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });
      document.body.appendChild(script);
    } else if (window.L) {
      resolve(window.L);
    } else {
      // Script tag exists from a prior call but hasn't finished yet.
      script.addEventListener('load', onLoad, { once: true });
      script.addEventListener('error', onError, { once: true });
    }
  });
  return leafletPromise;
}

export default function MapsPage() {
  const { user } = useAuth();
  const isAgent = user?.roles?.includes('sales_agent') && !user?.roles?.includes('sales_manager') && !user?.roles?.includes('admin') && !user?.roles?.includes('manager');
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const layerRef = useRef(null);
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [owners, setOwners] = useState([]);
  const [tags, setTags] = useState([]);
  const [filters, setFilters] = useState({ owner_id: '', lifecycle_stage: '', tag_id: '' });
  const [mapError, setMapError] = useState(null);
  const [pinsError, setPinsError] = useState(null);

  useEffect(() => {
    api.get('/users').then((r) => setOwners(r.data.rows || r.data || [])).catch(() => {});
    api.get('/tags').then((r) => setTags(r.data || [])).catch(() => {});
  }, []);

  async function loadPins() {
    setLoading(true);
    setPinsError(null);
    try {
      const { data } = await api.get('/maps/pins', { params: filters });
      setPins(data.pins || []);
    } catch (e) {
      setPinsError(e?.response?.data?.error || e.message || 'Failed to load map pins');
      setPins([]);
    } finally { setLoading(false); }
  }

  // Initialize the map once Leaflet is ready
  useEffect(() => {
    let mounted = true;
    loadLeaflet().then((L) => {
      if (!mounted || !mapElRef.current || mapRef.current) return;
      const map = L.map(mapElRef.current, { zoomControl: true }).setView([39.8283, -98.5795], 4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      // Leaflet sometimes needs a nudge to recalculate tile positions when
      // the container size changed while the CSS was loading.
      setTimeout(() => { try { map.invalidateSize(); } catch (_e) { /* noop */ } }, 50);
      loadPins();
    }).catch((e) => {
      if (!mounted) return;
      console.error('Leaflet failed to load', e);
      setMapError('Could not load the map library. Check your network connection and reload the page.');
      setLoading(false);
    });
    return () => { mounted = false; };
    /* eslint-disable-next-line */
  }, []);

  // Re-run whenever filters change (skips first render until map is ready)
  useEffect(() => {
    if (mapRef.current) loadPins();
    /* eslint-disable-next-line */
  }, [filters.owner_id, filters.lifecycle_stage, filters.tag_id]);

  // Re-draw pins whenever the list changes
  useEffect(() => {
    const L = window.L;
    if (!L || !mapRef.current || !layerRef.current) return;
    layerRef.current.clearLayers();
    if (!pins.length) return;

    const orgIcon = L.divIcon({
      className: 'map-pin',
      html: `<div style="background:#F05523;width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);color:white;font-size:12px;font-weight:bold;">🏢</span></div>`,
      iconAnchor: [12, 24],
    });
    const contactIcon = L.divIcon({
      className: 'map-pin',
      html: `<div style="background:#1A1A1A;width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;"><span style="transform:rotate(45deg);color:white;font-size:12px;font-weight:bold;">👤</span></div>`,
      iconAnchor: [12, 24],
    });

    const latlngs = [];
    for (const p of pins) {
      const icon = p.kind === 'organization' ? orgIcon : contactIcon;
      const marker = L.marker([p.lat, p.lng], { icon });
      const address = [p.address_line1, p.city, p.state, p.postal_code].filter(Boolean).join(', ');
      const href = p.kind === 'organization' ? `/organizations/${p.id}` : `/contacts/${p.id}`;
      marker.bindPopup(`
        <div style="min-width:180px">
          <div style="font-weight:bold">${p.label || ''}</div>
          ${p.organization_name && p.kind === 'contact' ? `<div style="color:#666">${p.organization_name}</div>` : ''}
          <div style="color:#666;font-size:.85em">${address}</div>
          <a href="${href}" style="color:#F05523;text-decoration:none;font-weight:600">Open →</a>
        </div>
      `);
      marker.addTo(layerRef.current);
      latlngs.push([p.lat, p.lng]);
    }

    // Zoom map to fit all pins (with a bit of padding)
    if (latlngs.length > 1) {
      mapRef.current.fitBounds(latlngs, { padding: [40, 40] });
    } else if (latlngs.length === 1) {
      mapRef.current.setView(latlngs[0], 10);
    }
  }, [pins]);

  const orgCount = pins.filter((p) => p.kind === 'organization').length;
  const contactCount = pins.filter((p) => p.kind === 'contact').length;

  return (
    <div>
      <PageHeader
        title="Territory Map"
        subtitle={loading
          ? 'Geocoding addresses…'
          : `${orgCount} organization${orgCount === 1 ? '' : 's'} · ${contactCount} contact${contactCount === 1 ? '' : 's'}`}
      />

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-2 align-items-end">
            {!isAgent && (
              <div className="col-md-4">
                <label className="form-label small mb-1">Owner</label>
                <select className="form-select" value={filters.owner_id} onChange={(e) => setFilters({ ...filters, owner_id: e.target.value })}>
                  <option value="">All owners</option>
                  {owners.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                </select>
              </div>
            )}
            <div className={isAgent ? 'col-md-6' : 'col-md-4'}>
              <label className="form-label small mb-1">Lifecycle stage</label>
              <select className="form-select" value={filters.lifecycle_stage} onChange={(e) => setFilters({ ...filters, lifecycle_stage: e.target.value })}>
                <option value="">All stages</option>
                {['lead','mql','sql','customer','evangelist','other'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className={isAgent ? 'col-md-6' : 'col-md-4'}>
              <label className="form-label small mb-1">Tag</label>
              <select className="form-select" value={filters.tag_id} onChange={(e) => setFilters({ ...filters, tag_id: e.target.value })}>
                <option value="">All tags</option>
                {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {mapError && (
        <div className="alert alert-danger d-flex align-items-center" role="alert">
          <iconify-icon icon="solar:danger-triangle-bold-duotone" class="me-2"></iconify-icon>
          <div>{mapError}</div>
        </div>
      )}
      {pinsError && !mapError && (
        <div className="alert alert-warning d-flex align-items-center" role="alert">
          <iconify-icon icon="solar:info-circle-bold-duotone" class="me-2"></iconify-icon>
          <div>{pinsError}</div>
        </div>
      )}

      <div className="card">
        <div className="card-body p-0 position-relative">
          <div ref={mapElRef} style={{ height: 640, width: '100%', borderRadius: 8 }} />
          {loading && !mapError && (
            <div className="position-absolute top-0 start-0 end-0 bottom-0 d-flex align-items-center justify-content-center"
                 style={{ background: 'rgba(255,255,255,.5)', pointerEvents: 'none' }}>
              <div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading…</span></div>
            </div>
          )}
        </div>
      </div>

      <div className="row mt-3">
        <div className="col-lg-8">
          <div className="card">
            <div className="card-body">
              <h6 className="fw-bold text-uppercase small text-muted">Pins ({pins.length})</h6>
              {pins.length === 0 && !loading ? (
                <div className="empty-state">
                  No geocodable addresses yet. Add addresses to your contacts or organizations and they'll appear here.
                </div>
              ) : (
                <div className="table-responsive" style={{ maxHeight: 320 }}>
                  <table className="table table-sm align-middle mb-0">
                    <thead className="sticky-top bg-white">
                      <tr><th>Type</th><th>Name</th><th>Address</th></tr>
                    </thead>
                    <tbody>
                      {pins.map((p, i) => (
                        <tr key={`${p.kind}-${p.id}-${i}`}>
                          <td><span className={`badge bg-${p.kind === 'organization' ? 'primary' : 'dark'}-subtle text-${p.kind === 'organization' ? 'primary' : 'dark'}`}>{p.kind}</span></td>
                          <td>
                            <Link to={p.kind === 'organization' ? `/organizations/${p.id}` : `/contacts/${p.id}`}>{p.label}</Link>
                          </td>
                          <td className="small text-muted">
                            {[p.address_line1, p.city, p.state, p.postal_code].filter(Boolean).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
