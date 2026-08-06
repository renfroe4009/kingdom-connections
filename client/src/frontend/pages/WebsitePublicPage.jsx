import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Render } from '@measured/puck';
import api from '../../api/client.js';
import '../vcsf-design.css';

// Must match the config in WebsitePageEditor.jsx exactly
import { puckConfig } from '../../vb/builder/puckConfig.jsx';

function normalizePuckData(data) {
  if (!data || !Array.isArray(data.content)) return data;
  return {
    ...data,
    content: data.content.map((block) => {
      if (block.props && block.props.id) return block;
      const id = block.id || `${block.type}-${Math.random().toString(36).slice(2, 10)}`;
      return { ...block, props: { id, ...(block.props || {}) } };
    }),
  };
}

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
    document.title = page.meta_title || page.title || "Ventura County Sheriff's Foundation";

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

  // Inject per-page custom CSS if present
  const customCss = page.custom_css;

  // No puck_data yet — show placeholder
  if (!page.puck_data || !page.puck_data.content) {
    return (
      <div className="container py-5 text-center text-muted">
        <h2>{page.title}</h2>
        <p>This page has no published content yet.</p>
      </div>
    );
  }

  const filteredData = normalizePuckData({
    ...page.puck_data,
    content: (page.puck_data.content || []).filter(
      item => item.type !== 'Header' && item.type !== 'Footer'
    ),
  });

  return (
    <div className="vcsf-page">
      {customCss && <style>{customCss}</style>}
      <Render config={puckConfig} data={filteredData} />
    </div>
  );
}
