import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

// ── Color helpers ─────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
  const g = Math.round(hue2rgb(p, q, h)       * 255);
  const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function darken(hex, amount = 0.2) {
  try {
    const [r, g, b] = hexToRgb(hex);
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToHex(h, s, Math.max(0, l - amount * 100));
  } catch { return hex; }
}

function tint(hex, opacity = 0.1) {
  try {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${opacity})`;
  } catch { return hex; }
}

// ── Apply CSS vars to :root ───────────────────────────────────────────────────

function applyColors(primary, secondary) {
  if (!primary || !primary.startsWith('#')) return;
  const root = document.documentElement;
  const [r, g, b] = hexToRgb(primary);
  const darkPrimary = darken(primary, 0.2);
  const sec = secondary || '#1A1A1A';
  const darkSecondary = darken(sec, 0.2);

  // App-level brand vars
  root.style.setProperty('--brand',            primary);
  root.style.setProperty('--brand-dark',       darkPrimary);
  root.style.setProperty('--brand-mint',       tint(primary, 0.08));
  root.style.setProperty('--border-warm',      tint(primary, 0.3));
  root.style.setProperty('--secondary',        sec);
  root.style.setProperty('--secondary-dark',   darkSecondary);
  root.style.setProperty('--secondary-subtle', tint(sec, 0.12));

  // Bootstrap vars — override the Blue_Theme defaults so every BS component picks up the right color.
  // Links, text-primary, and subtle backgrounds ("the rest") stay on primary; buttons pull secondary.
  root.style.setProperty('--bs-primary',          primary);
  root.style.setProperty('--bs-primary-rgb',      `${r},${g},${b}`);
  root.style.setProperty('--bs-primary-bg-subtle', tint(primary, 0.1));
  root.style.setProperty('--bs-light-primary',    tint(primary, 0.1));
  root.style.setProperty('--bs-btn-bg',           sec);
  root.style.setProperty('--bs-link-color',       primary);
  root.style.setProperty('--bs-link-hover-color', darkPrimary);
}

// ── Context ───────────────────────────────────────────────────────────────────

const ThemeContext = createContext({
  theme: 'light',
  toggleTheme: () => {},
  primaryColor: '#F05523',
  secondaryColor: '#1A1A1A',
  logoWebUrl: '',
  refreshTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('crm-theme') || 'light');
  const [primaryColor,   setPrimaryColor]   = useState('#F05523');
  const [secondaryColor, setSecondaryColor] = useState('#1A1A1A');
  const [logoWebUrl,     setLogoWebUrl]     = useState('');

  // Apply dark/light to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem('crm-theme', theme);
  }, [theme]);

  const refreshTheme = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/settings/public/theme`);
      if (!r.ok) return;
      const d = await r.json();
      const p = d.primary_color   || '#F05523';
      const s = d.secondary_color || '#1A1A1A';
      setPrimaryColor(p);
      setSecondaryColor(s);
      setLogoWebUrl(d.logo_web_url || '');
      applyColors(p, s);
    } catch { /* network error — keep defaults */ }
  }, []);

  // Load on mount
  useEffect(() => { refreshTheme(); }, [refreshTheme]);

  function toggleTheme() {
    setTheme((t) => t === 'light' ? 'dark' : 'light');
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, primaryColor, secondaryColor, logoWebUrl, refreshTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
