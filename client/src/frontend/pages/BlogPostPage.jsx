import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client.js';
import usePageMeta from '../../hooks/usePageMeta.js';
import { sanitizeHtml } from '../../utils/sanitizeHtml.js';

const SPA_NAVY = '#0d1b2a';

const SERVER_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

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

function processBodyHtml(html) {
  if (!html) return '';
  let out = html;
  // Remove literal \n sequences (double-serialised content from DB)
  out = out.replace(/\\n/g, ' ');
  // Make any remaining relative /uploads/ src attributes absolute via the API server
  if (SERVER_BASE) {
    out = out.replace(/(<img[^>]*?\ssrc=")\/uploads\//gi, `$1${SERVER_BASE}/uploads/`);
  }
  // If content has no HTML tags at all, treat as plain text
  if (!/<[a-z]/i.test(out.trim())) {
    out = '<p>' + out.trim()
      .split(/\n{2,}/)
      .map(p => p.replace(/\n/g, '<br>'))
      .join('</p><p>') + '</p>';
  }
  return out;
}

function absoluteUrl(url) {
  if (!url) return url;
  if (url.startsWith('/') && SERVER_BASE) return `${SERVER_BASE}${url}`;
  return url;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function BlogPostPage() {
  const { slug } = useParams();
  const [post,     setPost]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);

  usePageMeta({
    title: post?.meta_title || post?.title || undefined,
    description: post?.meta_description || undefined,
    path: post ? `/blog/${post.slug}` : '/blog',
    image: post?.og_image || undefined,
  });

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    api.get(`/cms/blog/by-slug/${slug}`)
      .then(r => setPost(r.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return (
    <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
  );

  if (notFound) return (
    <div className="container py-5 text-center">
      <h1 className="display-4">404</h1>
      <p className="lead text-muted">Post not found.</p>
      <Link to="/blog" className="btn btn-primary">← Back to Blog</Link>
    </div>
  );

  return (
    <>
      {/* Hero / header */}
      <section
        style={{
          background: post.og_image
            ? `linear-gradient(rgba(10,10,10,0.7),rgba(10,10,10,0.8)), url('${absoluteUrl(post.og_image)}') center/cover no-repeat`
            : 'linear-gradient(rgba(10,10,10,0.85), rgba(10,10,10,0.9))',
          minHeight: '35vh',
          display: 'flex',
          alignItems: 'flex-end',
          paddingBottom: '2rem',
        }}
      >
        <div className="container">
          <Link to="/blog" className="small fw-semibold" style={{ color: '#aaa', textDecoration: 'none' }}>
            ← Blog
          </Link>
          <h1 className="display-5 fw-bold text-white mt-2 mb-2" style={{ maxWidth: 800 }}>
            {decodeHtml(post.title)}
          </h1>
          <p className="small mb-0" style={{ color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {fmtDate(post.published_at)}
            {post.author_name && <> &bull; {post.author_name}</>}
          </p>
        </div>
      </section>
      <div style={{ height: 4, background: 'var(--brand-primary)' }} />

      {/* Body */}
      <section className="py-5">
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-lg-8">
              {post.excerpt && (
                <p className="lead mb-4" style={{ color: SPA_NAVY, fontStyle: 'italic', borderLeft: '4px solid var(--brand-primary)', paddingLeft: '1.25rem' }}>
                  {decodeHtml(post.excerpt)}
                </p>
              )}

              {post.body_html ? (
                <div
                  className="blog-body"
                  style={{ lineHeight: 1.8, fontSize: '1.05rem', color: '#333' }}
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(processBodyHtml(post.body_html)) }}
                />
              ) : (
                <p className="text-muted fst-italic">No content yet.</p>
              )}

              <hr className="my-5" />

              <Link to="/blog" className="btn btn-outline-secondary">
                ← Back to Blog
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Scoped styles for blog body typography */}
      <style>{`
        .blog-body h2 { font-size: 1.6rem; font-weight: 700; color: ${SPA_NAVY}; margin: 2rem 0 0.75rem; }
        .blog-body h3 { font-size: 1.3rem; font-weight: 700; color: ${SPA_NAVY}; margin: 1.5rem 0 0.5rem; }
        .blog-body p  { margin-bottom: 1.25rem; }
        .blog-body img { max-width: 100%; border-radius: 6px; margin: 1rem 0; }
        .blog-body a  { color: var(--brand-primary); }
        .blog-body ul, .blog-body ol { padding-left: 1.5rem; margin-bottom: 1.25rem; }
        .blog-body li { margin-bottom: 0.4rem; }
        .blog-body blockquote { border-left: 4px solid var(--brand-primary); margin: 1.5rem 0; padding: 0.75rem 1.25rem; background: #f8f9fa; border-radius: 0 4px 4px 0; }
      `}</style>
    </>
  );
}
