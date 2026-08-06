import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import api from '../../api/client.js';

export default function SearchResultsPage() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q) return;
    setLoading(true);
    api.get(`/website/search?q=${encodeURIComponent(q)}`)
      .then(r => setResults(r.data))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [q]);

  return (
    <div className="container py-5" style={{ minHeight: '60vh' }}>
      <h1 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '0.25rem' }}>
        Search Results
      </h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        {q ? `Showing results for: "${q}"` : 'Enter a search term above.'}
      </p>

      {loading && <div className="text-center py-4"><span className="spinner-border text-dark" /></div>}

      {!loading && q && results.length === 0 && (
        <div style={{ textAlign: 'center', color: '#888', padding: '3rem 0' }}>
          <p style={{ fontSize: '1.1rem' }}>No results found for "{q}"</p>
          <p>Try a different search term or browse our <Link to="/">home page</Link>.</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {results.map(r => (
            <div key={`${r.result_type}-${r.id}`} style={{ borderBottom: '1px solid #eee', paddingBottom: '1.5rem' }}>
              <div style={{ marginBottom: '0.35rem' }}>
                {{
                  page:    <span style={{ fontSize: '0.7rem', background: '#e2e8f0', color: '#475569', padding: '2px 8px', borderRadius: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Page</span>,
                  product: <span style={{ fontSize: '0.7rem', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shop</span>,
                  builder: <span style={{ fontSize: '0.7rem', background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Builder Gallery</span>,
                  kb:      <span style={{ fontSize: '0.7rem', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Builders Manual</span>,
                  blog:    <span style={{ fontSize: '0.7rem', background: '#f3e8ff', color: '#6b21a8', padding: '2px 8px', borderRadius: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Blog</span>,
                }[r.result_type] || <span style={{ fontSize: '0.7rem', color: '#999', textTransform: 'uppercase' }}>{r.result_type}</span>}
              </div>
              <Link
                to={`/${r.slug}`}
                style={{ fontSize: '1.2rem', fontWeight: 700, color: '#111', textDecoration: 'none' }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--brand-primary)'}
                onMouseOut={e => e.currentTarget.style.color = '#111'}
              >
                {r.title}
              </Link>
              {r.meta_desc && (
                <p style={{ color: '#555', fontSize: '0.9rem', marginTop: '0.4rem', marginBottom: 0 }}>{r.meta_desc}</p>
              )}
              <div style={{ marginTop: '0.4rem' }}>
                <Link to={`/${r.slug}`} style={{ color: '#4a2d82', fontSize: '0.82rem', textDecoration: 'none' }}>
                  /{r.slug} →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
