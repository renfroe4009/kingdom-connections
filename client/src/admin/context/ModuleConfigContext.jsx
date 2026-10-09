// =============================================================================
// Client-side cache of GET /api/settings/module-manager — lets AppLayout hide
// disabled nav sections/submodules and SettingsPage hide disabled integration
// tabs, without each component independently fetching the same config.
// Mounted once inside AppLayout.jsx, alongside IntegrationsProvider.
// =============================================================================
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';

const DEFAULTS = { sections: {}, items: {}, integrations: {} };

const ModuleConfigContext = createContext({
  ...DEFAULTS,
  loading: true,
  refresh: () => {},
  isSectionEnabled: () => true,
  isItemEnabled: () => true,
  isIntegrationEnabled: () => true,
});

export function ModuleConfigProvider({ children }) {
  const [state, setState] = useState({ ...DEFAULTS, loading: true });

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/settings/module-manager');
      setState({ ...DEFAULTS, ...data, loading: false });
    } catch {
      // Fail open — an unreachable config means "nothing hidden", not "hide everything".
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Unlisted keys default to enabled — a disabled entry is explicitly `false`.
  const isSectionEnabled     = (key) => state.sections?.[key] !== false;
  const isItemEnabled        = (to)  => state.items?.[to] !== false;
  const isIntegrationEnabled = (key) => state.integrations?.[key] !== false;

  return (
    <ModuleConfigContext.Provider value={{ ...state, refresh, isSectionEnabled, isItemEnabled, isIntegrationEnabled }}>
      {children}
    </ModuleConfigContext.Provider>
  );
}

export function useModuleConfig() {
  return useContext(ModuleConfigContext);
}
