import { useEffect, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.jsx';

// =============================================================================
// BrandMark — shared brand lockup used across layouts, login, portal, and the
// public pay page. Renders the business's uploaded "web" logo (Settings →
// Business, sourced from the Media Library), falling back to the static VCSF
// asset if none has been uploaded.
//
// Sizes: "sm" (sidebar), "md" (portal header / pay page), "lg" (auth cards).
// `showTagline` is kept for prop-API compatibility with existing callers;
// currently a no-op since the wordmark and tagline live inside the logo image.
// =============================================================================
const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const FALLBACK_LOGO = '/vcsf/logo-header.png';

// Media-library URLs come back as relative /api/... paths in local dev (same
// origin) but need the API origin prefixed in a split Vercel/Railway deploy.
function resolveLogoUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//.test(url)) return url;
  return `${API_ORIGIN}${url}`;
}

export default function BrandMark({ size = 'md', linkHome = false }) {
  // Height-based sizing — the logo has its own intrinsic aspect ratio so we
  // only constrain height and let width follow.
  const heights = {
    sm: 55,
    md: 44,
    lg: 64,
  };
  const h = heights[size] || heights.md;
  const { logoWebUrl } = useTheme();
  const [errored, setErrored] = useState(false);
  const src = (errored || !logoWebUrl) ? FALLBACK_LOGO : resolveLogoUrl(logoWebUrl);

  // Give the uploaded logo another chance if it changes after an earlier error
  // (e.g. theme reloads after the user picks a new one in Settings).
  useEffect(() => { setErrored(false); }, [logoWebUrl]);

  const inner = (
    <img
      src={src}
      alt="Ventura County Sheriff's Foundation"
      style={{
        height: h,
        width: 'auto',
        maxWidth: '100%',
        display: 'block',
        objectFit: 'contain',
      }}
      onError={() => setErrored(true)}
    />
  );

  return linkHome ? (
    <a href="/" className="text-decoration-none d-inline-flex">{inner}</a>
  ) : (
    inner
  );
}
