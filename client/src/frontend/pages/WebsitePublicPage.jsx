import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api/client.js';
import PageRenderer from '../renderer/PageRenderer.jsx';

export default function WebsitePublicPage({ slug: slugProp }) {
  const { slug: slugParam } = useParams();
  const slug = slugProp || slugParam;
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    api.get(`/website/pages/by-slug/${slug}`)
      .then(r => setPage(r.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!page) return;
    // No client name hardcoded here — this file is part of the reusable bundle,
    // and a baked-in fallback becomes the next project's stray title.
    document.title = page.meta_title || page.title || '';

    function setMeta(name, content, prop = false) {
      if (!content) return;
      const attr = prop ? 'property' : 'name';
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.appendChild(el); }
      el.setAttribute('content', content);
    }

    setMeta('description',        page.meta_desc);
    setMeta('keywords',           page.meta_keywords);
    setMeta('og:title',           page.meta_title || page.title, true);
    setMeta('og:description',     page.meta_desc, true);
    setMeta('og:image',           page.og_image, true);
    setMeta('og:type',            'website', true);
  }, [page]);

  if (loading) return (
    <div className="text-center py-5">
      <span className="spinner-border text-primary" />
    </div>
  );

  if (notFound) return (
    <div className="container py-5 text-center">
      <h1 className="display-4">404</h1>
      <p className="lead">Page not found.</p>
      <a href="/" className="btn btn-primary">Go Home</a>
    </div>
  );

  // PageRenderer owns both modes (visual Craft tree / raw code) and the
  // per-page custom CSS + JS. The header and footer come from PublicLayout,
  // which wraps this route — they are never page content.
  return <PageRenderer page={page} />;
}
