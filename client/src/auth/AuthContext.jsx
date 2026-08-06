import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { const raw = localStorage.getItem('lc_user'); return raw ? JSON.parse(raw) : null; }
    catch { localStorage.removeItem('lc_user'); return null; }
  });
  const [loading, setLoading] = useState(true);
  // impersonating holds { id, email, first_name, last_name } of the agent being viewed as
  const [impersonating, setImpersonating] = useState(() => {
    try { const raw = localStorage.getItem('lc_impersonate_user'); return raw ? JSON.parse(raw) : null; }
    catch { localStorage.removeItem('lc_impersonate_user'); return null; }
  });

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const token = localStorage.getItem('lc_token');
      if (!token) { setLoading(false); return; }
      try {
        const { data } = await api.get('/auth/me');
        if (cancelled) return;
        setUser(data.user);
        localStorage.setItem('lc_user', JSON.stringify(data.user));
      } catch (_e) { /* handled by interceptor */ }
      finally { if (!cancelled) setLoading(false); }
    }
    refresh();
    return () => { cancelled = true; };
  }, []);

  async function login(email, password) {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('lc_token', data.token);
    localStorage.setItem('lc_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  async function logout() {
    // Fire-and-forget — server is stateless JWT, so this is only for logging.
    try { await api.post('/auth/logout'); } catch (_e) { /* ignore */ }
    localStorage.removeItem('lc_token');
    localStorage.removeItem('lc_user');
    localStorage.removeItem('lc_impersonate_token');
    localStorage.removeItem('lc_impersonate_user');
    setUser(null);
    setImpersonating(null);
  }

  // Start impersonating a report — fetches a short-lived token from the server.
  async function impersonate(userId) {
    const { data } = await api.post(`/users/${userId}/impersonate`);
    localStorage.setItem('lc_impersonate_token', data.token);
    localStorage.setItem('lc_impersonate_user', JSON.stringify(data.impersonating));
    setImpersonating(data.impersonating);
  }

  // Return to the manager's own session.
  function stopImpersonating() {
    localStorage.removeItem('lc_impersonate_token');
    localStorage.removeItem('lc_impersonate_user');
    setImpersonating(null);
  }

  const can = (perm) =>
    !!user && (user.roles?.includes('admin') || user.permissions?.includes(perm));

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, can, impersonating, impersonate, stopImpersonating }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
