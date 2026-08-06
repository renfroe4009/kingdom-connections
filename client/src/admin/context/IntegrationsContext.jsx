// =============================================================================
// Client-side cache of GET /api/integrations/status, so every component that
// needs to gate a feature on an integration's status (ConnectWise import tab,
// Email/SMS buttons, Google Drive/Calendar, USPS verify) shares one fetch
// instead of each independently calling its own settings endpoint.
// Mounted once inside AppLayout.jsx — CRM routes only (this is an
// authenticated, staff-facing concern, not something the public site or an
// unauthenticated visitor needs).
// =============================================================================
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';

const DEFAULTS = {
  connectwise: false,
  smtp: false,
  sms: false,
  usps: false,
  google: false,
  gateways: { authnet: false, valor: false },
};

const IntegrationsContext = createContext({ ...DEFAULTS, loading: true, refresh: () => {} });

export function IntegrationsProvider({ children }) {
  const [state, setState] = useState({ ...DEFAULTS, loading: true });

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/integrations/status');
      setState({ ...DEFAULTS, ...data, loading: false });
    } catch {
      // Leave everything gated-off (false) rather than assume a feature works
      // when we couldn't even confirm its status.
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <IntegrationsContext.Provider value={{ ...state, refresh }}>
      {children}
    </IntegrationsContext.Provider>
  );
}

export function useIntegrations() {
  return useContext(IntegrationsContext);
}
