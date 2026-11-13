import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Session } from '../lib/api';
import type { AppRole, Profile } from '../lib/types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  role: AppRole | null;
  isLeader: boolean;
  isEmployee: boolean;
  isContractor: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await api.getMyProfile());
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api.getSession().then(async (s) => {
      if (!alive) return;
      setSession(s);
      await loadProfile(s);
      if (alive) setLoading(false);
    });
    const off = api.onAuthChange(async (s) => {
      setSession(s);
      setLoading(true);
      await loadProfile(s);
      setLoading(false);
    });
    return () => {
      alive = false;
      off();
    };
  }, [loadProfile]);

  const value = useMemo<AuthState>(() => {
    const role = profile?.is_active ? profile.role : null;
    return {
      session,
      profile,
      loading,
      role,
      isLeader: role === 'leader',
      isEmployee: role === 'employee',
      isContractor: role === 'contractor',
      refreshProfile: () => loadProfile(session),
      signOut: () => api.signOut(),
    };
  }, [session, profile, loading, loadProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
