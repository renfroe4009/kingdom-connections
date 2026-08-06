import { useEffect } from 'react';

function setMeta(name, content, prop = false) {
  if (!content) return;
  const attr = prop ? 'property' : 'name';
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

// Sets document title + description/OG meta tags + canonical link for a
// public page. Runs whenever the given fields change.
export default function usePageMeta({ title, description, path, image } = {}) {
  useEffect(() => {
    if (title) document.title = title;
    setMeta('description', description);
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('og:image', image, true);

    if (path) {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'canonical';
        document.head.appendChild(link);
      }
      link.href = `${window.location.origin}${path}`;
    }
  }, [title, description, path, image]);
}
