import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { applyTheme, DEFAULT_SETTINGS } from '../lib/theme';
import type { AppSettings } from '../lib/types';

const Ctx = createContext<{ settings: AppSettings; reload: () => Promise<void>; preview: (s: AppSettings | null) => void } | null>(null);

/** Loads Branding settings (readable before sign-in) and applies them as CSS variables. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const reload = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s);
      applyTheme(s);
    } catch {
      applyTheme(DEFAULT_SETTINGS);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // Live preview while editing; null restores the saved settings.
  const preview = useCallback((s: AppSettings | null) => applyTheme(s ?? settings), [settings]);
  return <Ctx.Provider value={{ settings, reload, preview }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}
