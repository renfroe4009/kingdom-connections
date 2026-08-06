import axios from 'axios';

// In dev, Vite proxies /api → localhost:4000, so baseURL '/api' works.
// In production (Netlify), VITE_API_URL is set to the EC2/Lambda origin
// (e.g. https://api.yourdomain.com) and we append /api.
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  // Use impersonation token when active, fall back to the real token.
  const token = localStorage.getItem('lc_impersonate_token') || localStorage.getItem('lc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      // If an impersonation token expired/invalid, just clear it and reload.
      if (localStorage.getItem('lc_impersonate_token')) {
        localStorage.removeItem('lc_impersonate_token');
        location.reload();
        return Promise.reject(err);
      }
      localStorage.removeItem('lc_token');
      localStorage.removeItem('lc_user');
      const isPortal = location.pathname.startsWith('/portal');
      const loginPath = isPortal ? '/portal/login' : '/login';
      if (location.pathname !== loginPath) location.href = loginPath;
    }
    return Promise.reject(err);
  }
);

export default api;
