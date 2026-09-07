import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client.js';
import usePageMeta from '../../hooks/usePageMeta.js';

const SPA_NAVY = '#0d1b2a';

function decodeHtml(str) {
  if (!str) return str;
  try {
    const doc = new DOMParser().parseFromString(str, 'text/html');
    return doc.documentElement.textContent;
  } catch {
    return str
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function BlogPage() {
  usePageMeta({
    title: 'Blog',
    description: "News, event recaps, and updates from Kingdom Connections.",
    path: '/blog',
  });
  const [posts,   setPosts]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/cms/blog')
      .then(r => setPosts((r.data || []).filter(p => p.status === 'published')))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {/* Hero */}
      <section
        style={{
          background: 'linear-gradient(rgba(10,10,10,0.85), rgba(10,10,10,0.9))',
          minHeight: '35vh',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div className="container py-5 text-white text-center">
          <h1 className="display-4 fw-bold mb-2">News &amp; Updates</h1>
          <p className="lead opacity-75 mx-auto" style={{ maxWidth: 520 }}>
            News, event recaps, and updates from Kingdom Connections.
          </p>
        </div>
      </section>
      <div style={{ height: 4, background: 'var(--brand-primary)' }} />

      {/* Posts grid */}
      <section className="py-5">
        <div className="container">
          {loading ? (
            <div className="text-center py-5">
              <span className="spinner-border text-primary" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-5">
              <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>📝</div>
              <h2 className="fw-bold mb-3" style={{ color: SPA_NAVY }}>No Posts Yet</h2>
              <p className="text-muted">Check back soon — articles are on the way.</p>
            </div>
          ) : (
            <div className="row g-4">
              {posts.map(post => (
                <div key={post.id} className="col-md-6 col-lg-4">
                  <Link to={`/blog/${post.slug}`} style={{ textDecoration: 'none' }}>
                    <div
                      className="card h-100 border-0 shadow-sm"
                      style={{ transition: 'transform 0.2s, box-shadow 0.2s' }}
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.13)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                    >
                      {post.og_image && (
                        <img
                          src={post.og_image}
                          alt={post.title}
                          className="card-img-top"
                          style={{ height: 200, objectFit: 'cover' }}
                          onError={e => { e.target.style.display = 'none'; }}
                        />
                      )}
                      <div className="card-body p-4">
                        <p className="small mb-2" style={{ color: 'var(--brand-primary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {fmtDate(post.published_at)}
                          {post.author_name && <> &bull; {post.author_name}</>}
                        </p>
                        <h5 className="card-title fw-bold mb-2" style={{ color: SPA_NAVY, lineHeight: 1.3 }}>
                          {decodeHtml(post.title)}
                        </h5>
                        {post.excerpt && (
                          <p className="card-text text-muted small" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {decodeHtml(post.excerpt)}
                          </p>
                        )}
                      </div>
                      <div className="card-footer bg-transparent border-0 px-4 pb-4">
                        <span style={{ color: 'var(--brand-primary)', fontWeight: 600, fontSize: '0.875rem' }}>Read more →</span>
                      </div>
                    </div>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
