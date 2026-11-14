import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Session } from '../lib/api';
import type { AppRole, Organization, Profile } from '../lib/types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  role: AppRole | null;
  /** the person's company */
  company: Organization | null;
  /** Admin only: people, companies, projects' teams, settings */
  isAdmin: boolean;
  /** Admin or HSET: sees everything, manages safety config, can approve anything */
  isLeader: boolean;
  isHset: boolean;
  /** Project Manager or Supervisor */
  isProjectLead: boolean;
  isWorker: boolean;
  /** belongs to a subcontractor company */
  isContractor: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [company, setCompany] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setCompany(null);
      return;
    }
    try {
      const p = await api.getMyProfile();
      setProfile(p);
      if (p?.is_active) {
        const orgs = await api.listOrganizations().catch(() => []);
        setCompany(orgs.find((o) => o.id === p.organization_id) ?? null);
        void api.touchLastSeen().catch(() => undefined);
      }
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
      company,
      isAdmin: role === 'admin',
      isLeader: role === 'admin' || role === 'hset',
      isHset: role === 'hset',
      isProjectLead: role === 'project_manager' || role === 'supervisor',
      isWorker: role === 'worker',
      isContractor: company?.type === 'contractor',
      refreshProfile: () => loadProfile(session),
      signOut: () => api.signOut(),
    };
  }, [session, profile, company, loading, loadProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
